/**
 * A double parallelogram: ground pivots O2=(0,0), O4=(100,0), O6=(50,0);
 * three parallel cranks of length 40 at a 60-degree reference angle
 * (O2->A, O6->M, O4->B); a ternary coupler carrying A, M, B (50/50
 * spacing). 5 links (ground + crank + idler + rocker + coupler), 6 R
 * joints -> Gruebler F = 3*(5-1) - 2*6 = 0, yet it is mobile (rank DOF 1):
 * the structurally redundant case D5 calls for (a plain parallelogram
 * four-bar is NOT rank-deficient at a regular pose; this five-bar is the
 * classic textbook example that IS). Rotary motor on "O2".
 */

import { defineLink, makeDocument } from "./build";
import { vec2, add, fromPolar } from "../../geom";
import { poseFromWorldPoints, createId } from "../../model";
import type { MechanismDocument } from "../../model";

const crankLength = 40;
const referenceAngle = Math.PI / 3; // 60 degrees

const O2 = vec2(0, 0);
const O4 = vec2(100, 0);
const O6 = vec2(50, 0);

const offset = fromPolar(crankLength, referenceAngle);
const A = add(O2, offset);
const M = add(O6, offset);
const B = add(O4, offset);

export const dims = { O2, O4, O6, A, M, B, crankLength, referenceAngle };

export function build(): MechanismDocument {
  const ground = defineLink({
    name: "ground",
    isGround: true,
    origin: [O2.x, O2.y],
    sites: { O2: [O2.x, O2.y], O4: [O4.x, O4.y], O6: [O6.x, O6.y] },
  });

  const crankPose = poseFromWorldPoints(O2, A);
  const crank = defineLink({
    name: "crank",
    origin: crankPose.position,
    angle: crankPose.angle,
    sites: { O2: [O2.x, O2.y], A: [A.x, A.y] },
  });

  const idlerPose = poseFromWorldPoints(O6, M);
  const idler = defineLink({
    name: "idler",
    origin: idlerPose.position,
    angle: idlerPose.angle,
    sites: { O6: [O6.x, O6.y], M: [M.x, M.y] },
  });

  const rockerPose = poseFromWorldPoints(O4, B);
  const rocker = defineLink({
    name: "rocker",
    origin: rockerPose.position,
    angle: rockerPose.angle,
    sites: { O4: [O4.x, O4.y], B: [B.x, B.y] },
  });

  const couplerPose = poseFromWorldPoints(A, B);
  const coupler = defineLink({
    name: "coupler",
    origin: couplerPose.position,
    angle: couplerPose.angle,
    sites: { A: [A.x, A.y], M: [M.x, M.y], B: [B.x, B.y] },
  });

  const jointO2Id = createId("joint");

  return makeDocument({
    schemaVersion: 1,
    name: "double-parallelogram",
    links: [ground.link, crank.link, idler.link, rocker.link, coupler.link],
    joints: [
      { id: jointO2Id, name: "O2", type: "R", siteA: ground.siteIds.O2, siteB: crank.siteIds.O2 },
      {
        id: createId("joint"),
        name: "O6",
        type: "R",
        siteA: ground.siteIds.O6,
        siteB: idler.siteIds.O6,
      },
      {
        id: createId("joint"),
        name: "O4",
        type: "R",
        siteA: ground.siteIds.O4,
        siteB: rocker.siteIds.O4,
      },
      {
        id: createId("joint"),
        name: "A",
        type: "R",
        siteA: crank.siteIds.A,
        siteB: coupler.siteIds.A,
      },
      {
        id: createId("joint"),
        name: "M",
        type: "R",
        siteA: idler.siteIds.M,
        siteB: coupler.siteIds.M,
      },
      {
        id: createId("joint"),
        name: "B",
        type: "R",
        siteA: rocker.siteIds.B,
        siteB: coupler.siteIds.B,
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
