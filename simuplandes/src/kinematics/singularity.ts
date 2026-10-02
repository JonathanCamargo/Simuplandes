/**
 * Singularity detection (KIN-04) and branch-preserving continuation with
 * lock-up bracketing: `analyzeSingularity` is the sigma_min/sigma_max
 * trip-wire (built on `linalg.ts`'s power/inverse-iteration estimate),
 * `advanceDrive` is a tangent-predictor / Newton-corrector continuation
 * step with branch-jump rejection and bisection-style bracketing to the
 * lock-up input, and `advanceRocking` is the reversal policy for an
 * oscillating (rocking) motor built on top of `advanceDrive`.
 */

import { evalJacobian } from "./constraints";
import { estimateSingularValues } from "./linalg";
import { newtonSolve, type SolvedState } from "./position";
import { solveVelocity } from "./velocity";
import type { KinematicSystem } from "./system";

/** Below this sigma_min/sigma_max ratio, a pose is flagged near-singular. Tuned so a converged, well away-from-limit pose (ratio ~1e-1 or better on every fixture tried) never trips, and a bracketed lock-up (ratio several orders of magnitude smaller) always does. */
export const SINGULAR_RATIO = 1e-3;

/** sigma_min/sigma_max diagnostic for a pose's full (driven) Jacobian. */
export interface SingularityInfo {
  readonly sigmaMin: number;
  readonly sigmaMax: number;
  readonly ratio: number;
  readonly nearSingular: boolean;
}

/**
 * Computes `analyzeSingularity`'s diagnostic on the full m x n Jacobian at
 * `q`, after rescaling each position column by `lengthScale` (angle
 * columns are left as-is). Without this, `J`'s position columns (order 1)
 * and angle columns (order `lengthScale`, since `d/dtheta[R(theta)v]` is a
 * rotated offset of magnitude ~`lengthScale`) make sigma_min/sigma_max
 * measure the document's physical size, not its kinematic conditioning —
 * a healthy, non-singular mechanism could otherwise trip the same ratio
 * threshold as a true lock-up purely because it is large in world units.
 * Rescaling by `lengthScale` (`q = D*qTilde`, `D` = diag(lengthScale for
 * position slots, 1 for angle slots), so `dPhi/dqTilde = J*D`) makes the
 * ratio compare like units and reflects only the mechanism's own
 * conditioning.
 */
export function analyzeSingularity(system: KinematicSystem, q: Float64Array): SingularityInfo {
  const { m, n } = system;
  const J = system.workspace.J;
  evalJacobian(system, q, J, m);

  const scale = system.lengthScale;
  for (let j = 0; j < n; j++) {
    const isAngle = j % 3 === 2;
    if (isAngle) continue;
    for (let i = 0; i < m; i++) J[i * n + j] *= scale;
  }

  const { min, max } = estimateSingularValues(J, m, n, system.workspace.linalg);
  const ratio = max > 0 ? min / max : 0;
  return { sigmaMin: min, sigmaMax: max, ratio, nearSingular: ratio < SINGULAR_RATIO };
}

/** Options controlling `advanceDrive`'s predictor-corrector continuation. */
export interface AdvanceOptions {
  /** Newton convergence tolerance for the corrector. Default 1e-9. */
  readonly tolerance?: number;
  /** Smallest fraction-of-remaining-delta step attempted before giving up and bracketing. Default 1e-10. */
  readonly minStep?: number;
  /** Absolute input-delta width (same units as a motor input) below which the last-good state is treated as bracketing the failure. Default 1e-10. */
  readonly bracketTolerance?: number;
  /** How much larger the corrected step may be than the predicted step before it is rejected as a branch jump. Default 1.0. */
  readonly jumpFactor?: number;
}

/** A bracketed lock-up: the input just before the mechanism can go no further, and which direction is still open. */
export interface LockUp {
  readonly inputs: Float64Array;
  readonly motorId: string | null;
  readonly openDirection: 1 | -1;
  readonly singularity: SingularityInfo;
}

/** Why an `advanceDrive` call ended the way it did. */
export type DriveStatus = "ok" | "locked" | "no-convergence" | "invalid-input";

/** The result of one `advanceDrive` continuation call. `state` is always a fresh, never-aliased snapshot. */
export interface DriveStepResult {
  readonly status: DriveStatus;
  readonly state: SolvedState;
  readonly residualNorm: number;
  readonly substeps: number;
  readonly singularity: SingularityInfo;
  readonly lockUp?: LockUp;
}

const DEFAULT_TOLERANCE = 1e-9;
const DEFAULT_MIN_STEP = 1e-10;
const DEFAULT_BRACKET_TOLERANCE = 1e-10;
const DEFAULT_JUMP_FACTOR = 1.0;
const MAX_ITERATIONS = 4096;
const MOVING_MOTOR_EPSILON = 1e-12;
const PREDICTOR_SANITY_FACTOR = 10;
// A floor under `deltaNorm` in the predictor-sanity check below, NOT a
// generic "at least this big" allowance: right at a bracketed near-fold
// pose, `solveVelocity`'s tangent for even a minuscule input delta can
// legitimately return a huge q-dot (the transmission ratio genuinely blows
// up there). Flooring `deltaNorm` at 1 (as if any delta smaller than a
// full radian/length-unit were "the same as 1") let exactly that huge,
// wrong tangent slip under the threshold for a tiny delta and silently
// wind a link's angle by tens of radians (a real bug caught by the
// rocking-oscillation test, not merely a stress case) -- flooring at a
// small epsilon instead keeps the check scaling down with the delta, so a
// disproportionate tangent for a tiny step is still rejected.
const MIN_DELTA_FLOOR = 1e-9;
const BRANCH_JUMP_EPSILON = 1e-6;

function infNorm(v: Float64Array): number {
  let max = 0;
  for (let i = 0; i < v.length; i++) {
    const av = Math.abs(v[i]);
    if (av > max) max = av;
  }
  return max;
}

function allFinite(v: Float64Array): boolean {
  for (let i = 0; i < v.length; i++) {
    if (!Number.isFinite(v[i])) return false;
  }
  return true;
}

/** A distance between two `q` vectors with positions scaled by `lengthScale` and angles used raw. */
function scaledDistance(system: KinematicSystem, a: Float64Array, b: Float64Array): number {
  const scale = system.lengthScale;
  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    const isAngle = i % 3 === 2;
    const diff = a[i] - b[i];
    const scaled = isAngle ? diff : diff / scale;
    sum += scaled * scaled;
  }
  return Math.sqrt(sum);
}

/** Which single motor (if any) `target` moves relative to `prevInputs`, and which direction re-opens it. */
function describeMovingMotor(
  system: KinematicSystem,
  target: Float64Array,
  prevInputs: Float64Array,
): { motorId: string | null; openDirection: 1 | -1 } {
  let movingIndex = -1;
  let movingCount = 0;
  for (let k = 0; k < target.length; k++) {
    if (Math.abs(target[k] - prevInputs[k]) > MOVING_MOTOR_EPSILON) {
      movingCount++;
      movingIndex = k;
    }
  }
  if (movingCount === 1) {
    const delta = target[movingIndex] - prevInputs[movingIndex];
    const openDirection: 1 | -1 = delta >= 0 ? -1 : 1;
    return { motorId: system.motors[movingIndex].id, openDirection };
  }
  return { motorId: null, openDirection: -1 };
}

function cloneState(state: SolvedState): SolvedState {
  return { q: Float64Array.from(state.q), inputs: Float64Array.from(state.inputs) };
}

/**
 * Predictor-corrector continuation from `prev` toward `target` motor
 * inputs, with step control, branch-jump rejection, and lock-up
 * bracketing (Pattern 8). Never aliases or mutates `prev`.
 *
 * Each attempted sub-step: (1) predict `qPred` via `solveVelocity`'s
 * tangent at the attempted input delta (falling back to a warm start if
 * the tangent is unavailable or absurdly large — near a fold the tangent
 * blows up); (2) correct via `newtonSolve` from `qPred`; (3) reject the
 * correction as a branch jump if it moved far past the predictor,
 * measured in `lengthScale`-normalized units. Accepted steps grow the
 * next attempt's fraction of the remaining delta (capped at the whole
 * remainder); rejected steps shrink it. When the attempted fraction
 * becomes negligible, the last good state is checked for near-singularity
 * (`analyzeSingularity`) to decide between `"locked"` and
 * `"no-convergence"`.
 */
export function advanceDrive(
  system: KinematicSystem,
  prev: SolvedState,
  target: Float64Array,
  options: AdvanceOptions = {},
): DriveStepResult {
  const motorCount = system.motors.length;
  const tolerance = options.tolerance ?? DEFAULT_TOLERANCE;
  const minStep = options.minStep ?? DEFAULT_MIN_STEP;
  const bracketTolerance = options.bracketTolerance ?? DEFAULT_BRACKET_TOLERANCE;
  const jumpFactor = options.jumpFactor ?? DEFAULT_JUMP_FACTOR;

  if (target.length !== motorCount || !allFinite(target)) {
    return {
      status: "invalid-input",
      state: cloneState(prev),
      residualNorm: 0,
      substeps: 0,
      singularity: analyzeSingularity(system, prev.q),
    };
  }

  const moving = describeMovingMotor(system, target, prev.inputs);

  let current: SolvedState = cloneState(prev);
  let h = 1;
  let substeps = 0;
  let residualNorm = 0;

  for (let iteration = 0; iteration < MAX_ITERATIONS; iteration++) {
    const remaining = new Float64Array(motorCount);
    for (let k = 0; k < motorCount; k++) remaining[k] = target[k] - current.inputs[k];
    const remainingNorm = infNorm(remaining);

    if (remainingNorm < bracketTolerance) {
      return {
        status: "ok",
        state: current,
        residualNorm,
        substeps,
        singularity: analyzeSingularity(system, current.q),
      };
    }

    const stepDelta = new Float64Array(motorCount);
    for (let k = 0; k < motorCount; k++) stepDelta[k] = h * remaining[k];

    const tangent = solveVelocity(system, current.q, stepDelta);
    let qPred = current.q;
    if (tangent.status === "ok") {
      const predictedNorm = infNorm(tangent.values);
      const deltaNorm = infNorm(stepDelta);
      if (
        Number.isFinite(predictedNorm) &&
        predictedNorm <=
          PREDICTOR_SANITY_FACTOR * system.lengthScale * Math.max(MIN_DELTA_FLOOR, deltaNorm)
      ) {
        qPred = new Float64Array(system.n);
        for (let j = 0; j < system.n; j++) qPred[j] = current.q[j] + tangent.values[j];
      }
    }

    const stepTargetInputs = new Float64Array(motorCount);
    for (let k = 0; k < motorCount; k++) stepTargetInputs[k] = current.inputs[k] + stepDelta[k];

    const newtonResult = newtonSolve(system, qPred, stepTargetInputs, { tolerance });

    let accepted = false;
    if (newtonResult.converged) {
      const jumpDistance = scaledDistance(system, newtonResult.q, qPred);
      const predictorDistance = scaledDistance(system, qPred, current.q);
      if (jumpDistance <= jumpFactor * predictorDistance + BRANCH_JUMP_EPSILON) {
        accepted = true;
      }
    }

    if (accepted) {
      current = { q: newtonResult.q, inputs: stepTargetInputs };
      residualNorm = newtonResult.residualNorm;
      substeps++;
      h = Math.min(h * 2, 1);
      continue;
    }

    h = h / 2;
    if (h * remainingNorm < bracketTolerance || h < minStep) {
      const singularity = analyzeSingularity(system, current.q);
      if (singularity.nearSingular) {
        return {
          status: "locked",
          state: current,
          residualNorm,
          substeps,
          singularity,
          lockUp: {
            inputs: Float64Array.from(current.inputs),
            motorId: moving.motorId,
            openDirection: moving.openDirection,
            singularity,
          },
        };
      }
      return { status: "no-convergence", state: current, residualNorm, substeps, singularity };
    }
  }

  const singularity = analyzeSingularity(system, current.q);
  return { status: "no-convergence", state: current, residualNorm, substeps, singularity };
}

/** `advanceDrive`'s result, plus the rocking motor's current direction and how many times it has reversed. */
export interface RockingResult extends DriveStepResult {
  readonly direction: 1 | -1;
  readonly reversals: number;
}

const MAX_REVERSALS_PER_CALL = 2;

/**
 * Advances a single motor by up to `distance` (>= 0) from `prev`, in
 * `direction`. On a lock-up, flips direction and continues the unused
 * remainder from the bracketed state, up to `MAX_REVERSALS_PER_CALL`
 * reversals within one call — the solver half of KIN-04's automatic
 * rocking-motor reversal (Phase 5 feeds it per-frame scrubber/time
 * deltas as `distance`).
 */
export function advanceRocking(
  system: KinematicSystem,
  prev: SolvedState,
  motorIndex: number,
  distance: number,
  direction: 1 | -1,
  options: AdvanceOptions = {},
): RockingResult {
  let currentDirection = direction;
  let remaining = distance;
  let state: SolvedState = cloneState(prev);
  let reversals = 0;
  let result: DriveStepResult = {
    status: "ok",
    state,
    residualNorm: 0,
    substeps: 0,
    singularity: analyzeSingularity(system, prev.q),
  };

  const maxSegments = MAX_REVERSALS_PER_CALL + 1;
  for (let segment = 0; segment < maxSegments; segment++) {
    if (remaining <= 0) break;

    const target = Float64Array.from(state.inputs);
    target[motorIndex] += currentDirection * remaining;

    result = advanceDrive(system, state, target, options);

    if (result.status !== "locked") {
      state = result.state;
      break;
    }

    const traveled = Math.abs(result.state.inputs[motorIndex] - state.inputs[motorIndex]);
    state = result.state;
    remaining = Math.max(remaining - traveled, 0);

    if (segment === maxSegments - 1) break;
    currentDirection = currentDirection === 1 ? -1 : 1;
    reversals++;
  }

  return { ...result, state, direction: currentDirection, reversals };
}
