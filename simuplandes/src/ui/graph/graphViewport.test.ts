import { describe, expect, it } from "vitest";
import {
  GRAPH_FALLBACK_SIZE_PX,
  GRAPH_MAX_SEPARATION,
  GRAPH_PX,
  computeGraphViewport,
  toScreen,
} from "./graphViewport";
import { MIN_NODE_SEPARATION } from "../../graph";

describe("computeGraphViewport", () => {
  it("302x281: derives width/height/drawSize/offsets and a minSeparation from GRAPH_PX", () => {
    const vp = computeGraphViewport(302, 281);
    expect(vp.width).toBe(302);
    expect(vp.height).toBe(281);
    expect(vp.drawSize).toBe(281);
    expect(vp.offsetX).toBeCloseTo(10.5, 9);
    expect(vp.offsetY).toBe(0);
    const expected = (2 * GRAPH_PX.footprintRadius + GRAPH_PX.nodeGap) / 281;
    expect(vp.minSeparation).toBeCloseTo(expected, 9);
    expect(vp.minSeparation).toBeGreaterThan(0.17);
    expect(vp.minSeparation).toBeLessThan(0.19);
  });

  it("0x0, NaNx100, -5x200: all fall back to a 360x360 viewport with a finite minSeparation", () => {
    for (const [w, h] of [
      [0, 0],
      [NaN, 100],
      [-5, 200],
    ] as const) {
      const vp = computeGraphViewport(w, h);
      expect(vp.width).toBe(GRAPH_FALLBACK_SIZE_PX);
      expect(vp.height).toBe(GRAPH_FALLBACK_SIZE_PX);
      expect(vp.drawSize).toBe(GRAPH_FALLBACK_SIZE_PX);
      expect(Number.isFinite(vp.minSeparation)).toBe(true);
    }
  });

  it("minSeparation is capped at GRAPH_MAX_SEPARATION for a tiny 140x140 box", () => {
    const vp = computeGraphViewport(140, 140);
    expect(vp.minSeparation).toBe(GRAPH_MAX_SEPARATION);
  });

  it("minSeparation never drops below MIN_NODE_SEPARATION for a huge box", () => {
    const vp = computeGraphViewport(4000, 4000);
    expect(vp.minSeparation).toBeGreaterThanOrEqual(MIN_NODE_SEPARATION);
  });

  it("toScreen: (0.5, 0.5) is the center of the drawSize square; (0, 0) is the offset", () => {
    const vp = computeGraphViewport(302, 281);
    const center = toScreen({ x: 0.5, y: 0.5 }, vp);
    expect(center.x).toBeCloseTo(vp.offsetX + vp.drawSize / 2, 9);
    expect(center.y).toBeCloseTo(vp.offsetY + vp.drawSize / 2, 9);
    const origin = toScreen({ x: 0, y: 0 }, vp);
    expect(origin).toEqual({ x: vp.offsetX, y: vp.offsetY });
  });

  it("is deterministic (pure function, no hidden state)", () => {
    const a = computeGraphViewport(302, 281);
    const b = computeGraphViewport(302, 281);
    expect(a).toEqual(b);
  });
});
