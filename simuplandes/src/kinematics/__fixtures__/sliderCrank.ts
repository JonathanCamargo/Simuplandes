/**
 * An offset slider-crank: crank r=40 about O2=(0,0), coupler l=120, offset
 * e=10. The slider pin moves on the line y=e. Reference crank angle 30 deg,
 * pin position from the closed form (research prototype's `march`, adapted).
 */

import { defineLink, makeDocument } from "./build";
import { vec2 } from "../../geom";
import { poseFromWorldPoints, createId } from "../../model";
import type { MechanismDocument } from "../../model";

const crankLength = 40;
const couplerLength = 120;
const offset = 10;
const referenceCrankAngle = Math.PI / 6; // 30 degrees

const O2 = vec2(0, 0);
const A = vec2(
  crankLength * Math.cos(referenceCrankAngle),
  crankLength * Math.sin(referenceCrankAngle),
);
// Closed-form slider position along the rail (y = offset) at the reference crank angle.
const slideAlongAxis =
  crankLength * Math.cos(referenceCrankAngle) +
  Math.sqrt(
    couplerLength * couplerLength -
      Math.pow(crankLength * Math.sin(referenceCrankAngle) - offset, 2),
  );
const P = vec2(slideAlongAxis, offset);
const railAnchor = vec2(0, offset);

export const dims = {
  O2,
  A,
  P,
  railAnchor,
  crankLength,
  couplerLength,
  offset,
  referenceCrankAngle,
};

export function build(): MechanismDocument {
  const ground = defineLink({
    name: "ground",
    isGround: true,
    origin: [O2.x, O2.y],
    sites: { O2: [O2.x, O2.y], rail: [railAnchor.x, railAnchor.y] },
  });

  const crankPose = poseFromWorldPoints(O2, A);
  const crank = defineLink({
    name: "crank",
    origin: crankPose.position,
    angle: crankPose.angle,
    sites: { O2: [O2.x, O2.y], A: [A.x, A.y] },
  });

  const couplerPose = poseFromWorldPoints(A, P);
  const coupler = defineLink({
    name: "coupler",
    origin: couplerPose.position,
    angle: couplerPose.angle,
    sites: { A: [A.x, A.y], P: [P.x, P.y] },
  });

  const slider = defineLink({
    name: "slider",
    origin: [P.x, P.y],
    angle: 0,
    sites: { P: [P.x, P.y] },
  });

  const jointO2Id = createId("joint");

  return makeDocument({
    schemaVersion: 1,
    name: "slider-crank",
    links: [ground.link, crank.link, coupler.link, slider.link],
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
        name: "P",
        type: "R",
        siteA: coupler.siteIds.P,
        siteB: slider.siteIds.P,
      },
      {
        id: createId("joint"),
        name: "rail",
        type: "P",
        siteA: ground.siteIds.rail,
        siteB: slider.siteIds.P,
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
