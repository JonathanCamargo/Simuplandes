/**
 * A Grashof crank-rocker four-bar (s=40, l~100.78, p=100, q~80.62) — the
 * same geometry as `src/store/examples.ts`'s `buildExampleFourBar`, built
 * directly as a `MechanismDocument` (no store, no React).
 */

import { defineLink, makeDocument } from "./build";
import { vec2, distance } from "../../geom";
import { poseFromWorldPoints, createId } from "../../model";
import type { MechanismDocument } from "../../model";

const O2 = vec2(0, 0);
const O4 = vec2(100, 0);
const A = vec2(20, 20 * Math.sqrt(3)); // crank length 40 at 60 degrees
const B = vec2(110, 80);

export const dims = {
  O2,
  O4,
  A,
  B,
  crankLength: distance(O2, A),
  groundLength: distance(O2, O4),
  couplerLength: distance(A, B),
  rockerLength: distance(O4, B),
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
    name: "four-bar",
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
    markers: [
      {
        id: createId("marker"),
        name: "coupler-tracer",
        linkId: coupler.link.id,
        local: [dims.couplerLength / 2, 30],
      },
    ],
  });
}
