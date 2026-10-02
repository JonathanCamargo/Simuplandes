/**
 * Velocity and acceleration analysis: `J*qDot = nu` (joint rows 0, driver
 * rows the driven input rate) and `J*qDDot = gamma` (`evalGamma`'s output,
 * which already folds the driven input acceleration into its driver rows).
 * Both solves reuse the compiled system's preallocated Jacobian/linalg
 * workspace and `solveLeastSquares` with `lambda = 0` — exact for a square
 * or an over-determined-but-consistent (redundant) system, and a reliable
 * near-singularity trip-wire via the returned LU pivots otherwise.
 */

import { evalJacobian, evalGamma } from "./constraints";
import { solveLeastSquares } from "./linalg";
import type { KinematicSystem } from "./system";

/** How a rate solve (`solveVelocity`/`solveAcceleration`) ended. */
export type RateStatus = "ok" | "singular" | "invalid-input";

/** The result of a rate solve. `values` is all-zero (never NaN) unless `status === "ok"`. */
export interface RateResult {
  readonly status: RateStatus;
  readonly values: Float64Array;
}

/** Pivots below this fraction of the largest pivot flag the damped-normal-equations solve as singular. */
const MIN_PIVOT_RATIO = 1e-14;

function allFinite(v: Float64Array): boolean {
  for (let i = 0; i < v.length; i++) {
    if (!Number.isFinite(v[i])) return false;
  }
  return true;
}

function solveRate(system: KinematicSystem, q: Float64Array, rhs: Float64Array): RateResult {
  const n = system.n;
  const out = new Float64Array(n);
  if (n === 0) {
    return { status: "ok", values: out };
  }

  const m = system.m;
  const ws = system.workspace;
  evalJacobian(system, q, ws.J, m);

  const info = solveLeastSquares(ws.J, m, n, rhs, 0, out, ws.linalg);
  const pivotRatio = info.maxPivot > 0 ? info.minPivot / info.maxPivot : 0;
  if (info.singular || pivotRatio < MIN_PIVOT_RATIO || !allFinite(out)) {
    return { status: "singular", values: new Float64Array(n) };
  }
  return { status: "ok", values: out };
}

/**
 * Solves `J(q) * qDot = nu` for `qDot`: joint rows of `nu` are 0, driver row
 * `k` is `inputRates[k]`. Returns fresh arrays; never mutates `q`.
 */
export function solveVelocity(
  system: KinematicSystem,
  q: Float64Array,
  inputRates: Float64Array,
): RateResult {
  const n = system.n;
  if (
    q.length !== n ||
    inputRates.length !== system.motors.length ||
    !allFinite(q) ||
    !allFinite(inputRates)
  ) {
    return { status: "invalid-input", values: new Float64Array(n) };
  }

  const rhs = new Float64Array(system.m);
  for (const c of system.constraints) {
    if (c.kind === "rotary-driver" || c.kind === "linear-driver") {
      rhs[c.row] = inputRates[c.motorIndex];
    }
  }

  return solveRate(system, q, rhs);
}

/**
 * Solves `J(q) * qDDot = gamma` for `qDDot`, where `gamma` is `evalGamma`'s
 * output (driver rows already include `inputAccels`). Returns fresh
 * arrays; never mutates `q`/`qDot`.
 */
export function solveAcceleration(
  system: KinematicSystem,
  q: Float64Array,
  qDot: Float64Array,
  inputAccels: Float64Array,
): RateResult {
  const n = system.n;
  if (
    q.length !== n ||
    qDot.length !== n ||
    inputAccels.length !== system.motors.length ||
    !allFinite(q) ||
    !allFinite(qDot) ||
    !allFinite(inputAccels)
  ) {
    return { status: "invalid-input", values: new Float64Array(n) };
  }

  const rhs = new Float64Array(system.m);
  evalGamma(system, q, qDot, inputAccels, rhs, system.m);

  return solveRate(system, q, rhs);
}

/**
 * Chains `solveVelocity` then `solveAcceleration`: reports the first
 * non-"ok" status, and `qDDot` is all-zero if the velocity solve itself
 * failed (there is no `qDot` to build `gamma` from).
 */
export function solveVelocityAcceleration(
  system: KinematicSystem,
  q: Float64Array,
  inputRates: Float64Array,
  inputAccels: Float64Array,
): { status: RateStatus; qDot: Float64Array; qDDot: Float64Array } {
  const velocity = solveVelocity(system, q, inputRates);
  if (velocity.status !== "ok") {
    return { status: velocity.status, qDot: velocity.values, qDDot: new Float64Array(system.n) };
  }

  const acceleration = solveAcceleration(system, q, velocity.values, inputAccels);
  return { status: acceleration.status, qDot: velocity.values, qDDot: acceleration.values };
}
