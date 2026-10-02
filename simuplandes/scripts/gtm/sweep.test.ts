import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { sweepFixture } from "./sweep";
import { GtmFixtureSchema, parseGtmFixture, sizeOf, type GtmFixture } from "./fixture";
import { circleIntersection } from "../../src/kinematics/__fixtures__/build";
import { vec2, add, sub, rotate, direction, distance, fromPolar } from "../../src/geom";

const FIXTURES_DIR = join(import.meta.dirname, "..", "..", "fixtures");

const O2 = vec2(0, 0);
const O4 = vec2(100, 0);
const CRANK_LENGTH = 40;
const REFERENCE_ANGLE = Math.PI / 3;
const A = add(O2, fromPolar(CRANK_LENGTH, REFERENCE_ANGLE));
const B = vec2(110, 80);
const COUPLER_LENGTH = distance(A, B);
const ROCKER_LENGTH = distance(O4, B);

function fourBarFixture(inputEdge: "O2" | "O4"): GtmFixture {
  const couplerAngle = direction(sub(B, A));
  const markerLocal = vec2(COUPLER_LENGTH / 2, 30);
  const markerWorld = add(A, rotate(markerLocal, couplerAngle));

  return GtmFixtureSchema.parse({
    format: "simuplandes-parity-fixture",
    version: 0,
    name: inputEdge === "O2" ? "test-crank-rocker" : "test-double-rocker",
    graph: {
      nodes: [
        { id: 0, link_type: "ground" },
        { id: 1, link_type: "binary" },
        { id: 2, link_type: "binary" },
        { id: 3, link_type: "binary" },
      ],
      edges: [
        { source: 0, target: 1, pos: [O2.x, O2.y], input: inputEdge === "O2" },
        { source: 1, target: 2, pos: [A.x, A.y] },
        { source: 2, target: 3, pos: [B.x, B.y] },
        { source: 3, target: 0, pos: [O4.x, O4.y], input: inputEdge === "O4" },
      ],
    },
    markers: [{ link: 2, pos: [markerWorld.x, markerWorld.y] }],
  });
}

function computeB(theta2: number, sign: 1 | -1) {
  const a = add(O2, fromPolar(CRANK_LENGTH, theta2));
  return circleIntersection(a, COUPLER_LENGTH, O4, ROCKER_LENGTH, sign);
}

const SIGN_B: 1 | -1 =
  distance(computeB(REFERENCE_ANGLE, 1), B) <= distance(computeB(REFERENCE_ANGLE, -1), B) ? 1 : -1;

function isSingleContiguousCyclicRun(solved: readonly boolean[]): boolean {
  const n = solved.length;
  if (!solved.some(Boolean)) return false;
  if (solved.every(Boolean)) return true;
  // Count transitions false->true walking the cycle; exactly one such
  // transition means the trues form one contiguous cyclic run.
  let transitions = 0;
  for (let i = 0; i < n; i++) {
    const prev = solved[(i - 1 + n) % n];
    if (!prev && solved[i]) transitions++;
  }
  return transitions === 1;
}

describe("sweepFixture — crank-rocker (Grashof, crank is the input)", () => {
  const fx = fourBarFixture("O2");
  const curve = sweepFixture(fx);

  it("returns 360 solved samples, kind full-rotation", () => {
    expect(curve.nSamples).toBe(360);
    expect(curve.reachable.kind).toBe("full-rotation");
    for (const p of curve.joints["0-1"]) expect(p).not.toBeNull();
  });

  it("the input link's world direction equals the grid angle at every sample (phi = theta - thetaRef)", () => {
    // joint "0-1" is the fixed ground pivot O2 itself (constant); the
    // crank's rotating tip is joint "1-2" (crank<->coupler, point A).
    const jointA = curve.joints["1-2"];
    for (let i = 0; i < curve.nSamples; i++) {
      const p = jointA[i];
      if (!p) throw new Error(`sample ${i} unexpectedly null`);
      const gridAngle = (2 * Math.PI * i) / curve.nSamples;
      const actualAngle = Math.atan2(p[1] - O2.y, p[0] - O2.x);
      const wrappedActual = ((actualAngle % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
      const wrappedGrid = ((gridAngle % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
      let diff = Math.abs(wrappedActual - wrappedGrid);
      if (diff > Math.PI) diff = 2 * Math.PI - diff;
      expect(diff).toBeLessThan(1e-9);
    }
  });

  it("the coupler joint matches an independent circle-intersection reconstruction", () => {
    const jointB = curve.joints["2-3"];
    const size = sizeOf(fx);
    for (let i = 0; i < curve.nSamples; i++) {
      const p = jointB[i];
      if (!p) throw new Error(`sample ${i} unexpectedly null`);
      const theta = (2 * Math.PI * i) / curve.nSamples;
      const expected = computeB(theta, SIGN_B);
      const d = Math.hypot(p[0] - expected.x, p[1] - expected.y);
      expect(d).toBeLessThan(1e-9 * size);
    }
  });
});

describe("sweepFixture — double-rocker (rocker is the input, bounded range)", () => {
  const fx = fourBarFixture("O4");
  const curve = sweepFixture(fx);

  it("returns kind bounded with nulls outside one contiguous cyclic arc containing thetaRef", () => {
    expect(curve.reachable.kind).toBe("bounded");
    const solved = curve.joints["0-3"].map((p) => p !== null);
    expect(solved.some(Boolean)).toBe(true);
    expect(isSingleContiguousCyclicRun(solved)).toBe(true);
    expect(curve.reachable.thetaMin).toBeLessThanOrEqual(curve.thetaRef);
    expect(curve.reachable.thetaMax).toBeGreaterThanOrEqual(curve.thetaRef);
  });
});

describe("sweepFixture — slider-crank (ground owns the prismatic rail)", () => {
  const text = readFileSync(join(FIXTURES_DIR, "slider-crank.gtm.json"), "utf8");
  const fx = parseGtmFixture(text);
  const curve = sweepFixture(fx);
  const size = sizeOf(fx);
  const railEdge = fx.graph.edges.find(
    (e) => e.source === 0 && e.target === 3 && e.type === "prismatic",
  );
  if (!railEdge) throw new Error("fixture missing the (0,3) prismatic rail edge");
  const railRefPos = railEdge.pos;

  it("returns 360 solved samples, kind full-rotation", () => {
    expect(curve.nSamples).toBe(360);
    expect(curve.reachable.kind).toBe("full-rotation");
    for (const p of curve.joints["0-3"]) expect(p).not.toBeNull();
  });

  it("joint 0-3 (the owner side, on ground) equals the reference rail point at every sample", () => {
    for (const p of curve.joints["0-3"]) {
      if (!p) throw new Error("sample unexpectedly null");
      const d = Math.hypot(p[0] - railRefPos[0], p[1] - railRefPos[1]);
      expect(d).toBeLessThan(1e-9 * size);
    }
  });

  it("the slider marker's y stays 18 within 1e-9*size (rides the rail at offset+8)", () => {
    const sliderMarkerIndex = fx.markers.findIndex((m) => m.link === 3);
    expect(sliderMarkerIndex).toBeGreaterThanOrEqual(0);
    const sliderMarkerCurve = curve.markers[sliderMarkerIndex];
    for (const p of sliderMarkerCurve) {
      if (!p) throw new Error("sample unexpectedly null");
      expect(Math.abs(p[1] - 18)).toBeLessThan(1e-9 * size);
    }
  });

  it("the coupler joint 2-3 lies on y=10 within 1e-9*size (the pin rides the rail)", () => {
    for (const p of curve.joints["2-3"]) {
      if (!p) throw new Error("sample unexpectedly null");
      expect(Math.abs(p[1] - 10)).toBeLessThan(1e-9 * size);
    }
  });
});
