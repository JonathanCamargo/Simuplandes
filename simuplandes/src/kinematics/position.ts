/**
 * `newtonSolve`: the one Levenberg-Marquardt-damped Newton routine (D2 —
 * there is ONE linear-solve core and ONE damped-Newton routine; lambda->0
 * behaves like plain Newton). `solvePosition`: continuation from the
 * previous converged state, marching via step-halving when a direct jump
 * fails. This is the plain per-frame continuation step; branch-jump
 * rejection, tangent prediction and lock-up bracketing are 03-02's
 * `advanceDrive`, built on top of this.
 */

import { evalResidual, evalJacobian } from "./constraints";
import { solveLeastSquares } from "./linalg";
import type { KinematicSystem } from "./system";

/** Options controlling a single damped-Newton solve. */
export interface NewtonOptions {
  /** Convergence tolerance on ||residual||_2. Default 1e-9. */
  tolerance?: number;
  /** Maximum number of trials (accepted + rejected). Default 30. */
  maxIterations?: number;
  /** Initial Levenberg-Marquardt damping, relative to max diag(J^T J). Default 1e-12 (near-plain Newton). */
  initialDamping?: number;
  /** Whether to include motor driver rows. Default true. */
  includeDrivers?: boolean;
}

/** The result of a single damped-Newton solve. */
export interface NewtonResult {
  readonly converged: boolean;
  readonly q: Float64Array;
  readonly residualNorm: number;
  readonly iterations: number;
}

function vecNorm(v: Float64Array, count: number): number {
  let sum = 0;
  for (let i = 0; i < count; i++) sum += v[i] * v[i];
  return Math.sqrt(sum);
}

const DEFAULT_TOLERANCE = 1e-9;
const DEFAULT_MAX_ITERATIONS = 30;
const DEFAULT_INITIAL_DAMPING = 1e-12;
const MIN_DAMPING = 1e-15;
const MAX_DAMPING = 1e10;
const MAX_STEP_SCALE = 1e3;

/**
 * A single Levenberg-Marquardt-damped Newton solve from `qStart` toward
 * `evalResidual(system, q, inputs) = 0`. Never writes NaN into the returned
 * `q`: a non-finite trial step is rejected, and the solve stops (not
 * converged) rather than accepting it.
 */
export function newtonSolve(
  system: KinematicSystem,
  qStart: Float64Array,
  inputs: Float64Array,
  options: NewtonOptions = {},
): NewtonResult {
  const tolerance = options.tolerance ?? DEFAULT_TOLERANCE;
  const maxIterations = options.maxIterations ?? DEFAULT_MAX_ITERATIONS;
  const initialDamping = options.initialDamping ?? DEFAULT_INITIAL_DAMPING;
  const includeDrivers = options.includeDrivers ?? true;
  const rows = includeDrivers ? system.m : system.jointRows;
  const n = system.n;

  const q = Float64Array.from(qStart);

  if (n === 0) {
    const r = new Float64Array(Math.max(rows, 0));
    if (rows > 0) evalResidual(system, q, inputs, r, rows);
    const norm = vecNorm(r, rows);
    return { converged: norm <= tolerance, q, residualNorm: norm, iterations: 0 };
  }

  const ws = system.workspace;
  const r = ws.r;
  const rTrial = ws.rTrial;
  const J = ws.J;
  const qTrial = ws.qTrial;
  const dxBuf = ws.dx;
  const linalg = ws.linalg;

  evalResidual(system, q, inputs, r, rows);
  let residualNorm = vecNorm(r, rows);
  let iterations = 0;

  if (residualNorm <= tolerance) {
    return { converged: true, q, residualNorm, iterations };
  }

  let lambda = initialDamping;

  while (iterations < maxIterations) {
    evalJacobian(system, q, J, rows);

    let s = 1e-300;
    for (let j = 0; j < n; j++) {
      let diag = 0;
      for (let i = 0; i < rows; i++) {
        const v = J[i * n + j];
        diag += v * v;
      }
      if (diag > s) s = diag;
    }

    let accepted = false;
    while (!accepted) {
      for (let i = 0; i < rows; i++) rTrial[i] = -r[i];
      solveLeastSquares(J, rows, n, rTrial, lambda * s, dxBuf, linalg);

      let dxInfNorm = 0;
      let finite = true;
      for (let j = 0; j < n; j++) {
        const v = dxBuf[j];
        if (!Number.isFinite(v)) finite = false;
        const av = Math.abs(v);
        if (av > dxInfNorm) dxInfNorm = av;
      }
      if (!finite || dxInfNorm > MAX_STEP_SCALE * system.lengthScale) {
        return { converged: false, q, residualNorm, iterations };
      }

      for (let j = 0; j < n; j++) qTrial[j] = q[j] + dxBuf[j];
      evalResidual(system, qTrial, inputs, rTrial, rows);
      const trialNorm = vecNorm(rTrial, rows);
      iterations++;

      if (Number.isFinite(trialNorm) && trialNorm < residualNorm) {
        for (let j = 0; j < n; j++) q[j] = qTrial[j];
        for (let i = 0; i < rows; i++) r[i] = rTrial[i];
        residualNorm = trialNorm;
        lambda = Math.max(lambda / 10, MIN_DAMPING);
        accepted = true;
      } else {
        lambda *= 10;
        if (lambda > MAX_DAMPING || iterations >= maxIterations) {
          return { converged: false, q, residualNorm, iterations };
        }
      }
    }

    if (residualNorm <= tolerance) {
      return { converged: true, q, residualNorm, iterations };
    }
  }

  return { converged: false, q, residualNorm, iterations };
}

/** A converged pose/input pair — the state carried frame to frame. */
export interface SolvedState {
  readonly q: Float64Array;
  readonly inputs: Float64Array;
}

/** Why a `solvePosition` call ended the way it did. */
export type PositionStatus = "ok" | "no-convergence" | "invalid-input";

/** The result of a continuation step. `state` is always a fresh, never-aliased snapshot. */
export interface PositionSolveResult {
  readonly status: PositionStatus;
  readonly state: SolvedState;
  readonly residualNorm: number;
  readonly iterations: number;
  readonly substeps: number;
}

const DEFAULT_MAX_HALVINGS = 6;
const INPUT_REACHED_TOLERANCE = 1e-12;

function cloneState(state: SolvedState): SolvedState {
  return { q: Float64Array.from(state.q), inputs: Float64Array.from(state.inputs) };
}

/** The reference state: `q0` and all-zero motor inputs. */
export function referenceState(system: KinematicSystem): SolvedState {
  return { q: Float64Array.from(system.q0), inputs: new Float64Array(system.motors.length) };
}

/**
 * Continuation step: warm-starts from `prev` toward `target` motor inputs.
 * Tries a direct jump first; on failure, marches via step-halving (halves
 * the remaining input delta on failure, grows it back x2, capped at the
 * remainder, on success). Never aliases or mutates `prev`.
 */
export function solvePosition(
  system: KinematicSystem,
  prev: SolvedState,
  target: Float64Array,
  options: NewtonOptions & { maxHalvings?: number } = {},
): PositionSolveResult {
  const motorCount = system.motors.length;

  if (target.length !== motorCount) {
    return {
      status: "invalid-input",
      state: cloneState(prev),
      residualNorm: 0,
      iterations: 0,
      substeps: 0,
    };
  }
  for (let k = 0; k < motorCount; k++) {
    if (!Number.isFinite(target[k])) {
      return {
        status: "invalid-input",
        state: cloneState(prev),
        residualNorm: 0,
        iterations: 0,
        substeps: 0,
      };
    }
  }

  const maxHalvings = options.maxHalvings ?? DEFAULT_MAX_HALVINGS;

  const fullResult = newtonSolve(system, prev.q, target, options);
  if (fullResult.converged) {
    return {
      status: "ok",
      state: { q: fullResult.q, inputs: Float64Array.from(target) },
      residualNorm: fullResult.residualNorm,
      iterations: fullResult.iterations,
      substeps: 1,
    };
  }

  let currentQ: Float64Array = Float64Array.from(prev.q);
  let currentInputs: Float64Array = Float64Array.from(prev.inputs);
  let totalIterations = fullResult.iterations;
  let lastResidualNorm = fullResult.residualNorm;
  let substeps = 0;
  let consecutiveFailures = 0;
  let h = 0.5;

  for (;;) {
    const remaining = new Float64Array(motorCount);
    for (let k = 0; k < motorCount; k++) remaining[k] = target[k] - currentInputs[k];

    const stepTarget = new Float64Array(motorCount);
    for (let k = 0; k < motorCount; k++) stepTarget[k] = currentInputs[k] + h * remaining[k];

    const stepResult = newtonSolve(system, currentQ, stepTarget, options);
    totalIterations += stepResult.iterations;

    if (stepResult.converged) {
      currentQ = stepResult.q;
      currentInputs = stepTarget;
      lastResidualNorm = stepResult.residualNorm;
      substeps++;
      consecutiveFailures = 0;

      let reached = true;
      for (let k = 0; k < motorCount; k++) {
        if (Math.abs(currentInputs[k] - target[k]) > INPUT_REACHED_TOLERANCE) {
          reached = false;
          break;
        }
      }
      if (reached) {
        return {
          status: "ok",
          state: { q: currentQ, inputs: currentInputs },
          residualNorm: lastResidualNorm,
          iterations: totalIterations,
          substeps,
        };
      }

      h = Math.min(h * 2, 1);
    } else {
      consecutiveFailures++;
      if (consecutiveFailures >= maxHalvings) {
        return {
          status: "no-convergence",
          state: { q: currentQ, inputs: currentInputs },
          residualNorm: lastResidualNorm,
          iterations: totalIterations,
          substeps,
        };
      }
      h = h / 2;
    }
  }
}
