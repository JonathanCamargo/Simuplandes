/**
 * KIN-05 fixtures: mechanisms authored so a joint's two sites do NOT
 * coincide at the reference pose -- `assemble()`'s job is either to pull
 * them shut (`openFourBar`) or to report the joints that cannot close
 * (`impossibleFourBar`, `unnamedImpossibleFourBar`, `groundPairViolation`).
 * Every link is still built as a genuinely rigid body (fixed local site
 * offsets); only the AUTHORED pose is wrong, exactly like a user having
 * dragged a link's endpoint without re-solving.
 */

import { defineLink, makeDocument } from "./build";
import { vec2, add, sub, rotate, normalize, scale, distance } from "../../geom";
import { poseFromWorldPoints, createId } from "../../model";
import type { MechanismDocument } from "../../model";

// The same reference geometry as fourBar.ts.
const O2 = vec2(0, 0);
const O4 = vec2(100, 0);
const A = vec2(20, 20 * Math.sqrt(3)); // crank length 40 at 60 degrees
const B = vec2(110, 80);

const TWELVE_DEGREES = (12 * Math.PI) / 180;

/**
 * The correctly-built fourBar, but the coupler's whole pose is shifted 5mm
 * in world x, and the rocker's pose is rotated 12 degrees about O4 -- two
 * independent authoring errors on the two "floating" links. Both links
 * keep their own correct local shape (still rigid; a link's own two sites
 * stay the same distance apart), so `assemble()` can pull the mechanism
 * shut without changing any link's length.
 */
export function openFourBar(): MechanismDocument {
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

  // Coupler: whole pose (origin + both sites) shifted +5mm in x, so its
  // own local geometry (hence its own length) is untouched.
  const couplerShift = vec2(5, 0);
  const couplerPoseCorrect = poseFromWorldPoints(A, B);
  const couplerOriginWrong = add(vec2(...couplerPoseCorrect.position), couplerShift);
  const aWrong = add(A, couplerShift);
  const bWrongFromCoupler = add(B, couplerShift);
  const coupler = defineLink({
    name: "coupler",
    origin: [couplerOriginWrong.x, couplerOriginWrong.y],
    angle: couplerPoseCorrect.angle,
    sites: { A: [aWrong.x, aWrong.y], B: [bWrongFromCoupler.x, bWrongFromCoupler.y] },
  });

  // Rocker: pivot O4 stays put, but the pose is rotated 12 degrees about
  // it (as if the rocker were dragged around its own ground pin), so its
  // B site lands ~2*rockerLength*sin(6deg) (~17mm) away from where the
  // coupler's B site actually is.
  const bWrongFromRocker = add(O4, rotate(sub(B, O4), TWELVE_DEGREES));
  const rockerPoseWrong = poseFromWorldPoints(O4, bWrongFromRocker);
  const rocker = defineLink({
    name: "rocker",
    origin: rockerPoseWrong.position,
    angle: rockerPoseWrong.angle,
    sites: { O4: [O4.x, O4.y], B: [bWrongFromRocker.x, bWrongFromRocker.y] },
  });

  const jointO2Id = createId("joint");

  return makeDocument({
    schemaVersion: 1,
    name: "open-four-bar",
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

/**
 * Builds a fourBar-shaped document whose coupler and rocker are both
 * shortened to 20mm (`unnamedJoints`: joint `name`s all set to `""`, so
 * `assemble()`'s violations fall back to reporting joint ids). `20 + 20 =
 * 40 < |A-O4| ~= 87.2` at the reference crank angle, and stays below
 * `|O2O4| - crankLength = 60` at every crank angle (min |A-O4| over a full
 * turn is 60, at crank pointing straight at O4) -- so by the triangle
 * inequality on A-B-O4, no crank angle admits a closing B. (Shortening
 * only the rocker would NOT be enough: with the coupler still ~100.78mm,
 * `b + c ~= 120.78 > 87.2`, and the four-bar can still close.)
 */
function buildImpossibleFourBar(unnamedJoints: boolean): MechanismDocument {
  const shortLength = 20;

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

  // Coupler's B site: 20mm from A, along the original A->B direction (an
  // arbitrary but plausible authored placement -- it can never reach the
  // rocker's B site regardless, per the triangle-inequality argument above).
  const couplerB = add(A, scale(normalize(sub(B, A)), shortLength));
  const couplerPose = poseFromWorldPoints(A, couplerB);
  const coupler = defineLink({
    name: "coupler",
    origin: couplerPose.position,
    angle: couplerPose.angle,
    sites: { A: [A.x, A.y], B: [couplerB.x, couplerB.y] },
  });

  // Rocker's B site: 20mm from O4, along the original O4->B direction.
  const rockerB = add(O4, scale(normalize(sub(B, O4)), shortLength));
  const rockerPose = poseFromWorldPoints(O4, rockerB);
  const rocker = defineLink({
    name: "rocker",
    origin: rockerPose.position,
    angle: rockerPose.angle,
    sites: { O4: [O4.x, O4.y], B: [rockerB.x, rockerB.y] },
  });

  const jointO2Id = createId("joint");
  const jointName = (name: string): string => (unnamedJoints ? "" : name);

  return makeDocument({
    schemaVersion: 1,
    name: unnamedJoints ? "unnamed-impossible-four-bar" : "impossible-four-bar",
    links: [ground.link, crank.link, coupler.link, rocker.link],
    joints: [
      {
        id: jointO2Id,
        name: jointName("O2"),
        type: "R",
        siteA: ground.siteIds.O2,
        siteB: crank.siteIds.O2,
      },
      {
        id: createId("joint"),
        name: jointName("A"),
        type: "R",
        siteA: crank.siteIds.A,
        siteB: coupler.siteIds.A,
      },
      {
        id: createId("joint"),
        name: jointName("B"),
        type: "R",
        siteA: coupler.siteIds.B,
        siteB: rocker.siteIds.B,
      },
      {
        id: createId("joint"),
        name: jointName("O4"),
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

/** See `buildImpossibleFourBar` -- joints keep their names ("A", "B", "O2", "O4"). */
export function impossibleFourBar(): MechanismDocument {
  return buildImpossibleFourBar(false);
}

/** Same geometry as `impossibleFourBar`, but every joint's `name` is `""`, so violations report ids. */
export function unnamedImpossibleFourBar(): MechanismDocument {
  return buildImpossibleFourBar(true);
}

/**
 * Two ground links whose sites are 5mm apart, joined by a single R joint.
 * Since both links are ground, the joint's rows have an all-zero Jacobian
 * (there is no `q` unknown to move) -- `assemble()` can never close it, and
 * it must always be reported as a violation.
 */
export function groundPairViolation(): MechanismDocument {
  const p1 = vec2(0, 0);
  const p2 = vec2(5, 0);

  const ground1 = defineLink({
    name: "ground-1",
    isGround: true,
    origin: [p1.x, p1.y],
    sites: { P: [p1.x, p1.y] },
  });
  const ground2 = defineLink({
    name: "ground-2",
    isGround: true,
    origin: [p2.x, p2.y],
    sites: { P: [p2.x, p2.y] },
  });

  return makeDocument({
    schemaVersion: 1,
    name: "ground-pair-violation",
    links: [ground1.link, ground2.link],
    joints: [
      {
        id: createId("joint"),
        name: "bad",
        type: "R",
        siteA: ground1.siteIds.P,
        siteB: ground2.siteIds.P,
      },
    ],
    motors: [],
    markers: [],
  });
}

/** Exposed for tests: the distance a groundPairViolation's two ground sites sit apart. */
export const groundPairDistance = distance(vec2(0, 0), vec2(5, 0));
