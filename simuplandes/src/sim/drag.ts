/**
 * `dragToward`: the Simulate-mode drag-to-drive orchestration (SIM-03).
 * This is NOT a new soft constraint row appended to the Newton system --
 * research Pattern 4 rejects that design because an extra pointer-target
 * row would over-determine a 1-DOF mechanism (rank-deficient by exactly
 * one, generically), and there is no principled weighting that keeps the
 * hard joint rows exact while a soft pointer row absorbs the rest (too
 * small a weight lets joints visibly separate on-screen; too large
 * stiffens/slows the solve). Instead, `dragToward` runs a small, damped
 * inner IK loop on the MOTOR INPUT ONLY (`estimateDragInputDelta`,
 * `../kinematics/dragDrive.ts`) and hands every candidate input straight
 * to the existing, already-exact `advanceDrive` for the actual pose. The
 * only place `q` ever changes in this module is that `advanceDrive` call
 * -- joints stay exact (<= 1e-9) by construction, and `advanceDrive`'s own
 * lock-up/branch-jump protection applies to a drag for free.
 */

import {
  advanceDrive,
  estimateDragInputDelta,
  pointKinematics,
  type KinematicSystem,
  type SolvedState,
  type LockUp,
} from "../kinematics";
import { distance, type Vec2 } from "../geom";

/** The link-local point being dragged. */
export interface DragTarget {
  readonly linkIndex: number;
  readonly local: Vec2;
}

/** The result of one `dragToward` call. `state` is always a fresh, never-aliased snapshot. */
export interface DragResult {
  readonly state: SolvedState;
  readonly status: "ok" | "locked" | "no-convergence" | "invalid-input" | "singular";
  readonly pointWorld: Vec2;
  readonly residualToPointer: number;
  readonly lockUp?: LockUp;
  readonly nearSingular: boolean;
  readonly residualNorm: number;
}

/** Options controlling `dragToward`'s inner IK loop and per-step input clamp. */
export interface DragOptions {
  /** Max inner IK iterations per call. Default 4 -- a mouse-speed drag typically converges in 1-2. */
  readonly maxInnerIterations?: number;
  /** Max |input delta| per motor per inner iteration, same units as that motor's input. When omitted, defaults per motor kind (see `DEFAULT_ROTARY_MAX_STEP`/`DEFAULT_LINEAR_STEP_FRACTION`). */
  readonly maxInputStep?: number;
}

const DEFAULT_MAX_INNER_ITERATIONS = 4;
const DEFAULT_ROTARY_MAX_STEP = (20 * Math.PI) / 180; // 20 degrees
const DEFAULT_LINEAR_STEP_FRACTION = 0.2; // 0.2 * lengthScale
const MIN_DELTA_NORM = 1e-12;
const MIN_DISTANCE_IMPROVEMENT_FACTOR = 1e-9;

function cloneState(state: SolvedState): SolvedState {
  return { q: Float64Array.from(state.q), inputs: Float64Array.from(state.inputs) };
}

function maxStepFor(
  system: KinematicSystem,
  motorIndex: number,
  override: number | undefined,
): number {
  if (override !== undefined) return override;
  return system.motors[motorIndex].kind === "rotary"
    ? DEFAULT_ROTARY_MAX_STEP
    : DEFAULT_LINEAR_STEP_FRACTION * system.lengthScale;
}

function clamp(value: number, max: number): number {
  if (value > max) return max;
  if (value < -max) return -max;
  return value;
}

function infNorm(v: Float64Array): number {
  let max = 0;
  for (let i = 0; i < v.length; i++) {
    const av = Math.abs(v[i]);
    if (av > max) max = av;
  }
  return max;
}

function worldPointOf(system: KinematicSystem, state: SolvedState, target: DragTarget): Vec2 {
  const zeroQDot = new Float64Array(system.n);
  return pointKinematics(system, state.q, zeroQDot, zeroQDot, target.linkIndex, target.local)
    .position;
}

/**
 * Drags the point `target.local` (on link `target.linkIndex`) toward
 * `pointerWorld` from `prev`, by repeated (up to `options.maxInnerIterations`)
 * motor-input IK estimates (`estimateDragInputDelta`) each resolved exactly
 * via `advanceDrive`. Never mutates or aliases `prev`. Stops early -- with
 * the last GOOD state returned -- as soon as: the estimate itself fails
 * (`"singular"`/`"invalid-input"`); `advanceDrive` doesn't return `"ok"`
 * (a lock-up naturally stalls the drag at the lock-up, matching a real
 * mechanism's feel, with zero extra code); the accepted step's |delta| is
 * below 1e-12; or the step shrank the pointer distance by less than
 * `1e-9 * system.lengthScale` (converged/at the closest reachable point).
 */
export function dragToward(
  system: KinematicSystem,
  prev: SolvedState,
  target: DragTarget,
  pointerWorld: Vec2,
  options: DragOptions = {},
): DragResult {
  const maxInnerIterations = options.maxInnerIterations ?? DEFAULT_MAX_INNER_ITERATIONS;
  const motorCount = system.motors.length;
  const minImprovement = MIN_DISTANCE_IMPROVEMENT_FACTOR * system.lengthScale;

  let state = cloneState(prev);
  let pointWorld = worldPointOf(system, state, target);
  let bestDistance = distance(pointWorld, pointerWorld);
  let residualNorm = 0;
  let nearSingular = false;

  for (let iteration = 0; iteration < maxInnerIterations; iteration++) {
    const estimate = estimateDragInputDelta(
      system,
      state.q,
      target.linkIndex,
      target.local,
      pointerWorld,
    );

    if (estimate.status !== "ok") {
      return {
        state,
        status: estimate.status,
        pointWorld,
        residualToPointer: bestDistance,
        nearSingular,
        residualNorm,
      };
    }

    if (infNorm(estimate.deltaInputs) < MIN_DELTA_NORM) {
      break;
    }

    const nextInputs = new Float64Array(motorCount);
    for (let k = 0; k < motorCount; k++) {
      const clamped = clamp(estimate.deltaInputs[k], maxStepFor(system, k, options.maxInputStep));
      nextInputs[k] = state.inputs[k] + clamped;
    }

    const stepResult = advanceDrive(system, state, nextInputs);
    residualNorm = stepResult.residualNorm;
    nearSingular = stepResult.singularity.nearSingular;
    state = stepResult.state;
    pointWorld = worldPointOf(system, state, target);
    const newDistance = distance(pointWorld, pointerWorld);

    if (stepResult.status !== "ok") {
      return {
        state,
        status: stepResult.status,
        pointWorld,
        residualToPointer: newDistance,
        lockUp: stepResult.lockUp,
        nearSingular,
        residualNorm,
      };
    }

    const improvement = bestDistance - newDistance;
    bestDistance = newDistance;
    if (improvement < minImprovement) {
      break;
    }
  }

  return {
    state,
    status: "ok",
    pointWorld,
    residualToPointer: bestDistance,
    nearSingular,
    residualNorm,
  };
}
