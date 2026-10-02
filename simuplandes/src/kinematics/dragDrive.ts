/**
 * Drag-to-drive as motor-input inverse kinematics (SIM-03, research
 * Pattern 4): estimates the motor-input delta that moves a grabbed
 * link-local point toward a pointer target, using ONLY existing
 * primitives (`solveVelocity` for the tangent, `solveLeastSquares` for a
 * damped normal-equations solve). This is deliberately NOT a new
 * constraint row appended to the Newton system: a pointer-target row
 * would over-determine a 1-DOF mechanism (rank-deficient by exactly one,
 * generically), and there is no principled weighting that keeps the hard
 * joint rows exact while a soft pointer row absorbs the rest -- too small
 * a weight lets joints visibly separate, too large stiffens/slows the
 * solve. Instead, the ONLY thing this module ever touches is the motor
 * input vector; the actual pose is always produced by the existing,
 * already-exact `advanceDrive`/`newtonSolve` (see `src/sim/drag.ts`),
 * so joints stay exact by construction -- nothing here ever writes `q`.
 */

import type { Vec2 } from "../geom";
import { solveVelocity } from "./velocity";
import { pointKinematics } from "./query";
import { solveLeastSquares, createLinalgWorkspace } from "./linalg";
import type { KinematicSystem } from "./system";

/** The result of one `estimateDragInputDelta` call. */
export interface DragEstimate {
  /** `"ok"` on success; `"singular"` if any motor's tangent column is unavailable; `"invalid-input"` for a malformed call. */
  readonly status: "ok" | "singular" | "invalid-input";
  /** The motor-input delta that best moves the grabbed point toward `pointerWorld` (zero-filled unless `status === "ok"`). */
  readonly deltaInputs: Float64Array;
  /** The grabbed point's current world position (before the delta is applied). Zero when the call is invalid. */
  readonly pointWorld: Vec2;
  /** `2 x motorCount`, row-major (`tangent[row * motorCount + col]`): `d(pointWorld)/d(input_k)`. Zero-filled unless `status === "ok"`. */
  readonly tangent: Float64Array;
}

/**
 * Default damping is scale-aware (`1e-6 * lengthScale^2`, i.e. the same
 * order as `lambda * s` in `newtonSolve`'s own damping, where `s` is a
 * diag(J^T J) entry of order `lengthScale^2`): it must be small relative
 * to a healthy tangent's `|g|^2` (itself of order `lengthScale^2`, since a
 * drag-grabbed point typically moves ~1 length unit per unit input) so a
 * real drag isn't damped away, yet large enough that a point with a
 * genuinely zero tangent (e.g. the input link's own ground pivot) never
 * divides by zero.
 */
const DEFAULT_DAMPING_FACTOR = 1e-6;

const ZERO_VEC2: Vec2 = { x: 0, y: 0 };

function allFinite(v: Float64Array): boolean {
  for (let i = 0; i < v.length; i++) {
    if (!Number.isFinite(v[i])) return false;
  }
  return true;
}

function invalidResult(motorCount: number): DragEstimate {
  return {
    status: "invalid-input",
    deltaInputs: new Float64Array(Math.max(motorCount, 0)),
    pointWorld: ZERO_VEC2,
    tangent: new Float64Array(Math.max(motorCount, 0) * 2),
  };
}

/**
 * Estimates the motor-input delta that moves the link-local point `local`
 * on link `linkIndex` toward `pointerWorld`, via a damped least-squares
 * solve on the `2 x motorCount` tangent matrix `G` (column `k` is the
 * point's velocity sensitivity to motor `k` alone, from `solveVelocity` +
 * `pointKinematics`). Never touches `q`: the caller (`src/sim/drag.ts`)
 * feeds `inputs + deltaInputs` into `advanceDrive`/`solvePosition` for the
 * actual (exact) forward resolve.
 */
export function estimateDragInputDelta(
  system: KinematicSystem,
  q: Float64Array,
  linkIndex: number,
  local: Vec2,
  pointerWorld: Vec2,
  damping?: number,
): DragEstimate {
  const motorCount = system.motors.length;

  const linkValid =
    Number.isInteger(linkIndex) &&
    linkIndex >= 0 &&
    linkIndex < system.links.length &&
    !system.links[linkIndex].isGround;

  const inputsValid =
    motorCount >= 1 &&
    linkValid &&
    q.length === system.n &&
    allFinite(q) &&
    Number.isFinite(local.x) &&
    Number.isFinite(local.y) &&
    Number.isFinite(pointerWorld.x) &&
    Number.isFinite(pointerWorld.y) &&
    (damping === undefined || Number.isFinite(damping));

  if (!inputsValid) {
    return invalidResult(motorCount);
  }

  const zeroQDot = new Float64Array(system.n);
  const pointWorld = pointKinematics(system, q, zeroQDot, zeroQDot, linkIndex, local).position;

  const tangent = new Float64Array(2 * motorCount);
  const unitRate = new Float64Array(motorCount);
  for (let k = 0; k < motorCount; k++) {
    unitRate.fill(0);
    unitRate[k] = 1;
    const rate = solveVelocity(system, q, unitRate);
    if (rate.status !== "ok") {
      return {
        status: "singular",
        deltaInputs: new Float64Array(motorCount),
        pointWorld,
        tangent: new Float64Array(2 * motorCount),
      };
    }
    const pk = pointKinematics(system, q, rate.values, zeroQDot, linkIndex, local);
    tangent[0 * motorCount + k] = pk.velocity.x;
    tangent[1 * motorCount + k] = pk.velocity.y;
  }

  const lambda = damping ?? DEFAULT_DAMPING_FACTOR * system.lengthScale * system.lengthScale;
  const residual = new Float64Array([pointerWorld.x - pointWorld.x, pointerWorld.y - pointWorld.y]);
  const deltaInputs = new Float64Array(motorCount);
  const ws = createLinalgWorkspace(motorCount);
  solveLeastSquares(tangent, 2, motorCount, residual, lambda, deltaInputs, ws);

  return { status: "ok", deltaInputs, pointWorld, tangent };
}
