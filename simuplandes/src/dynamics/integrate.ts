/**
 * Forward-dynamics time integration: classical fourth-order Runge-Kutta on
 * `(q, v)`, with the constraint drift removed after every step by
 * projection rather than Baumgarte stabilization:
 *
 * 1. positions: the kinematic Newton solve (`newtonSolve`) pulls `q` back
 *    onto `Phi(q, t) = 0`, with the motion drivers at their `t` values;
 * 2. velocities: `projectVelocity` makes `v` satisfy `J v = nu` while
 *    changing it as little as possible in the kinetic-energy norm.
 *
 * Steps are fixed-size (`maxStep` or less); `advance` subdivides a longer
 * interval so it lands exactly on its end time.
 */

import { evaluateDrivesAtTime, newtonSolve } from "../kinematics";
import { forwardDynamics, projectVelocity } from "./solve";
import type { DynamicSystem } from "./system";

/** The integrated state: time (s), coordinates and rates (model coordinates). */
export interface DynamicState {
  readonly t: number;
  readonly q: Float64Array;
  readonly v: Float64Array;
}

/** Why a step stopped. Anything but "ok" ends the trajectory. */
export type StepStatus =
  "ok" | "invalid-drive" | "invalid-effort" | "projection-failed" | "diverged" | "invalid-input";

export interface StepResult {
  readonly status: StepStatus;
  readonly state: DynamicState;
  /** True when any solve in the step met a singular augmented matrix. */
  readonly singular: boolean;
  /** The effort or motion motor that failed, for "invalid-effort"/"invalid-drive". */
  readonly motorId: string | null;
}

/** The default largest integration step, seconds. */
export const DEFAULT_MAX_STEP = 1e-3;
/** Rates above this many length scales (or radians) per second count as divergence. */
const DIVERGENCE_RATE = 1e7;

interface Drives {
  readonly ok: boolean;
  readonly values: Float64Array;
  readonly rates: Float64Array;
  readonly accels: Float64Array;
  readonly motorId: string | null;
}

function drivesAt(dyn: DynamicSystem, t: number): Drives {
  const result = evaluateDrivesAtTime(dyn.kin, t);
  return { ...result, motorId: result.invalidMotorIds[0] ?? null };
}

function axpy(out: Float64Array, a: Float64Array, s: number, b: Float64Array): Float64Array {
  for (let i = 0; i < out.length; i++) out[i] = a[i] + s * b[i];
  return out;
}

function stopped(
  state: DynamicState,
  status: StepStatus,
  singular = false,
  motorId: string | null = null,
): StepResult {
  return { status, state, singular, motorId };
}

/**
 * Projects `(q, v)` onto the constraints at time `t`: Newton on positions,
 * then the kinetic-energy velocity projection.
 */
export function projectState(
  dyn: DynamicSystem,
  t: number,
  q: Float64Array,
  v: Float64Array,
): StepResult {
  const state = { t, q: Float64Array.from(q), v: Float64Array.from(v) };
  const drives = drivesAt(dyn, t);
  if (!drives.ok) return stopped(state, "invalid-drive", false, drives.motorId);
  const position = newtonSolve(dyn.kin, q, drives.values);
  if (!position.converged) return stopped(state, "projection-failed");
  const velocity = projectVelocity(dyn, position.q, v, drives.rates);
  if (velocity.status !== "ok") return stopped(state, "invalid-input");
  const lengthScale = dyn.kin.lengthScale;
  for (let i = 0; i < velocity.v.length; i++) {
    if (Math.abs(velocity.v[i]) > DIVERGENCE_RATE * lengthScale) {
      return stopped(state, "diverged", velocity.singular);
    }
  }
  return {
    status: "ok",
    state: { t, q: position.q, v: velocity.v },
    singular: velocity.singular,
    motorId: null,
  };
}

/**
 * The consistent starting state at time `t`: positions solved for the
 * motion drivers' values at `t` (starting from `q`), velocities projected
 * from rest.
 */
export function initialState(dyn: DynamicSystem, q: Float64Array, t = 0): StepResult {
  return projectState(dyn, t, q, new Float64Array(dyn.kin.n));
}

/** One RK4 step of size `h` from `state`, followed by projection. */
export function step(dyn: DynamicSystem, state: DynamicState, h: number): StepResult {
  const n = dyn.kin.n;
  const { t, q, v } = state;
  let singular = false;

  const accel = (time: number, qs: Float64Array, vs: Float64Array): Float64Array | StepResult => {
    const drives = drivesAt(dyn, time);
    if (!drives.ok) return stopped(state, "invalid-drive", singular, drives.motorId);
    const solution = forwardDynamics(dyn, time, qs, vs, drives.accels);
    if (solution.status === "invalid-effort") {
      return stopped(state, "invalid-effort", singular, solution.invalidMotorId);
    }
    if (solution.status !== "ok") return stopped(state, "diverged", singular);
    singular ||= solution.singular;
    return solution.qDDot;
  };

  const a1 = accel(t, q, v);
  if (!(a1 instanceof Float64Array)) return a1;
  const q2 = axpy(new Float64Array(n), q, h / 2, v);
  const v2 = axpy(new Float64Array(n), v, h / 2, a1);
  const a2 = accel(t + h / 2, q2, v2);
  if (!(a2 instanceof Float64Array)) return a2;
  const q3 = axpy(new Float64Array(n), q, h / 2, v2);
  const v3 = axpy(new Float64Array(n), v, h / 2, a2);
  const a3 = accel(t + h / 2, q3, v3);
  if (!(a3 instanceof Float64Array)) return a3;
  const q4 = axpy(new Float64Array(n), q, h, v3);
  const v4 = axpy(new Float64Array(n), v, h, a3);
  const a4 = accel(t + h, q4, v4);
  if (!(a4 instanceof Float64Array)) return a4;

  const qNext = new Float64Array(n);
  const vNext = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    qNext[i] = q[i] + (h / 6) * (v[i] + 2 * v2[i] + 2 * v3[i] + v4[i]);
    vNext[i] = v[i] + (h / 6) * (a1[i] + 2 * a2[i] + 2 * a3[i] + a4[i]);
    if (!Number.isFinite(qNext[i]) || !Number.isFinite(vNext[i])) {
      return stopped(state, "diverged", singular);
    }
  }

  const projected = projectState(dyn, t + h, qNext, vNext);
  if (projected.status !== "ok") return { ...projected, state, singular };
  return { ...projected, singular: singular || projected.singular };
}

/**
 * Integrates from `state` over `duration` seconds in equal steps no longer
 * than `maxStep`. Stops at the first failed step, returning the last good
 * state.
 */
export function advance(
  dyn: DynamicSystem,
  state: DynamicState,
  duration: number,
  maxStep: number = DEFAULT_MAX_STEP,
): StepResult {
  if (!(duration > 0) || !(maxStep > 0)) {
    return stopped(state, duration === 0 ? "ok" : "invalid-input");
  }
  const steps = Math.max(1, Math.ceil(duration / maxStep - 1e-9));
  const h = duration / steps;
  let current = state;
  let singular = false;
  for (let i = 0; i < steps; i++) {
    const result = step(dyn, current, h);
    singular ||= result.singular;
    if (result.status !== "ok") return { ...result, singular };
    // Snap to the exact end time on the last step to avoid drift in `t`.
    current = i === steps - 1 ? { ...result.state, t: state.t + duration } : result.state;
  }
  return { status: "ok", state: current, singular, motorId: null };
}
