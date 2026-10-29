/**
 * A symmetric 2-DOF five-bar: two ground cranks (O2-A, O5-B) joined at P by
 * two distal links, with a motor on each ground pivot -- the minimal
 * mechanism the transport drives with more than one motor.
 */

import { defineLink, makeDocument } from "./build";
import { vec2 } from "../../geom";
import { poseFromWorldPoints, createId } from "../../model";
import type { MechanismDocument } from "../../model";

const O2 = vec2(0, 0);
const O5 = vec2(80, 0);
const A = vec2(0, 40);
const B = vec2(80, 40);
const P = vec2(40, 80);

export const dims = { O2, O5, A, B, P };

export function build(): MechanismDocument {
  const ground = defineLink({
    name: "ground",
    isGround: true,
    origin: [O2.x, O2.y],
    sites: { O2: [O2.x, O2.y], O5: [O5.x, O5.y] },
  });

  const leftCrankPose = poseFromWorldPoints(O2, A);
  const leftCrank = defineLink({
    name: "left-crank",
    origin: leftCrankPose.position,
    angle: leftCrankPose.angle,
    sites: { O2: [O2.x, O2.y], A: [A.x, A.y] },
  });

  const leftDistalPose = poseFromWorldPoints(A, P);
  const leftDistal = defineLink({
    name: "left-distal",
    origin: leftDistalPose.position,
    angle: leftDistalPose.angle,
    sites: { A: [A.x, A.y], P: [P.x, P.y] },
  });

  const rightDistalPose = poseFromWorldPoints(B, P);
  const rightDistal = defineLink({
    name: "right-distal",
    origin: rightDistalPose.position,
    angle: rightDistalPose.angle,
    sites: { B: [B.x, B.y], P: [P.x, P.y] },
  });

  const rightCrankPose = poseFromWorldPoints(O5, B);
  const rightCrank = defineLink({
    name: "right-crank",
    origin: rightCrankPose.position,
    angle: rightCrankPose.angle,
    sites: { O5: [O5.x, O5.y], B: [B.x, B.y] },
  });

  const jointO2Id = createId("joint");
  const jointO5Id = createId("joint");

  return makeDocument({
    schemaVersion: 2,
    name: "five-bar",
    links: [ground.link, leftCrank.link, leftDistal.link, rightDistal.link, rightCrank.link],
    joints: [
      {
        id: jointO2Id,
        name: "O2",
        type: "R",
        siteA: ground.siteIds.O2,
        siteB: leftCrank.siteIds.O2,
      },
      {
        id: createId("joint"),
        name: "A",
        type: "R",
        siteA: leftCrank.siteIds.A,
        siteB: leftDistal.siteIds.A,
      },
      {
        id: createId("joint"),
        name: "P",
        type: "R",
        siteA: leftDistal.siteIds.P,
        siteB: rightDistal.siteIds.P,
      },
      {
        id: createId("joint"),
        name: "B",
        type: "R",
        siteA: rightDistal.siteIds.B,
        siteB: rightCrank.siteIds.B,
      },
      {
        id: jointO5Id,
        name: "O5",
        type: "R",
        siteA: ground.siteIds.O5,
        siteB: rightCrank.siteIds.O5,
      },
    ],
    motors: [
      {
        id: createId("motor"),
        name: "left-motor",
        jointId: jointO2Id,
        kind: "rotary",
        drive: { mode: "constant", speed: 1 },
      },
      {
        id: createId("motor"),
        name: "right-motor",
        jointId: jointO5Id,
        kind: "rotary",
        drive: { mode: "constant", speed: -1 },
      },
    ],
    markers: [
      {
        id: createId("marker"),
        name: "end-effector",
        linkId: leftDistal.link.id,
        local: [Math.hypot(P.x - A.x, P.y - A.y), 0],
      },
    ],
  });
}
