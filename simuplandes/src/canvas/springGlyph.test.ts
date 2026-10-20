import { describe, it, expect } from "vitest";
import { springZigzag, torsionalSpiral, SPRING_AMPLITUDE, SPRING_PEAKS } from "./springGlyph";

describe("springZigzag", () => {
  it("starts and ends on the two points with a zigzag between", () => {
    const points = springZigzag({ x: 0, y: 0 }, { x: 100, y: 0 });
    expect(points.slice(0, 2)).toEqual([0, 0]);
    expect(points.slice(-2)).toEqual([100, 0]);
    expect(points).toHaveLength(2 * (SPRING_PEAKS + 4));
    const peaks = points.slice(4, -4).filter((_, i) => i % 2 === 1);
    expect(Math.max(...peaks)).toBeCloseTo(SPRING_AMPLITUDE, 12);
    expect(Math.min(...peaks)).toBeCloseTo(-SPRING_AMPLITUDE, 12);
  });

  it("collapses to a segment when the ends coincide", () => {
    expect(springZigzag({ x: 3, y: 4 }, { x: 3, y: 4 })).toEqual([3, 4, 3, 4]);
  });
});

describe("torsionalSpiral", () => {
  it("winds outward to the outer radius", () => {
    const points = torsionalSpiral(1, 10, 4);
    expect(points).toHaveLength(10);
    expect(Math.hypot(points[8], points[9])).toBeCloseTo(10, 12);
    expect(Math.hypot(points[0], points[1])).toBeCloseTo(3.5, 12);
  });
});
