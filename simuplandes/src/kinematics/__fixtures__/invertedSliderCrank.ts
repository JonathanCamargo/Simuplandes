/**
 * Inverted slider-crank / crank-shaper (Whitworth-style): the prismatic
 * joint's rail is carried by the ROCKER, so it rotates with the mechanism
 * (unlike a straight slider-crank's fixed rail). The block is authored at
 * `rocker angle + 0.4 rad` (Common Pitfall 1: the two P-joint links'
 * reference angles differ by a non-zero, non-arbitrary amount).
 */

import { defineLink, makeDocument } from "./build";
import { vec2 } from "../../geom";
import { poseFromWorldPoints, createId } from "../../model";
import type { MechanismDocument } from "../../model";

const crankLength = 40;
const referenceCrankAngle = Math.PI / 6; // 30 degrees
const blockAngleOffset = 0.4;

const O2 = vec2(0, 0);
const O4 = vec2(0, -100);
const A = vec2(
  crankLength * Math.cos(referenceCrankAngle),
  crankLength * Math.sin(referenceCrankAngle),
);

export const dims = { O2, O4, A, crankLength, referenceCrankAngle, blockAngleOffset };

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

  // The rocker's local +x axis points from O4 toward A at the reference pose,
  // so the slot's axis (cylinder-local +x, per the P-joint convention) needs
  // no rotation offset of its own.
  const rockerPose = poseFromWorldPoints(O4, A);
  const rocker = defineLink({
    name: "rocker",
    origin: rockerPose.position,
    angle: rockerPose.angle,
    sites: { O4: [O4.x, O4.y] },
  });

  const block = defineLink({
    name: "block",
    origin: [A.x, A.y],
    angle: rockerPose.angle + blockAngleOffset,
    sites: { A: [A.x, A.y] },
  });

  const jointO2Id = createId("joint");

  return makeDocument({
    schemaVersion: 1,
    name: "inverted-slider-crank",
    links: [ground.link, crank.link, rocker.link, block.link],
    joints: [
      { id: jointO2Id, name: "O2", type: "R", siteA: ground.siteIds.O2, siteB: crank.siteIds.O2 },
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
        siteB: block.siteIds.A,
      },
      {
        id: createId("joint"),
        name: "slot",
        type: "P",
        siteA: rocker.siteIds.O4,
        siteB: block.siteIds.A,
        axis: [1, 0],
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
