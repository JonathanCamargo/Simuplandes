import { describe, it, expect } from "vitest";
import {
  ZERO,
  vec2,
  add,
  sub,
  scale,
  negate,
  dot,
  cross,
  perp,
  magnitude,
  distance,
  normalize,
  direction,
  fromPolar,
  rotate,
  type Vec2,
} from "./vec2";

/** Compares two Vec2 values component-wise with toBeCloseTo (never toEqual — results are floating point). */
function expectVecClose(actual: Vec2, expected: Vec2, digits = 12): void {
  expect(actual.x).toBeCloseTo(expected.x, digits);
  expect(actual.y).toBeCloseTo(expected.y, digits);
}

describe("vec2 construction", () => {
  it("vec2(x,y) builds a plain {x,y}", () => {
    expect(vec2(3, -4)).toEqual({ x: 3, y: -4 });
  });

  it("ZERO is {0,0} and frozen", () => {
    expect(ZERO).toEqual({ x: 0, y: 0 });
    expect(Object.isFrozen(ZERO)).toBe(true);
  });
});

describe("add/sub/scale/negate", () => {
  it("add({1,2},{3,-5}) -> {4,-3}", () => {
    expect(add(vec2(1, 2), vec2(3, -5))).toEqual({ x: 4, y: -3 });
  });

  it("sub({1,2},{3,-5}) -> {-2,7}", () => {
    expect(sub(vec2(1, 2), vec2(3, -5))).toEqual({ x: -2, y: 7 });
  });

  it("scale({1,-2},3) -> {3,-6}", () => {
    expect(scale(vec2(1, -2), 3)).toEqual({ x: 3, y: -6 });
  });

  it("negate({1,-2}) -> {-1,2}", () => {
    expect(negate(vec2(1, -2))).toEqual({ x: -1, y: 2 });
  });
});

describe("dot/cross/perp", () => {
  it("dot({1,2},{3,4}) = 11", () => {
    expect(dot(vec2(1, 2), vec2(3, 4))).toBe(11);
  });

  it("cross({1,0},{0,1}) = 1", () => {
    expect(cross(vec2(1, 0), vec2(0, 1))).toBe(1);
  });

  it("cross({0,1},{1,0}) = -1", () => {
    expect(cross(vec2(0, 1), vec2(1, 0))).toBe(-1);
  });

  it("perp({1,0}) -> {0,1}", () => {
    expect(perp(vec2(1, 0))).toEqual({ x: 0, y: 1 });
  });
});

describe("magnitude/distance", () => {
  it("magnitude({3,4}) = 5", () => {
    expect(magnitude(vec2(3, 4))).toBe(5);
  });

  it("distance({1,1},{4,5}) = 5", () => {
    expect(distance(vec2(1, 1), vec2(4, 5))).toBe(5);
  });
});

describe("normalize", () => {
  it("normalize({3,4}) -> {0.6,0.8}", () => {
    expectVecClose(normalize(vec2(3, 4)), { x: 0.6, y: 0.8 });
  });

  it("normalize(ZERO) -> {0,0} (no NaN) — guard branch", () => {
    const n = normalize(ZERO);
    expect(n).toEqual({ x: 0, y: 0 });
    expect(Number.isNaN(n.x)).toBe(false);
    expect(Number.isNaN(n.y)).toBe(false);
  });
});

describe("direction", () => {
  it("direction({0,1}) ~= pi/2", () => {
    expect(direction(vec2(0, 1))).toBeCloseTo(Math.PI / 2, 12);
  });

  it("direction({-1,0}) ~= pi", () => {
    expect(direction(vec2(-1, 0))).toBeCloseTo(Math.PI, 12);
  });

  it("direction({0,-1}) ~= -pi/2", () => {
    expect(direction(vec2(0, -1))).toBeCloseTo(-Math.PI / 2, 12);
  });

  it("direction(ZERO) = 0", () => {
    expect(direction(ZERO)).toBe(0);
  });
});

describe("fromPolar", () => {
  it("fromPolar(2, pi/2) ~= {0,2}", () => {
    expectVecClose(fromPolar(2, Math.PI / 2), { x: 0, y: 2 });
  });

  const table: Array<[number, number]> = [
    [1, 0],
    [2, Math.PI / 4],
    [3, Math.PI / 2],
    [1.5, Math.PI],
    [4, -Math.PI / 3],
    [0.5, 5],
  ];

  it.each(table)("fromPolar(m=%p, a=%p): direction and magnitude round-trip", (m, a) => {
    const v = fromPolar(m, a);
    expect(magnitude(v)).toBeCloseTo(m, 10);
    expectVecClose(fromPolar(m, direction(v)), v, 10);
  });
});

describe("rotate", () => {
  it("rotate({1,0}, pi/2) ~= {0,1}", () => {
    expectVecClose(rotate(vec2(1, 0), Math.PI / 2), { x: 0, y: 1 });
  });

  it("rotate(v, 2*pi) ~= v", () => {
    const v = vec2(3, -4);
    expectVecClose(rotate(v, 2 * Math.PI), v, 10);
  });

  const vectors: Vec2[] = [
    vec2(1, 0),
    vec2(0, 1),
    vec2(3, 4),
    vec2(-2, 5),
    vec2(-1, -1),
    vec2(0, 0),
  ];
  const angles = [0, Math.PI / 6, -Math.PI / 3, Math.PI, 2 * Math.PI, 7.5];

  const cases: Array<[Vec2, number]> = vectors.flatMap((v) =>
    angles.map((a): [Vec2, number] => [v, a]),
  );

  it.each(cases)("rotate(v=%o, a=%p) then rotate(-a) ~= v", (v, a) => {
    const rotated = rotate(v, a);
    const back = rotate(rotated, -a);
    expectVecClose(back, v, 9);
  });

  it.each(cases)("rotate(v=%o, a=%p) preserves magnitude", (v, a) => {
    const rotated = rotate(v, a);
    expect(magnitude(rotated)).toBeCloseTo(magnitude(v), 9);
  });
});

describe("purity — inputs are never mutated", () => {
  it("every function leaves frozen inputs untouched", () => {
    const a = Object.freeze(vec2(1, 2));
    const b = Object.freeze(vec2(3, -5));

    expect(() => add(a, b)).not.toThrow();
    expect(() => sub(a, b)).not.toThrow();
    expect(() => scale(a, 3)).not.toThrow();
    expect(() => negate(a)).not.toThrow();
    expect(() => dot(a, b)).not.toThrow();
    expect(() => cross(a, b)).not.toThrow();
    expect(() => perp(a)).not.toThrow();
    expect(() => magnitude(a)).not.toThrow();
    expect(() => distance(a, b)).not.toThrow();
    expect(() => normalize(a)).not.toThrow();
    expect(() => direction(a)).not.toThrow();
    expect(() => rotate(a, Math.PI / 4)).not.toThrow();

    // still frozen and unchanged after every call above
    expect(a).toEqual({ x: 1, y: 2 });
    expect(b).toEqual({ x: 3, y: -5 });
    expect(Object.isFrozen(a)).toBe(true);
    expect(Object.isFrozen(b)).toBe(true);
  });
});
