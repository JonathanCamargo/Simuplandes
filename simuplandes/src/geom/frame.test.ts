import { describe, it, expect } from "vitest";
import { vec2, distance, ZERO, type Vec2 } from "./vec2";
import { localToWorld, worldToLocal } from "./frame";

/** Compares two Vec2 values component-wise with toBeCloseTo (never toEqual — results are floating point). */
function expectVecClose(actual: Vec2, expected: Vec2, digits = 9): void {
  expect(actual.x).toBeCloseTo(expected.x, digits);
  expect(actual.y).toBeCloseTo(expected.y, digits);
}

describe("localToWorld / worldToLocal — basic cases", () => {
  it("localToWorld({1,0}, {10,5}, pi/2) ~= {10,6}", () => {
    expectVecClose(localToWorld(vec2(1, 0), vec2(10, 5), Math.PI / 2), vec2(10, 6));
  });

  it("localToWorld(ZERO, o, a) = o for any origin/angle", () => {
    const o = vec2(-3, 7);
    expectVecClose(localToWorld(ZERO, o, 1.234), o);
  });

  it("worldToLocal(o, o, a) ~= ZERO for any origin/angle", () => {
    const o = vec2(4, -2);
    expectVecClose(worldToLocal(o, o, -0.75), ZERO);
  });

  it("worldToLocal({10,6}, {10,5}, pi/2) ~= {1,0}", () => {
    expectVecClose(worldToLocal(vec2(10, 6), vec2(10, 5), Math.PI / 2), vec2(1, 0));
  });
});

describe("localToWorld / worldToLocal — round trips and rigidity", () => {
  const points: Vec2[] = [
    vec2(1, 0),
    vec2(0, 1),
    vec2(3, 4),
    vec2(-2, 5),
    vec2(0, 0),
    vec2(-1.5, -2.5),
  ];
  const origins: Vec2[] = [vec2(0, 0), vec2(10, 5), vec2(-3, -7), vec2(100, -50)];
  const angles = [0, Math.PI / 6, -Math.PI / 3, Math.PI, 2 * Math.PI, 7.5, -9.2];

  const cases: Array<[Vec2, Vec2, number]> = [];
  for (const p of points) {
    for (const o of origins) {
      for (const a of angles) {
        cases.push([p, o, a]);
      }
    }
  }

  it.each(cases)("worldToLocal(localToWorld(p=%o,o=%o,a=%p)) ~= p", (p, o, a) => {
    const world = localToWorld(p, o, a);
    const back = worldToLocal(world, o, a);
    expectVecClose(back, p);
  });

  it.each(cases)("localToWorld(worldToLocal(w=%o,o=%o,a=%p)) ~= w", (w, o, a) => {
    const local = worldToLocal(w, o, a);
    const back = localToWorld(local, o, a);
    expectVecClose(back, w);
  });

  it("distance between two local points is preserved in world coordinates (rigid transform)", () => {
    const o = vec2(5, -3);
    const a = 0.9;
    const p1 = vec2(1, 2);
    const p2 = vec2(-4, 6);
    const localDist = distance(p1, p2);
    const worldDist = distance(localToWorld(p1, o, a), localToWorld(p2, o, a));
    expect(worldDist).toBeCloseTo(localDist, 9);
  });
});
