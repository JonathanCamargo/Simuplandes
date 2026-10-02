/**
 * A synthetic 10-link, 13-joint, 1-DOF mechanism (D6: "the 10-bar atlas
 * mechanism" here is hand-built; GraphThe's real atlas arrives in Phase 6).
 * Extends `sixBars.ts`'s Stephenson III with two more RRR dyads off two
 * newly-ternary links: L5 (C-D) gains a third point E feeding L7-L8 to a
 * new ground pivot O8; L6 (D-O6) gains a third point G feeding L9-L10 to a
 * new ground pivot O10. 10 links (ground + 9 moving -> n = 27), 13 R
 * joints -> Gruebler `3*9 - 2*13 = 1`. A marker rides on L9.
 */

import { defineLink, makeDocument, circleIntersection } from "./build";
import { vec2, add, sub, rotate, direction, distance, fromPolar, type Vec2 } from "../../geom";
import { poseFromWorldPoints, createId } from "../../model";
import type { MechanismDocument } from "../../model";
import type { DyadChainSpec } from "./dyads";

const O2 = vec2(0, 0);
const O4 = vec2(100, 0);
const O6 = vec2(50, 180);
const O8 = vec2(-150, 100);
const O10 = vec2(250, 250);

const CRANK_LENGTH = 40;
const REFERENCE_ANGLE = Math.PI / 3; // 60 degrees, matches fourBar.ts/sixBars.ts
const A0 = add(O2, fromPolar(CRANK_LENGTH, REFERENCE_ANGLE));
const B_REF = vec2(110, 80);
const COUPLER_LENGTH = distance(A0, B_REF);
const ROCKER_LENGTH = distance(O4, B_REF);
const SAMPLES = 720;

function computeB(theta2: number, sign: 1 | -1): Vec2 {
  const A = add(O2, fromPolar(CRANK_LENGTH, theta2));
  return circleIntersection(A, COUPLER_LENGTH, O4, ROCKER_LENGTH, sign);
}

const SIGN_B: 1 | -1 =
  distance(computeB(REFERENCE_ANGLE, 1), B_REF) <= distance(computeB(REFERENCE_ANGLE, -1), B_REF)
    ? 1
    : -1;

const LOCAL_C = vec2(COUPLER_LENGTH / 2, 30);

function computeC(theta2: number): Vec2 {
  const A = add(O2, fromPolar(CRANK_LENGTH, theta2));
  const B = computeB(theta2, SIGN_B);
  return add(A, rotate(LOCAL_C, direction(sub(B, A))));
}

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

function sizeDyad(fn: (theta2: number) => Vec2, ground: Vec2, label: string): number {
  const { min, max } = sampleRange(fn, ground);
  const L = 0.75 * max;
  if (min < 0.2 * L) {
    throw new Error(
      `${label} dyad sizing: min=${min} < 0.2*L=${0.2 * L} (L=${L}); move ${label}'s ground pivot`,
    );
  }
  return L;
}

// Dyad 1 (Stephenson base, C-D-O6): L_CD ~= 129.26 (measured), O6 = (50, 180)
// is the plan's own starting guess and satisfies the sizing assert.
const L_CD = sizeDyad(computeC, O6, "C-D-O6");
const C_REF = computeC(REFERENCE_ANGLE);
const D_REF = circleIntersection(C_REF, L_CD, O6, L_CD, 1);

function computeD(theta2: number): Vec2 {
  const C = computeC(theta2);
  const plus = circleIntersection(C, L_CD, O6, L_CD, 1);
  const minus = circleIntersection(C, L_CD, O6, L_CD, -1);
  return distance(plus, D_REF) <= distance(minus, D_REF) ? plus : minus;
}

// Dyad 2 (E on L5, frame C->D, local (L_CD/2, 20), to O8 via L7-L8):
// measured min|E-O8| ~= 84.4, L_EF ~= 106.7, 0.2*L_EF ~= 21.3 -> O8 =
// (-150, 100) satisfies the sizing assert on the first try.
const LOCAL_E = vec2(L_CD / 2, 20);

function computeE(theta2: number): Vec2 {
  const C = computeC(theta2);
  const D = computeD(theta2);
  return add(C, rotate(LOCAL_E, direction(sub(D, C))));
}

const L_EF = sizeDyad(computeE, O8, "E-F-O8");
const E_REF = computeE(REFERENCE_ANGLE);
const F_REF = circleIntersection(E_REF, L_EF, O8, L_EF, 1);

// Dyad 3 (G on L6, frame D->O6, local (L_CD/2, -20), to O10 via L9-L10):
// measured min|G-O10| ~= 274.0, L_GH ~= 209.7, 0.2*L_GH ~= 41.9 -> O10 =
// (250, 250) satisfies the sizing assert on the first try.
const LOCAL_G = vec2(L_CD / 2, -20);

function computeG(theta2: number): Vec2 {
  const D = computeD(theta2);
  return add(D, rotate(LOCAL_G, direction(sub(O6, D))));
}

const L_GH = sizeDyad(computeG, O10, "G-H-O10");
const G_REF = computeG(REFERENCE_ANGLE);
const H_REF = circleIntersection(G_REF, L_GH, O10, L_GH, 1);

/** The 10-bar's document, its independent dyad-chain construction, and the joint-name -> point-name map. */
export interface TenBarFixture {
  readonly doc: MechanismDocument;
  readonly spec: DyadChainSpec;
  readonly jointPoint: ReadonlyMap<string, string>;
}

const JOINT_POINT = new Map<string, string>([
  ["O2", "O2"],
  ["A", "A"],
  ["B", "B"],
  ["O4", "O4"],
  ["C", "C"],
  ["D", "D"],
  ["O6", "O6"],
  ["E", "E"],
  ["F", "F"],
  ["O8", "O8"],
  ["G", "G"],
  ["H", "H"],
  ["O10", "O10"],
]);

export function build(): TenBarFixture {
  const ground = defineLink({
    name: "ground",
    isGround: true,
    origin: [O2.x, O2.y],
    sites: {
      O2: [O2.x, O2.y],
      O4: [O4.x, O4.y],
      O6: [O6.x, O6.y],
      O8: [O8.x, O8.y],
      O10: [O10.x, O10.y],
    },
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
    sites: { C: [C_REF.x, C_REF.y], D: [D_REF.x, D_REF.y], E: [E_REF.x, E_REF.y] },
  });

  const l6Pose = poseFromWorldPoints(D_REF, O6);
  const l6 = defineLink({
    name: "L6",
    origin: l6Pose.position,
    angle: l6Pose.angle,
    sites: { D: [D_REF.x, D_REF.y], O6: [O6.x, O6.y], G: [G_REF.x, G_REF.y] },
  });

  const l7Pose = poseFromWorldPoints(E_REF, F_REF);
  const l7 = defineLink({
    name: "L7",
    origin: l7Pose.position,
    angle: l7Pose.angle,
    sites: { E: [E_REF.x, E_REF.y], F: [F_REF.x, F_REF.y] },
  });

  const l8Pose = poseFromWorldPoints(F_REF, O8);
  const l8 = defineLink({
    name: "L8",
    origin: l8Pose.position,
    angle: l8Pose.angle,
    sites: { F: [F_REF.x, F_REF.y], O8: [O8.x, O8.y] },
  });

  const l9Pose = poseFromWorldPoints(G_REF, H_REF);
  const l9 = defineLink({
    name: "L9",
    origin: l9Pose.position,
    angle: l9Pose.angle,
    sites: { G: [G_REF.x, G_REF.y], H: [H_REF.x, H_REF.y] },
  });

  const l10Pose = poseFromWorldPoints(H_REF, O10);
  const l10 = defineLink({
    name: "L10",
    origin: l10Pose.position,
    angle: l10Pose.angle,
    sites: { H: [H_REF.x, H_REF.y], O10: [O10.x, O10.y] },
  });

  const jointO2Id = createId("joint");

  const doc = makeDocument({
    schemaVersion: 1,
    name: "ten-bar",
    links: [
      ground.link,
      crank.link,
      coupler.link,
      rocker.link,
      l5.link,
      l6.link,
      l7.link,
      l8.link,
      l9.link,
      l10.link,
    ],
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
      { id: createId("joint"), name: "E", type: "R", siteA: l5.siteIds.E, siteB: l7.siteIds.E },
      { id: createId("joint"), name: "F", type: "R", siteA: l7.siteIds.F, siteB: l8.siteIds.F },
      {
        id: createId("joint"),
        name: "O8",
        type: "R",
        siteA: l8.siteIds.O8,
        siteB: ground.siteIds.O8,
      },
      { id: createId("joint"), name: "G", type: "R", siteA: l6.siteIds.G, siteB: l9.siteIds.G },
      { id: createId("joint"), name: "H", type: "R", siteA: l9.siteIds.H, siteB: l10.siteIds.H },
      {
        id: createId("joint"),
        name: "O10",
        type: "R",
        siteA: l10.siteIds.O10,
        siteB: ground.siteIds.O10,
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
    markers: [
      {
        id: createId("marker"),
        name: "L9-tracer",
        linkId: l9.link.id,
        local: [distance(G_REF, H_REF) / 2, 10],
      },
    ],
  });

  const spec: DyadChainSpec = {
    ground: { O2, O4, O6, O8, O10 },
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
      { kind: "rigid", name: "C", base1: "A", base2: "B", local: LOCAL_C },
      {
        kind: "intersection",
        name: "D",
        center1: "C",
        radius1: L_CD,
        center2: "O6",
        radius2: L_CD,
      },
      { kind: "rigid", name: "E", base1: "C", base2: "D", local: LOCAL_E },
      {
        kind: "intersection",
        name: "F",
        center1: "E",
        radius1: L_EF,
        center2: "O8",
        radius2: L_EF,
      },
      { kind: "rigid", name: "G", base1: "D", base2: "O6", local: LOCAL_G },
      {
        kind: "intersection",
        name: "H",
        center1: "G",
        radius1: L_GH,
        center2: "O10",
        radius2: L_GH,
      },
    ],
    referencePoints: { B: B_REF, D: D_REF, F: F_REF, H: H_REF },
  };

  return { doc, spec, jointPoint: JOINT_POINT };
}
