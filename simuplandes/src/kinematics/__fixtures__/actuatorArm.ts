/**
 * A linear-motor actuator on a rotating rail: a cylinder pivoted at G1
 * pushes a rod that is pinned to an arm's tip T, and the arm itself pivots
 * at G2. The rod is authored at `cylinder angle + 0.4 rad` (Common Pitfall
 * 1 again, on the linear-motor's own P joint this time). At the reference
 * pose the cylinder's and rod's sites coincide exactly at T, so the P
 * joint's residual is zero regardless of the authored angle offset.
 */

import { defineLink, makeDocument } from "./build";
import { vec2, distance } from "../../geom";
import { poseFromWorldPoints, createId } from "../../model";
import type { MechanismDocument } from "../../model";

const armLength = 80;
const armAngle = (2 * Math.PI) / 3; // 120 degrees from +x
const rodAngleOffset = 0.4;

const G1 = vec2(0, 0);
const G2 = vec2(200, 0);
const T = vec2(G2.x + armLength * Math.cos(armAngle), G2.y + armLength * Math.sin(armAngle));

export const dims = {
  G1,
  G2,
  T,
  armLength,
  armAngle,
  rodAngleOffset,
  cylinderLength: distance(G1, T),
};

export function build(): MechanismDocument {
  const ground = defineLink({
    name: "ground",
    isGround: true,
    origin: [G1.x, G1.y],
    sites: { G1: [G1.x, G1.y], G2: [G2.x, G2.y] },
  });

  const cylinderPose = poseFromWorldPoints(G1, T);
  const cylinder = defineLink({
    name: "cylinder",
    origin: cylinderPose.position,
    angle: cylinderPose.angle,
    sites: { G1: [G1.x, G1.y], T: [T.x, T.y] },
  });

  const rod = defineLink({
    name: "rod",
    origin: [T.x, T.y],
    angle: cylinderPose.angle + rodAngleOffset,
    sites: { T: [T.x, T.y] },
  });

  const armPose = poseFromWorldPoints(G2, T);
  const arm = defineLink({
    name: "arm",
    origin: armPose.position,
    angle: armPose.angle,
    sites: { G2: [G2.x, G2.y], T: [T.x, T.y] },
  });

  const strokeJointId = createId("joint");

  return makeDocument({
    schemaVersion: 1,
    name: "actuator-arm",
    links: [ground.link, cylinder.link, rod.link, arm.link],
    joints: [
      {
        id: createId("joint"),
        name: "G1",
        type: "R",
        siteA: ground.siteIds.G1,
        siteB: cylinder.siteIds.G1,
      },
      {
        id: strokeJointId,
        name: "stroke",
        type: "P",
        siteA: cylinder.siteIds.T,
        siteB: rod.siteIds.T,
        axis: [1, 0],
      },
      { id: createId("joint"), name: "T", type: "R", siteA: rod.siteIds.T, siteB: arm.siteIds.T },
      {
        id: createId("joint"),
        name: "G2",
        type: "R",
        siteA: arm.siteIds.G2,
        siteB: ground.siteIds.G2,
      },
    ],
    motors: [
      {
        id: createId("motor"),
        name: "stroke-motor",
        jointId: strokeJointId,
        kind: "linear",
        drive: { mode: "expression", expression: "20*sin(t)" },
      },
    ],
    markers: [],
  });
}
