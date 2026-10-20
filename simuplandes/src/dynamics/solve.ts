/**
 * The one dynamics solve: the augmented (saddle-point) system
 *
 *   [ M  J^T ] [ a      ]   [ top    ]
 *   [ J  0   ] [ lambda ] = [ bottom ]
 *
 * in SI coordinates. The three uses differ only in the right-hand side:
 *
 * - forward dynamics: `top = Q`, `bottom = gamma` -> accelerations and
 *   multipliers;
 * - inverse dynamics: `top = Q`, `bottom = J a_known` -> the multipliers
 *   that produce a prescribed acceleration (the same system, so the two
 *   always agree);
 * - velocity projection: `top = M v_guess`, `bottom = nu` -> the velocity
 *   closest to `v_guess` in the kinetic-energy norm that satisfies the
 *   velocity constraints.
 *
 * Redundant constraints (a double parallelogram, say) make the matrix
 * singular: accelerations are still unique, but the multipliers are not.
 * The solve then falls back to damped least squares, which picks the
 * minimum-norm multipliers, and reports `singular: true`.
 */

import { evalGamma, evalJacobian, luFactor, luSolve } from "../kinematics";
import { assembleForces, assembleMass, toSIRates } from "./assemble";
import type { DynamicSystem } from "./system";

/** Pivot ratio below which the augmented matrix is treated as singular. */
const SINGULAR_PIVOT_RATIO = 1e-11;
/** Relative damping of the least-squares fallback. */
const FALLBACK_DAMPING = 1e-12;

function allFinite(v: Float64Array): boolean {
  for (let i = 0; i < v.length; i++) {
    if (!Number.isFinite(v[i])) return false;
  }
  return true;
}

/** Fills the workspace Jacobian with the SI constraint Jacobian at `q`. */
function assembleJacobianSI(dyn: DynamicSystem, q: Float64Array): void {
  const { n, m } = dyn.kin;
  const J = dyn.workspace.J;
  evalJacobian(dyn.kin, q, J, m);
  for (let r = 0; r < m; r++) {
    const rs = dyn.rowScale[r];
    for (let c = 0; c < n; c++) J[r * n + c] *= rs / dyn.colScale[c];
  }
}

/**
 * Solves the augmented system with the workspace `M` and `J` already
 * assembled. `top` has length n, `bottom` length m. The solution lands in
 * `workspace.x` (accelerations or velocities first, then multipliers).
 */
function solveAugmented(dyn: DynamicSystem, top: Float64Array, bottom: Float64Array): boolean {
  const { n, m } = dyn.kin;
  const size = n + m;
  const { M, J, K, x, piv, K2 } = dyn.workspace;

  K.fill(0);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) K[i * size + j] = M[i * n + j];
  }
  for (let r = 0; r < m; r++) {
    for (let c = 0; c < n; c++) {
      const value = J[r * n + c];
      K[(n + r) * size + c] = value;
      K[c * size + n + r] = value;
    }
  }
  for (let i = 0; i < n; i++) x[i] = top[i];
  for (let r = 0; r < m; r++) x[n + r] = bottom[r];

  // K2 keeps an intact copy of K in case the fallback needs it.
  K2.set(K);
  const info = luFactor(K, size, piv);
  const ratio = info.maxPivot > 0 ? info.minPivot / info.maxPivot : 0;
  if (!info.singular && ratio >= SINGULAR_PIVOT_RATIO) {
    luSolve(K, size, piv, x);
    if (allFinite(x)) return false;
  }

  // Damped least squares on the symmetric K: (K K + mu I) x = K b.
  const b = new Float64Array(size);
  for (let i = 0; i < n; i++) b[i] = top[i];
  for (let r = 0; r < m; r++) b[n + r] = bottom[r];
  let maxDiag = 0;
  for (let i = 0; i < size; i++) {
    for (let j = 0; j < size; j++) {
      let sum = 0;
      for (let k = 0; k < size; k++) sum += K2[i * size + k] * K2[k * size + j];
      K[i * size + j] = sum;
    }
    if (K[i * size + i] > maxDiag) maxDiag = K[i * size + i];
  }
  const mu = FALLBACK_DAMPING * Math.max(maxDiag, 1e-300);
  for (let i = 0; i < size; i++) {
    K[i * size + i] += mu;
    let sum = 0;
    for (let k = 0; k < size; k++) sum += K2[i * size + k] * b[k];
    x[i] = sum;
  }
  luFactor(K, size, piv);
  luSolve(K, size, piv, x);
  return true;
}

/** How a dynamics solve ended. */
export type DynamicsStatus = "ok" | "invalid-input" | "invalid-effort";

/** Accelerations (model coordinates) and multipliers (SI) from one solve. */
export interface DynamicsSolution {
  readonly status: DynamicsStatus;
  /** True when the augmented matrix was singular (redundant constraints, or a massless free coordinate). */
  readonly singular: boolean;
  readonly qDDot: Float64Array;
  /** One multiplier per constraint row: N for length rows, N·m for angle rows. */
  readonly lambda: Float64Array;
  readonly invalidMotorId: string | null;
}

function failed(dyn: DynamicSystem, status: DynamicsStatus, motorId: string | null = null) {
  return {
    status,
    singular: false,
    qDDot: new Float64Array(dyn.kin.n),
    lambda: new Float64Array(dyn.kin.m),
    invalidMotorId: motorId,
  };
}

function validInput(dyn: DynamicSystem, ...vectors: Float64Array[]): boolean {
  return vectors.every((v) => v.length === dyn.kin.n && allFinite(v));
}

function readSolution(dyn: DynamicSystem, singular: boolean): DynamicsSolution {
  const { n, m } = dyn.kin;
  const { x } = dyn.workspace;
  const qDDot = new Float64Array(n);
  for (let i = 0; i < n; i++) qDDot[i] = x[i] / dyn.colScale[i];
  const lambda = Float64Array.from(x.subarray(n, n + m));
  return { status: "ok", singular, qDDot, lambda, invalidMotorId: null };
}

/**
 * Forward dynamics at `(t, q, v)`: the accelerations the forces produce
 * under the constraints. `inputAccels` are the motion drivers' input
 * accelerations (indexed like `kin.motors`).
 */
export function forwardDynamics(
  dyn: DynamicSystem,
  t: number,
  q: Float64Array,
  v: Float64Array,
  inputAccels: Float64Array,
): DynamicsSolution {
  if (!validInput(dyn, q, v) || inputAccels.length !== dyn.kin.motors.length) {
    return failed(dyn, "invalid-input");
  }
  const ws = dyn.workspace;
  const forces = assembleForces(dyn, t, q, v, ws.Q);
  if (forces.invalidMotorId) return failed(dyn, "invalid-effort", forces.invalidMotorId);
  assembleMass(dyn, q, ws.M);
  assembleJacobianSI(dyn, q);
  evalGamma(dyn.kin, q, v, inputAccels, ws.rhs, dyn.kin.m);
  for (let r = 0; r < dyn.kin.m; r++) ws.rhs[r] *= dyn.rowScale[r];
  const singular = solveAugmented(dyn, ws.Q, ws.rhs);
  return readSolution(dyn, singular);
}

/**
 * Inverse dynamics at `(t, q, v, qDDot)`: the multipliers -- joint
 * reactions and motor efforts -- that the prescribed motion requires.
 * `qDDot` should satisfy the acceleration constraints (as kinematic
 * analysis guarantees).
 */
export function inverseDynamics(
  dyn: DynamicSystem,
  t: number,
  q: Float64Array,
  v: Float64Array,
  qDDot: Float64Array,
): DynamicsSolution {
  if (!validInput(dyn, q, v, qDDot)) return failed(dyn, "invalid-input");
  const { n, m } = dyn.kin;
  const ws = dyn.workspace;
  const forces = assembleForces(dyn, t, q, v, ws.Q);
  if (forces.invalidMotorId) return failed(dyn, "invalid-effort", forces.invalidMotorId);
  assembleMass(dyn, q, ws.M);
  assembleJacobianSI(dyn, q);
  for (let r = 0; r < m; r++) {
    let sum = 0;
    for (let c = 0; c < n; c++) sum += ws.J[r * n + c] * qDDot[c] * dyn.colScale[c];
    ws.rhs[r] = sum;
  }
  const singular = solveAugmented(dyn, ws.Q, ws.rhs);
  const solution = readSolution(dyn, singular);
  return { ...solution, qDDot: Float64Array.from(qDDot) };
}

/** The result of a velocity projection. */
export interface VelocityProjection {
  readonly status: "ok" | "invalid-input";
  readonly singular: boolean;
  readonly v: Float64Array;
  /** Largest SI residual of `J v = nu` after the projection (0 when consistent). */
  readonly residual: number;
}

/**
 * Projects `vGuess` onto the velocity constraints `J v = nu` (joint rows 0,
 * driver row k equal to `inputRates[k]`), in the kinetic-energy norm. Used
 * for the initial velocity and after every integration step.
 */
export function projectVelocity(
  dyn: DynamicSystem,
  q: Float64Array,
  vGuess: Float64Array,
  inputRates: Float64Array,
): VelocityProjection {
  const { n, m } = dyn.kin;
  if (!validInput(dyn, q, vGuess) || inputRates.length !== dyn.kin.motors.length) {
    return { status: "invalid-input", singular: false, v: new Float64Array(n), residual: 0 };
  }
  const ws = dyn.workspace;
  assembleMass(dyn, q, ws.M);
  assembleJacobianSI(dyn, q);
  const vSI = new Float64Array(n);
  toSIRates(dyn, vGuess, vSI);
  const top = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let sum = 0;
    for (let j = 0; j < n; j++) sum += ws.M[i * n + j] * vSI[j];
    top[i] = sum;
  }
  ws.rhs.fill(0);
  for (const c of dyn.kin.constraints) {
    if (c.kind === "rotary-driver" || c.kind === "linear-driver") {
      ws.rhs[c.row] = inputRates[c.motorIndex] * dyn.rowScale[c.row];
    }
  }
  const singular = solveAugmented(dyn, top, ws.rhs);
  const v = new Float64Array(n);
  for (let i = 0; i < n; i++) v[i] = ws.x[i] / dyn.colScale[i];
  let residual = 0;
  for (let r = 0; r < m; r++) {
    let sum = -ws.rhs[r];
    for (let c = 0; c < n; c++) sum += ws.J[r * n + c] * ws.x[c];
    residual = Math.max(residual, Math.abs(sum));
  }
  return { status: "ok", singular, v, residual };
}
