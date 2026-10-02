import { describe, it, expect } from "vitest";
import { gridSpacingFor, gridLines, rulerTicks } from "./grid";
import { worldToScreen, type Viewport } from "./viewport";

describe("gridSpacingFor", () => {
  it("picks the smallest {1,2,5}x10^k spacing whose on-screen size is >= 12px", () => {
    // zoom=2: candidates *2 -> 1*2=2,2*2=4,5*2=10 (all <12), 10*2=20 (>=12) -> spacing 10
    expect(gridSpacingFor(2)).toBe(10);
    // zoom=12: 1*12=12 (>=12) -> spacing 1
    expect(gridSpacingFor(12)).toBe(1);
    // zoom=0.1: 1*0.1=0.1,...,100*0.1=10,200*0.1=20(>=12) -> spacing 200
    expect(gridSpacingFor(0.1)).toBe(200);
  });

  it("respects a custom minPx", () => {
    expect(gridSpacingFor(1, 5)).toBe(5);
  });

  it("falls back to 1 for a non-positive zoom", () => {
    expect(gridSpacingFor(0)).toBe(1);
    expect(gridSpacingFor(-3)).toBe(1);
  });
});

describe("gridLines", () => {
  const v: Viewport = { panWorld: { x: 0, y: 0 }, zoom: 2, widthPx: 400, heightPx: 300 };

  it("lists only lines visible in the viewport, with correct screen positions", () => {
    const spacing = 10;
    const lines = gridLines(v, spacing);
    expect(lines.vertical.length).toBeGreaterThan(0);
    expect(lines.horizontal.length).toBeGreaterThan(0);

    for (const line of lines.vertical) {
      expect(line.screenX).toBeCloseTo(worldToScreen(v, { x: line.worldX, y: 0 }).x, 9);
      expect(line.screenX).toBeGreaterThanOrEqual(-1e-6);
      expect(line.screenX).toBeLessThanOrEqual(v.widthPx + 1e-6);
    }
    for (const line of lines.horizontal) {
      expect(line.screenY).toBeCloseTo(worldToScreen(v, { x: 0, y: line.worldY }).y, 9);
      expect(line.screenY).toBeGreaterThanOrEqual(-1e-6);
      expect(line.screenY).toBeLessThanOrEqual(v.heightPx + 1e-6);
    }
  });

  it("marks major lines every 5 minor lines for a 1x10^k or 2x10^k spacing", () => {
    const lines = gridLines(v, 10); // 10 = 1x10^1
    const majors = lines.vertical.filter((l) => l.major).map((l) => l.worldX);
    for (const worldX of majors) {
      expect(Math.abs(Math.round(worldX / 10) % 5)).toBe(0);
    }
  });

  it("marks major lines every 2 minor lines for a 5x10^k spacing", () => {
    const lines = gridLines(v, 5); // 5 = 5x10^0
    const majors = lines.vertical.filter((l) => l.major).map((l) => l.worldX);
    for (const worldX of majors) {
      expect(Math.abs(Math.round(worldX / 5) % 2)).toBe(0);
    }
  });

  it("marks the axes (world x=0 / y=0)", () => {
    const lines = gridLines(v, 10);
    const axisVertical = lines.vertical.find((l) => l.worldX === 0);
    const axisHorizontal = lines.horizontal.find((l) => l.worldY === 0);
    expect(axisVertical?.axis).toBe(true);
    expect(axisHorizontal?.axis).toBe(true);
    for (const l of lines.vertical) {
      if (l.worldX !== 0) expect(l.axis).toBe(false);
    }
  });
});

describe("rulerTicks", () => {
  const v: Viewport = { panWorld: { x: 0, y: 0 }, zoom: 2, widthPx: 400, heightPx: 300 };

  it("returns ticks with screen position and world label for visible major x lines", () => {
    const ticks = rulerTicks(v, "x");
    expect(ticks.length).toBeGreaterThan(0);
    for (const tick of ticks) {
      expect(tick.screen).toBeCloseTo(worldToScreen(v, { x: tick.world, y: 0 }).x, 9);
    }
  });

  it("returns ticks with screen position and world label for visible major y lines", () => {
    const ticks = rulerTicks(v, "y");
    expect(ticks.length).toBeGreaterThan(0);
    for (const tick of ticks) {
      expect(tick.screen).toBeCloseTo(worldToScreen(v, { x: 0, y: tick.world }).y, 9);
    }
  });
});
