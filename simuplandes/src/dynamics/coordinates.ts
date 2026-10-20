/**
 * Joint coordinates: the relative angle of a revolute joint, or the slide
 * distance of a prismatic joint, as a function of `q`, with its gradient.
 * Torsional springs and effort motors act along these coordinates, and a
 * force along a coordinate maps to the generalized force `effort * grad`.
 *
 * The definitions match the kinematic motor drivers (`rotary-driver`,
 * `linear-driver` in `src/kinematics/constraints.ts`), so a coordinate is 0
 * at the reference pose and equals a motor's input everywhere else. Values
 * and gradients here are in model units; `system.ts` scales them to SI.
 */

import type { Joint } from "../model";
import type { KinematicSystem, SiteRef } from "../kinematics";

/** A revolute joint's relative angle `thetaB - thetaA - dThetaRef` (rad). */
export interface AngleCoordinate {
  readonly kind: "angle";
  readonly linkA: number;
  readonly linkB: number;
  readonly dThetaRef: number;
}

/** A prismatic joint's slide `axisA . (pB - pA) - refDist` (model units). */
export interface SlideCoordinate {
  readonly kind: "slide";
  readonly a: SiteRef;
  readonly b: SiteRef;
  readonly axisLocal: { readonly x: number; readonly y: number };
  readonly refDist: number;
}

export type JointCoordinate = AngleCoordinate | SlideCoordinate;

function slotPose(
  kin: KinematicSystem,
  q: Float64Array,
  linkIndex: number,
): { x: number; y: number; angle: number; offset: number } {
  const slot = kin.links[linkIndex];
  if (slot.offset < 0) {
    return { x: slot.reference.x, y: slot.reference.y, angle: slot.reference.angle, offset: -1 };
  }
  return {
    x: q[slot.offset],
    y: q[slot.offset + 1],
    angle: q[slot.offset + 2],
    offset: slot.offset,
  };
}

/** The coordinate of `joint` (R: angle, P: slide), built from `kin`'s reference poses. */
export function jointCoordinateOf(kin: KinematicSystem, joint: Joint): JointCoordinate {
  const a = kin.sites.get(joint.siteA)!;
  const b = kin.sites.get(joint.siteB)!;
  const refA = kin.links[a.linkIndex].reference;
  const refB = kin.links[b.linkIndex].reference;
  if (joint.type === "R") {
    return {
      kind: "angle",
      linkA: a.linkIndex,
      linkB: b.linkIndex,
      dThetaRef: refB.angle - refA.angle,
    };
  }
  const length = Math.hypot(joint.axis[0], joint.axis[1]);
  const axisLocal = { x: joint.axis[0] / length, y: joint.axis[1] / length };
  const ca = Math.cos(refA.angle);
  const sa = Math.sin(refA.angle);
  const cb = Math.cos(refB.angle);
  const sb = Math.sin(refB.angle);
  const pAx = refA.x + a.local.x * ca - a.local.y * sa;
  const pAy = refA.y + a.local.x * sa + a.local.y * ca;
  const pBx = refB.x + b.local.x * cb - b.local.y * sb;
  const pBy = refB.y + b.local.x * sb + b.local.y * cb;
  const ax = axisLocal.x * ca - axisLocal.y * sa;
  const ay = axisLocal.x * sa + axisLocal.y * ca;
  return {
    kind: "slide",
    a,
    b,
    axisLocal,
    refDist: ax * (pBx - pAx) + ay * (pBy - pAy),
  };
}

/**
 * The coordinate's value at `q`. When `grad` is given (length `kin.n`), it
 * is overwritten with d(value)/dq.
 */
export function evalCoordinate(
  kin: KinematicSystem,
  q: Float64Array,
  coord: JointCoordinate,
  grad: Float64Array | null,
): number {
  if (grad) grad.fill(0);

  if (coord.kind === "angle") {
    const pa = slotPose(kin, q, coord.linkA);
    const pb = slotPose(kin, q, coord.linkB);
    if (grad) {
      if (pa.offset >= 0) grad[pa.offset + 2] -= 1;
      if (pb.offset >= 0) grad[pb.offset + 2] += 1;
    }
    return pb.angle - pa.angle - coord.dThetaRef;
  }

  const pa = slotPose(kin, q, coord.a.linkIndex);
  const pb = slotPose(kin, q, coord.b.linkIndex);
  const ca = Math.cos(pa.angle);
  const sa = Math.sin(pa.angle);
  const cb = Math.cos(pb.angle);
  const sb = Math.sin(pb.angle);
  const offAx = coord.a.local.x * ca - coord.a.local.y * sa;
  const offAy = coord.a.local.x * sa + coord.a.local.y * ca;
  const offBx = coord.b.local.x * cb - coord.b.local.y * sb;
  const offBy = coord.b.local.x * sb + coord.b.local.y * cb;
  const ax = coord.axisLocal.x * ca - coord.axisLocal.y * sa;
  const ay = coord.axisLocal.x * sa + coord.axisLocal.y * ca;
  const dx = pb.x + offBx - (pa.x + offAx);
  const dy = pb.y + offBy - (pa.y + offAy);

  if (grad) {
    if (pa.offset >= 0) {
      const o = pa.offset;
      grad[o] -= ax;
      grad[o + 1] -= ay;
      // d/dthetaA of axis.(pB - pA): perp(axis).d - axis.perp(offA).
      grad[o + 2] += -ay * dx + ax * dy - (ax * -offAy + ay * offAx);
    }
    if (pb.offset >= 0) {
      const o = pb.offset;
      grad[o] += ax;
      grad[o + 1] += ay;
      grad[o + 2] += ax * -offBy + ay * offBx;
    }
  }
  return ax * dx + ay * dy - coord.refDist;
}
