import { describe, it, expect } from "vitest";
import {
  worldToScreen,
  screenToWorld,
  worldLengthToScreen,
  screenLengthToWorld,
  zoomAt,
  panByScreen,
  fitToBounds,
  defaultViewport,
  angleToKonvaRotationDeg,
  MIN_ZOOM,
  MAX_ZOOM,
  type Viewport,
} from "./viewport";

/** Deterministic PRNG (mulberry32), so the round-trip property test is reproducible. */
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randomViewport(rand: () => number): Viewport {
  return {
    panWorld: { x: (rand() - 0.5) * 2000, y: (rand() - 0.5) * 2000 },
    zoom: 0.05 + rand() * 50,
    widthPx: 200 + rand() * 1600,
    heightPx: 200 + rand() * 1200,
  };
}

describe("worldToScreen / screenToWorld round trip", () => {
  it("round-trips over 200 random viewports/points within 1e-9", () => {
    const rand = mulberry32(12345);
    for (let i = 0; i < 200; i++) {
      const v = randomViewport(rand);
      const p = { x: (rand() - 0.5) * 5000, y: (rand() - 0.5) * 5000 };
      const s = { x: rand() * v.widthPx, y: rand() * v.heightPx };

      const roundTrippedScreen = worldToScreen(v, screenToWorld(v, p));
      expect(Math.abs(roundTrippedScreen.x - p.x)).toBeLessThan(1e-9 * Math.max(1, Math.abs(p.x)));
      expect(Math.abs(roundTrippedScreen.y - p.y)).toBeLessThan(1e-9 * Math.max(1, Math.abs(p.y)));

      const roundTrippedWorld = screenToWorld(v, worldToScreen(v, s));
      expect(Math.abs(roundTrippedWorld.x - s.x)).toBeLessThan(1e-6);
      expect(Math.abs(roundTrippedWorld.y - s.y)).toBeLessThan(1e-6);
    }
  });

  it("maps world +y to screen -y (larger world y -> smaller screen y)", () => {
    const v: Viewport = { panWorld: { x: 0, y: 0 }, zoom: 2, widthPx: 400, heightPx: 300 };
    const low = worldToScreen(v, { x: 0, y: 0 });
    const high = worldToScreen(v, { x: 0, y: 10 });
    expect(high.y).toBeLessThan(low.y);
  });

  it("panWorld maps to the screen centre", () => {
    const v: Viewport = { panWorld: { x: 12, y: -7 }, zoom: 3, widthPx: 400, heightPx: 300 };
    const center = worldToScreen(v, v.panWorld);
    expect(center.x).toBeCloseTo(200, 9);
    expect(center.y).toBeCloseTo(150, 9);
  });
});

describe("worldLengthToScreen / screenLengthToWorld", () => {
  it("are exact inverses scaled by zoom", () => {
    const v: Viewport = { panWorld: { x: 0, y: 0 }, zoom: 4, widthPx: 100, heightPx: 100 };
    expect(worldLengthToScreen(v, 10)).toBeCloseTo(40, 9);
    expect(screenLengthToWorld(v, 40)).toBeCloseTo(10, 9);
    expect(screenLengthToWorld(v, worldLengthToScreen(v, 7))).toBeCloseTo(7, 9);
  });
});

describe("zoomAt", () => {
  it("keeps the world point under the cursor unchanged and clamps zoom", () => {
    const rand = mulberry32(99);
    for (let i = 0; i < 50; i++) {
      const v = randomViewport(rand);
      const screenPt = { x: rand() * v.widthPx, y: rand() * v.heightPx };
      const before = screenToWorld(v, screenPt);
      const factor = 0.1 + rand() * 20;
      const next = zoomAt(v, screenPt, factor);
      const after = screenToWorld(next, screenPt);
      expect(Math.abs(after.x - before.x)).toBeLessThan(1e-9 * Math.max(1, Math.abs(before.x)));
      expect(Math.abs(after.y - before.y)).toBeLessThan(1e-9 * Math.max(1, Math.abs(before.y)));
      expect(next.zoom).toBeGreaterThanOrEqual(MIN_ZOOM);
      expect(next.zoom).toBeLessThanOrEqual(MAX_ZOOM);
    }
  });

  it("clamps a huge zoom-in to MAX_ZOOM", () => {
    const v: Viewport = { panWorld: { x: 0, y: 0 }, zoom: 1, widthPx: 400, heightPx: 300 };
    const next = zoomAt(v, { x: 200, y: 150 }, 1e9);
    expect(next.zoom).toBe(MAX_ZOOM);
  });

  it("clamps a huge zoom-out to MIN_ZOOM", () => {
    const v: Viewport = { panWorld: { x: 0, y: 0 }, zoom: 1, widthPx: 400, heightPx: 300 };
    const next = zoomAt(v, { x: 200, y: 150 }, 1e-9);
    expect(next.zoom).toBe(MIN_ZOOM);
  });
});

describe("panByScreen", () => {
  it("moves world content 10 px right on screen for {dx: 10, dy: 0}", () => {
    const v: Viewport = { panWorld: { x: 0, y: 0 }, zoom: 2, widthPx: 400, heightPx: 300 };
    const worldPt = { x: 5, y: 5 };
    const before = worldToScreen(v, worldPt);
    const next = panByScreen(v, { dx: 10, dy: 0 });
    const after = worldToScreen(next, worldPt);
    expect(after.x - before.x).toBeCloseTo(10, 9);
    expect(after.y - before.y).toBeCloseTo(0, 9);
  });

  it("moves world content down on screen for a positive dy", () => {
    const v: Viewport = { panWorld: { x: 0, y: 0 }, zoom: 2, widthPx: 400, heightPx: 300 };
    const worldPt = { x: 5, y: 5 };
    const before = worldToScreen(v, worldPt);
    const next = panByScreen(v, { dx: 0, dy: 15 });
    const after = worldToScreen(next, worldPt);
    expect(after.y - before.y).toBeCloseTo(15, 9);
  });
});

describe("fitToBounds", () => {
  const v: Viewport = { panWorld: { x: 999, y: 999 }, zoom: 1, widthPx: 800, heightPx: 600 };

  it("puts every bounds corner inside the screen minus the margin, centred", () => {
    const bounds = { min: { x: 0, y: 0 }, max: { x: 100, y: 50 } };
    const margin = 40;
    const next = fitToBounds(v, bounds, margin);

    const corners = [
      { x: bounds.min.x, y: bounds.min.y },
      { x: bounds.max.x, y: bounds.min.y },
      { x: bounds.min.x, y: bounds.max.y },
      { x: bounds.max.x, y: bounds.max.y },
    ];
    for (const c of corners) {
      const s = worldToScreen(next, c);
      expect(s.x).toBeGreaterThanOrEqual(margin - 1e-6);
      expect(s.x).toBeLessThanOrEqual(next.widthPx - margin + 1e-6);
      expect(s.y).toBeGreaterThanOrEqual(margin - 1e-6);
      expect(s.y).toBeLessThanOrEqual(next.heightPx - margin + 1e-6);
    }

    const center = worldToScreen(next, { x: 50, y: 25 });
    expect(center.x).toBeCloseTo(next.widthPx / 2, 6);
    expect(center.y).toBeCloseTo(next.heightPx / 2, 6);
  });

  it("keeps the current zoom and centres a zero-area (one-point) bounds", () => {
    const bounds = { min: { x: 12, y: 34 }, max: { x: 12, y: 34 } };
    const next = fitToBounds(v, bounds);
    expect(next.zoom).toBe(v.zoom);
    expect(next.panWorld).toEqual({ x: 12, y: 34 });
  });

  it("returns defaultViewport for a null bounds", () => {
    const next = fitToBounds(v, null);
    expect(next).toEqual(defaultViewport(v.widthPx, v.heightPx));
  });

  it("clamps the fit zoom to MAX_ZOOM for a tiny bounds", () => {
    const bounds = { min: { x: 0, y: 0 }, max: { x: 1e-6, y: 1e-6 } };
    const next = fitToBounds(v, bounds);
    expect(next.zoom).toBe(MAX_ZOOM);
  });

  it("uses only the width constraint for a zero-height, non-zero-width bounds", () => {
    const bounds = { min: { x: 0, y: 10 }, max: { x: 100, y: 10 } };
    const next = fitToBounds(v, bounds, 40);
    expect(next.zoom).toBeCloseTo((v.widthPx - 80) / 100, 9);
  });

  it("uses only the height constraint for a zero-width, non-zero-height bounds", () => {
    const bounds = { min: { x: 5, y: 0 }, max: { x: 5, y: 60 } };
    const next = fitToBounds(v, bounds, 40);
    expect(next.zoom).toBeCloseTo((v.heightPx - 80) / 60, 9);
  });
});

describe("defaultViewport", () => {
  it("has zoom 2 and pan {100, 50}", () => {
    const v = defaultViewport(800, 600);
    expect(v.zoom).toBe(2);
    expect(v.panWorld).toEqual({ x: 100, y: 50 });
    expect(v.widthPx).toBe(800);
    expect(v.heightPx).toBe(600);
  });
});

describe("angleToKonvaRotationDeg", () => {
  it("negates radians-to-degrees", () => {
    expect(angleToKonvaRotationDeg(0)).toBeCloseTo(0, 9);
    expect(angleToKonvaRotationDeg(Math.PI / 2)).toBeCloseTo(-90, 9);
    expect(angleToKonvaRotationDeg(-Math.PI)).toBeCloseTo(180, 9);
  });
});
