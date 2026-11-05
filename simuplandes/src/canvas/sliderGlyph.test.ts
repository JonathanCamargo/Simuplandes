import { describe, expect, it } from "vitest";
import { GUIDE_Y, sliderGlyph } from "./sliderGlyph";

function xs(flat: number[]): number[] {
  return flat.filter((_, i) => i % 2 === 0);
}

describe("sliderGlyph", () => {
  it("puts the block at the rail site when the two sites coincide", () => {
    const glyph = sliderGlyph({ x: 10, y: 10 }, { x: 10, y: 10 }, 0);
    expect(glyph.blockX).toBeCloseTo(0);
    expect(glyph.guide[0]).toBeCloseTo(-24);
    expect(Math.max(...xs(glyph.guide))).toBeCloseTo(24);
  });

  it("measures the block offset along the rotated axis and stretches the guide to keep it on", () => {
    // Rotation -90deg (Konva, clockwise) is the axis pointing screen-up.
    const glyph = sliderGlyph({ x: 0, y: 0 }, { x: 0, y: -100 }, -90);
    expect(glyph.blockX).toBeCloseTo(100);
    expect(Math.max(...xs(glyph.guide))).toBeGreaterThanOrEqual(100 + 10);
    expect(glyph.guide[0]).toBeCloseTo(-24);
  });

  it("draws hatch marks below the guide line", () => {
    const glyph = sliderGlyph({ x: 0, y: 0 }, { x: 0, y: 0 }, 0);
    const ys = glyph.guide.filter((_, i) => i % 2 === 1);
    expect(Math.min(...ys)).toBe(GUIDE_Y);
    expect(Math.max(...ys)).toBeGreaterThan(GUIDE_Y);
  });
});
