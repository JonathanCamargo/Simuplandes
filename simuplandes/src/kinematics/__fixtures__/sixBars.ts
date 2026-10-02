/**
 * Watt II and Stephenson III six-bar fixtures for the validation suite,
 * built on the same base four-bar geometry as `fourBar.ts` (O2=(0,0),
 * O4=(100,0), crank 40 at 60 degrees, B=(110,80)). Each builder also
 * returns the `DyadChainSpec` (`dyads.ts`) that independently reconstructs
 * every joint's world position from `theta2` alone, for the validation
 * test to compare the solver's own output against.
 */

import { defineLink, makeDocument, circleIntersection } from "./build";
import { vec2, add, sub, rotate, direction, distance, fromPolar, type Vec2 } from "../../geom";
import { poseFromWorldPoints, createId } from "../../model";
import type { MechanismDocument } from "../../model";
import type { DyadChainSpec } from "./dyads";

const O2 = vec2(0, 0);
const O4 = vec2(100, 0);
const CRANK_LENGTH = 40;
const REFERENCE_ANGLE = Math.PI / 3; // 60 degrees, matches fourBar.ts
const A0 = add(O2, fromPolar(CRANK_LENGTH, REFERENCE_ANGLE));
const B_REF = vec2(110, 80); // matches fourBar.ts's authored B
const COUPLER_LENGTH = distance(A0, B_REF);
const ROCKER_LENGTH = distance(O4, B_REF);
const SAMPLES = 720;

function computeB(theta2: number, sign: 1 | -1): Vec2 {
  const A = add(O2, fromPolar(CRANK_LENGTH, theta2));
  return circleIntersection(A, COUPLER_LENGTH, O4, ROCKER_LENGTH, sign);
}

// Which root of the coupler/rocker circle intersection reproduces the
// authored B_REF at the reference crank angle -- captured once here, the
// same way `dyads.ts`'s own `captureSigns` will independently capture it
// again from the `DyadChainSpec` below.
const SIGN_B: 1 | -1 =
  distance(computeB(REFERENCE_ANGLE, 1), B_REF) <= distance(computeB(REFERENCE_ANGLE, -1), B_REF)
    ? 1
    : -1;

function sampleRange(fn: (theta2: number) => Vec2, center: Vec2): { min: number; max: number } {
  let min = Infinity;
  let max = 0;
  for (let i = 0; i < SAMPLES; i++) {
    const theta2 = (i / SAMPLES) * 2 * Math.PI;
    const d = distance(fn(theta2), center);
    if (d < min) min = d;
    if (d > max) max = d;
  }
  return { min, max };
}

/** Dyad sizing rule (D6/plan): `L = 0.75*maxDist`; asserts `minDist >= 0.2*L`. */
function sizeDyad(fn: (theta2: number) => Vec2, o6: Vec2, label: string): number {
  const { min, max } = sampleRange(fn, o6);
  const L = 0.75 * max;
  if (min < 0.2 * L) {
    throw new Error(`${label} dyad sizing: min|C-O6|=${min} < 0.2*L=${0.2 * L} (L=${L}); move O6`);
  }
  return L;
}

/** A builder's document plus the independent construction to validate it against. */
export interface SixBarFixture {
  readonly doc: MechanismDocument;
  readonly spec: DyadChainSpec;
  readonly jointPoint: ReadonlyMap<string, string>;
}

const SHARED_JOINT_POINT = new Map<string, string>([
  ["O2", "O2"],
  ["A", "A"],
  ["B", "B"],
  ["O4", "O4"],
  ["C", "C"],
  ["D", "D"],
  ["O6", "O6"],
]);

/**
 * Watt II: the rocker (O4-B) is ternary, carrying a third point C (local
 * `(40, -25)` in the O4->B frame). Ground gains O6; the dyad C-D-O6
 * (`L5` = C-D, `L6` = D-O6) hangs off the rocker. The two ternary links
 * (ground and rocker) are ADJACENT (both meet at O4) -- the defining
 * feature of a Watt six-bar. `O6 = (220, 60)` was the plan's own starting
 * guess and satisfies the sizing assert on the first try (measured
 * min|C-O6| ~= 91.1, L ~= 103.1, 0.2*L ~= 20.6).
 */
export function buildWattII(): SixBarFixture {
  const localC = vec2(40, -25);

  function computeC(theta2: number): Vec2 {
    const B = computeB(theta2, SIGN_B);
    return add(O4, rotate(localC, direction(sub(B, O4))));
  }

  const O6 = vec2(220, 60);
  const L = sizeDyad(computeC, O6, "Watt II");

  const C_REF = computeC(REFERENCE_ANGLE);
  const D_REF = circleIntersection(C_REF, L, O6, L, 1);

  const ground = defineLink({
    name: "ground",
    isGround: true,
    origin: [O2.x, O2.y],
    sites: { O2: [O2.x, O2.y], O4: [O4.x, O4.y], O6: [O6.x, O6.y] },
  });

  const crankPose = poseFromWorldPoints(O2, A0);
  const crank = defineLink({
    name: "crank",
    origin: crankPose.position,
    angle: crankPose.angle,
    sites: { O2: [O2.x, O2.y], A: [A0.x, A0.y] },
  });

  const couplerPose = poseFromWorldPoints(A0, B_REF);
  const coupler = defineLink({
    name: "coupler",
    origin: couplerPose.position,
    angle: couplerPose.angle,
    sites: { A: [A0.x, A0.y], B: [B_REF.x, B_REF.y] },
  });

  const rockerPose = poseFromWorldPoints(O4, B_REF);
  const rocker = defineLink({
    name: "rocker",
    origin: rockerPose.position,
    angle: rockerPose.angle,
    sites: { O4: [O4.x, O4.y], B: [B_REF.x, B_REF.y], C: [C_REF.x, C_REF.y] },
  });

  const l5Pose = poseFromWorldPoints(C_REF, D_REF);
  const l5 = defineLink({
    name: "L5",
    origin: l5Pose.position,
    angle: l5Pose.angle,
    sites: { C: [C_REF.x, C_REF.y], D: [D_REF.x, D_REF.y] },
  });

  const l6Pose = poseFromWorldPoints(D_REF, O6);
  const l6 = defineLink({
    name: "L6",
    origin: l6Pose.position,
    angle: l6Pose.angle,
    sites: { D: [D_REF.x, D_REF.y], O6: [O6.x, O6.y] },
  });

  const jointO2Id = createId("joint");

  const doc = makeDocument({
    schemaVersion: 1,
    name: "watt-ii",
    links: [ground.link, crank.link, coupler.link, rocker.link, l5.link, l6.link],
    joints: [
      { id: jointO2Id, name: "O2", type: "R", siteA: ground.siteIds.O2, siteB: crank.siteIds.O2 },
      {
        id: createId("joint"),
        name: "A",
        type: "R",
        siteA: crank.siteIds.A,
        siteB: coupler.siteIds.A,
      },
      {
        id: createId("joint"),
        name: "B",
        type: "R",
        siteA: coupler.siteIds.B,
        siteB: rocker.siteIds.B,
      },
      {
        id: createId("joint"),
        name: "O4",
        type: "R",
        siteA: rocker.siteIds.O4,
        siteB: ground.siteIds.O4,
      },
      {
        id: createId("joint"),
        name: "C",
        type: "R",
        siteA: rocker.siteIds.C,
        siteB: l5.siteIds.C,
      },
      { id: createId("joint"), name: "D", type: "R", siteA: l5.siteIds.D, siteB: l6.siteIds.D },
      {
        id: createId("joint"),
        name: "O6",
        type: "R",
        siteA: l6.siteIds.O6,
        siteB: ground.siteIds.O6,
      },
    ],
    motors: [
      {
        id: createId("motor"),
        name: "crank-motor",
        jointId: jointO2Id,
        kind: "rotary",
        drive: { mode: "constant", speed: 1 },
      },
    ],
    markers: [],
  });

  const spec: DyadChainSpec = {
    ground: { O2, O4, O6 },
    crank: {
      pivotName: "O2",
      pointName: "A",
      length: CRANK_LENGTH,
      referenceAngle: REFERENCE_ANGLE,
    },
    steps: [
      {
        kind: "intersection",
        name: "B",
        center1: "A",
        radius1: COUPLER_LENGTH,
        center2: "O4",
        radius2: ROCKER_LENGTH,
      },
      { kind: "rigid", name: "C", base1: "O4", base2: "B", local: localC },
      { kind: "intersection", name: "D", center1: "C", radius1: L, center2: "O6", radius2: L },
    ],
    referencePoints: { B: B_REF, D: D_REF },
  };

  return { doc, spec, jointPoint: SHARED_JOINT_POINT };
}

/**
 * Stephenson III: the coupler (A-B) is ternary, carrying a third point C
 * at `(couplerLength/2, 30)` in the A->B frame (the same location as
 * `fourBar.ts`'s own coupler-tracer marker). Ground gains O6; the dyad
 * C-D-O6 hangs off the coupler. The two ternary links (coupler and
 * ground) are NOT adjacent (they don't share a joint) -- the defining
 * feature of a Stephenson six-bar. `O6 = (50, 180)` was the plan's own
 * starting guess and satisfies the sizing assert on the first try
 * (measured min|C-O6| ~= 93.1, L ~= 129.3, 0.2*L ~= 25.9).
 */
export function buildStephensonIII(): SixBarFixture {
  function computeC(theta2: number): Vec2 {
    const A = add(O2, fromPolar(CRANK_LENGTH, theta2));
    const B = computeB(theta2, SIGN_B);
    const local = vec2(COUPLER_LENGTH / 2, 30);
    return add(A, rotate(local, direction(sub(B, A))));
  }

  const O6 = vec2(50, 180);
  const L = sizeDyad(computeC, O6, "Stephenson III");

  const C_REF = computeC(REFERENCE_ANGLE);
  const D_REF = circleIntersection(C_REF, L, O6, L, 1);
  const localC = vec2(COUPLER_LENGTH / 2, 30);

  const ground = defineLink({
    name: "ground",
    isGround: true,
    origin: [O2.x, O2.y],
    sites: { O2: [O2.x, O2.y], O4: [O4.x, O4.y], O6: [O6.x, O6.y] },
  });

  const crankPose = poseFromWorldPoints(O2, A0);
  const crank = defineLink({
    name: "crank",
    origin: crankPose.position,
    angle: crankPose.angle,
    sites: { O2: [O2.x, O2.y], A: [A0.x, A0.y] },
  });

  const couplerPose = poseFromWorldPoints(A0, B_REF);
  const coupler = defineLink({
    name: "coupler",
    origin: couplerPose.position,
    angle: couplerPose.angle,
    sites: { A: [A0.x, A0.y], B: [B_REF.x, B_REF.y], C: [C_REF.x, C_REF.y] },
  });

  const rockerPose = poseFromWorldPoints(O4, B_REF);
  const rocker = defineLink({
    name: "rocker",
    origin: rockerPose.position,
    angle: rockerPose.angle,
    sites: { O4: [O4.x, O4.y], B: [B_REF.x, B_REF.y] },
  });

  const l5Pose = poseFromWorldPoints(C_REF, D_REF);
  const l5 = defineLink({
    name: "L5",
    origin: l5Pose.position,
    angle: l5Pose.angle,
    sites: { C: [C_REF.x, C_REF.y], D: [D_REF.x, D_REF.y] },
  });

  const l6Pose = poseFromWorldPoints(D_REF, O6);
  const l6 = defineLink({
    name: "L6",
    origin: l6Pose.position,
    angle: l6Pose.angle,
    sites: { D: [D_REF.x, D_REF.y], O6: [O6.x, O6.y] },
  });

  const jointO2Id = createId("joint");

  const doc = makeDocument({
    schemaVersion: 1,
    name: "stephenson-iii",
    links: [ground.link, crank.link, coupler.link, rocker.link, l5.link, l6.link],
    joints: [
      { id: jointO2Id, name: "O2", type: "R", siteA: ground.siteIds.O2, siteB: crank.siteIds.O2 },
      {
        id: createId("joint"),
        name: "A",
        type: "R",
        siteA: crank.siteIds.A,
        siteB: coupler.siteIds.A,
      },
      {
        id: createId("joint"),
        name: "B",
        type: "R",
        siteA: coupler.siteIds.B,
        siteB: rocker.siteIds.B,
      },
      {
        id: createId("joint"),
        name: "O4",
        type: "R",
        siteA: rocker.siteIds.O4,
        siteB: ground.siteIds.O4,
      },
      {
        id: createId("joint"),
        name: "C",
        type: "R",
        siteA: coupler.siteIds.C,
        siteB: l5.siteIds.C,
      },
      { id: createId("joint"), name: "D", type: "R", siteA: l5.siteIds.D, siteB: l6.siteIds.D },
      {
        id: createId("joint"),
        name: "O6",
        type: "R",
        siteA: l6.siteIds.O6,
        siteB: ground.siteIds.O6,
      },
    ],
    motors: [
      {
        id: createId("motor"),
        name: "crank-motor",
        jointId: jointO2Id,
        kind: "rotary",
        drive: { mode: "constant", speed: 1 },
      },
    ],
    markers: [],
  });

  const spec: DyadChainSpec = {
    ground: { O2, O4, O6 },
    crank: {
      pivotName: "O2",
      pointName: "A",
      length: CRANK_LENGTH,
      referenceAngle: REFERENCE_ANGLE,
    },
    steps: [
      {
        kind: "intersection",
        name: "B",
        center1: "A",
        radius1: COUPLER_LENGTH,
        center2: "O4",
        radius2: ROCKER_LENGTH,
      },
      { kind: "rigid", name: "C", base1: "A", base2: "B", local: localC },
      { kind: "intersection", name: "D", center1: "C", radius1: L, center2: "O6", radius2: L },
    ],
    referencePoints: { B: B_REF, D: D_REF },
  };

  return { doc, spec, jointPoint: SHARED_JOINT_POINT };
}
