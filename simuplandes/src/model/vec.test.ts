import { describe, it, expect } from "vitest";
import { toVec2, toTuple, cleanNumber } from "./vec";

describe("vec", () => {
  it("toVec2 converts a tuple to a Vec2", () => {
    expect(toVec2([3, -4])).toEqual({ x: 3, y: -4 });
  });

  it("toTuple converts a Vec2 to a tuple", () => {
    expect(toTuple({ x: 1, y: 2 })).toEqual([1, 2]);
  });

  it("toTuple normalizes -0 to exactly +0", () => {
    const [x, y] = toTuple({ x: -0, y: -0 });
    expect(Object.is(x, 0)).toBe(true);
    expect(Object.is(y, 0)).toBe(true);
  });

  it("cleanNumber turns -0 into +0", () => {
    expect(Object.is(cleanNumber(-0), 0)).toBe(true);
  });

  it("cleanNumber leaves other numbers unchanged", () => {
    expect(cleanNumber(1.5)).toBe(1.5);
  });
});
