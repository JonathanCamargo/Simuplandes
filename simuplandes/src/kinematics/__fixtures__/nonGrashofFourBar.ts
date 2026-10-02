/**
 * A non-Grashof (triple-rocker) four-bar: ground a1=100 (O2=(0,0),
 * O4=(100,0)), input a2=60, coupler a3=40, output a4=70. `s+l = 140 >
 * p+q = 130`, so no link can fully rotate relative to any other — the
 * crank itself only rocks between two law-of-cosines limit angles
 * (`fourBarLimitAngles` in `analytic.ts`). Reference crank angle 30
 * degrees; B is the "upper" `circleIntersection` branch (sign=+1), which
 * lands above the O2-O4 ground line. Rotary motor on O2.
 */

import { defineLink, makeDocument, circleIntersection } from "./build";
import { vec2 } from "../../geom";
import { poseFromWorldPoints, createId } from "../../model";
import type { MechanismDocument } from "../../model";

const groundLength = 100; // a1
const crankLength = 60; // a2
const couplerLength = 40; // a3
const rockerLength = 70; // a4
const referenceCrankAngle = Math.PI / 6; // 30 degrees

const O2 = vec2(0, 0);
const O4 = vec2(groundLength, 0);
const A = vec2(
  crankLength * Math.cos(referenceCrankAngle),
  crankLength * Math.sin(referenceCrankAngle),
);
const B = circleIntersection(A, couplerLength, O4, rockerLength, 1);

export const dims = {
  O2,
  O4,
  A,
  B,
  groundLength,
  crankLength,
  couplerLength,
  rockerLength,
  referenceCrankAngle,
};

export function build(): MechanismDocument {
  const ground = defineLink({
    name: "ground",
    isGround: true,
    origin: [O2.x, O2.y],
    sites: { O2: [O2.x, O2.y], O4: [O4.x, O4.y] },
  });

  const crankPose = poseFromWorldPoints(O2, A);
  const crank = defineLink({
    name: "crank",
    origin: crankPose.position,
    angle: crankPose.angle,
    sites: { O2: [O2.x, O2.y], A: [A.x, A.y] },
  });

  const couplerPose = poseFromWorldPoints(A, B);
  const coupler = defineLink({
    name: "coupler",
    origin: couplerPose.position,
    angle: couplerPose.angle,
    sites: { A: [A.x, A.y], B: [B.x, B.y] },
  });

  const rockerPose = poseFromWorldPoints(O4, B);
  const rocker = defineLink({
    name: "rocker",
    origin: rockerPose.position,
    angle: rockerPose.angle,
    sites: { O4: [O4.x, O4.y], B: [B.x, B.y] },
  });

  const jointO2Id = createId("joint");

  return makeDocument({
    schemaVersion: 1,
    name: "non-grashof-four-bar",
    links: [ground.link, crank.link, coupler.link, rocker.link],
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
}
