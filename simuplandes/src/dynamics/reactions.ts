/**
 * Turns Lagrange multipliers into the forces people read: joint reactions
 * and motor efforts.
 *
 * The constraint force on the bodies is `-J^T lambda`. For a revolute joint
 * (`Phi = pA - pB`), that is `+lambda` on the siteB link and `-lambda` on
 * the siteA link, both at the pin. For a prismatic joint, the normal row
 * gives a force `-lambda_1 n` at siteB's point on the siteB link, and the
 * rotation-lock row a couple `-lambda_0`; the siteA link gets the opposite.
 *
 * A reaction is reported as the force on the siteB link. When that link is
 * ground, it is reported on the siteA link instead, so a reaction always
 * describes a moving link. A prismatic couple is taken about the reported
 * link's own joint site. A motor's effort is `-lambda` of its driver row:
 * the torque (N·m) or force (N) it applies in the direction of increasing
 * input.
 */

import type { DynamicSystem } from "./system";

/** The force (N, world) and couple (N·m) a joint applies to one of its links. */
export interface JointReaction {
  readonly jointId: string;
  readonly label: string;
  readonly type: "R" | "P";
  /** The compiled link index the reaction acts on. */
  readonly onLinkIndex: number;
  readonly fx: number;
  readonly fy: number;
  /** The constraint couple: always 0 for a revolute joint. */
  readonly torque: number;
}

/** A motion-driven motor's effort: torque (N·m, rotary) or force (N, linear). */
export interface MotorEffort {
  readonly motorId: string;
  readonly label: string;
  readonly kind: "rotary" | "linear";
  readonly effort: number;
}

/** Joint reactions (in `kin.constraints` joint order) and driver efforts (in `kin.motors` order). */
export interface Reactions {
  readonly joints: readonly JointReaction[];
  readonly motors: readonly MotorEffort[];
}

/** World position (meters) of a link-local point at `q`. */
function sitePoint(
  dyn: DynamicSystem,
  q: Float64Array,
  linkIndex: number,
  local: { readonly x: number; readonly y: number },
): { x: number; y: number } {
  const slot = dyn.kin.links[linkIndex];
  const x = slot.offset < 0 ? slot.reference.x : q[slot.offset];
  const y = slot.offset < 0 ? slot.reference.y : q[slot.offset + 1];
  const angle = slot.offset < 0 ? slot.reference.angle : q[slot.offset + 2];
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const L = dyn.metersPerUnit;
  return { x: (x + local.x * c - local.y * s) * L, y: (y + local.x * s + local.y * c) * L };
}

/** Reads joint reactions and motor efforts out of `lambda` (from a solve at `q`). */
export function reactionsFromLambda(
  dyn: DynamicSystem,
  q: Float64Array,
  lambda: Float64Array,
): Reactions {
  const kin = dyn.kin;
  const joints: JointReaction[] = [];
  const motors: MotorEffort[] = new Array<MotorEffort>(kin.motors.length);

  for (const c of kin.constraints) {
    switch (c.kind) {
      case "revolute": {
        const bIsGround = kin.links[c.b.linkIndex].offset < 0;
        const sign = bIsGround ? -1 : 1;
        joints.push({
          jointId: c.jointId,
          label: c.label,
          type: "R",
          onLinkIndex: bIsGround ? c.a.linkIndex : c.b.linkIndex,
          fx: sign * lambda[c.row],
          fy: sign * lambda[c.row + 1],
          torque: 0,
        });
        break;
      }
      case "prismatic": {
        const slotA = kin.links[c.a.linkIndex];
        const angle = slotA.offset < 0 ? slotA.reference.angle : q[slotA.offset + 2];
        const cos = Math.cos(angle);
        const sin = Math.sin(angle);
        const nx = c.normalLocal.x * cos - c.normalLocal.y * sin;
        const ny = c.normalLocal.x * sin + c.normalLocal.y * cos;
        const bIsGround = kin.links[c.b.linkIndex].offset < 0;
        const fx = -lambda[c.row + 1] * nx;
        const fy = -lambda[c.row + 1] * ny;
        if (!bIsGround) {
          joints.push({
            jointId: c.jointId,
            label: c.label,
            type: "P",
            onLinkIndex: c.b.linkIndex,
            fx,
            fy,
            torque: -lambda[c.row],
          });
          break;
        }
        // On the siteA link: -F at pB and couple +lambda_0, moved to pA.
        const pA = sitePoint(dyn, q, c.a.linkIndex, c.a.local);
        const pB = sitePoint(dyn, q, c.b.linkIndex, c.b.local);
        const dx = pB.x - pA.x;
        const dy = pB.y - pA.y;
        joints.push({
          jointId: c.jointId,
          label: c.label,
          type: "P",
          onLinkIndex: c.a.linkIndex,
          fx: -fx,
          fy: -fy,
          torque: lambda[c.row] + dx * -fy - dy * -fx,
        });
        break;
      }
      case "rotary-driver":
      case "linear-driver": {
        const motor = kin.motors[c.motorIndex];
        motors[c.motorIndex] = {
          motorId: motor.id,
          label: motor.label,
          kind: motor.kind,
          effort: -lambda[c.row],
        };
        break;
      }
    }
  }

  return { joints, motors };
}
