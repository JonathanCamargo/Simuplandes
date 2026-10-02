/**
 * Full-range sweep precompute (research Pattern 3, SIM-04's numerical
 * core): marches a single motor's input across its full usable range from
 * a starting `SolvedState` -- a full `2*PI` turn for a fully-rotating
 * (Grashof) motor, or forward AND backward to each bracketed lock-up for a
 * bounded (non-Grashof / limited-travel) motor -- using `advanceDrive` as
 * the ONLY stepping primitive, exactly the same call the scrubber and the
 * drag loop make. Never a hand-rolled solver (Pattern 3's own caveat: port
 * the prototype's marching ALGORITHM, never its code).
 *
 * The resulting per-sample `q`/`qDot`/`qDDot` backs both the coupler-curve
 * traces (`traces.ts`, SIM-04) and the "vs input" plot series (SIM-05)
 * from one precompute -- run once per (document identity, active motor),
 * never per frame.
 *
 * Sample `input` values are RELATIVE to `start.inputs[motorIndex]` (0 at
 * the start sample, matching a reference-state start); every OTHER motor
 * is held fixed at its `start.inputs` value throughout (a sweep drives
 * exactly one motor).
 */

import {
  advanceDrive,
  solveVelocityAcceleration,
  type KinematicSystem,
  type SolvedState,
} from "../kinematics";

/** One solved sample along a sweep: `input` is RELATIVE to the sweep's start. */
export interface SweepSample {
  readonly input: number;
  readonly q: Float64Array;
  readonly qDot: Float64Array;
  readonly qDDot: Float64Array;
}

/** `"full-rotation"` for a Grashof (fully-rotating) motor; `"bounded"` when lock-ups limit the range; `"none"` with no motor to drive. */
export type SweepKind = "full-rotation" | "bounded" | "none";

/** The full precomputed sweep for one motor. */
export interface SweepResult {
  readonly kind: SweepKind;
  readonly motorIndex: number;
  readonly inputRate: number;
  /** Ascending by (relative) `input`. */
  readonly samples: readonly SweepSample[];
  readonly inputMin: number;
  readonly inputMax: number;
  /** Relative input at the backward-direction bracketed lock-up, if any. */
  readonly lockUpMin?: number;
  /** Relative input at the forward-direction bracketed lock-up, if any. */
  readonly lockUpMax?: number;
}

/** Options controlling `computeSweep`'s step size, travel/sample caps, and the rate used for `qDot`/`qDDot`. */
export interface SweepOptions {
  /** Step size for a rotary motor, in radians. Default `PI/180` (1 degree). */
  readonly rotaryStep?: number;
  /** Step size for a linear motor, as a fraction of `system.lengthScale`. Default `1/100`. */
  readonly linearStepFraction?: number;
  /** Max one-directional travel for a linear motor, as a multiple of `system.lengthScale`. Default 2. */
  readonly maxTravelFactor?: number;
  /** Max total samples (including the start sample). Default 2000. */
  readonly maxSamples?: number;
  /** The swept motor's rate used to compute every sample's `qDot`/`qDDot`. Default 1. */
  readonly inputRate?: number;
}

const DEFAULT_ROTARY_STEP = Math.PI / 180;
const DEFAULT_LINEAR_STEP_FRACTION = 1 / 100;
const DEFAULT_MAX_TRAVEL_FACTOR = 2;
const DEFAULT_MAX_SAMPLES = 2000;
const DEFAULT_INPUT_RATE = 1;
const FULL_ROTATION = 2 * Math.PI;
// Guards against a 360-times-repeated floating-point addition of
// `rotaryStep` landing a hair short of `fullRotationTarget` (observed:
// summing pi/180 360 times can under/overshoot 2*PI by ~1e-13) -- without
// this, the strict ">="/"<=" overshoot check below would take one
// spurious extra partial step before clamping exactly to the target,
// silently adding a 362nd sample to what must be an exact 361.
const FULL_ROTATION_EPSILON = 1e-9;
// Tighter than advanceDrive's own 1e-9 default: a full-rotation sweep
// chains ~360 accepted Newton solves, and the closure check downstream
// (traces.ts, and this module's own "first === last q" behavior) needs
// each individual step's contribution to accumulated drift to stay well
// under 1e-9 * lengthScale -- confirmed empirically to be necessary at the
// default tolerance.
const SWEEP_TOLERANCE = 1e-11;

/** Every solved sample's `qDot`/`qDDot` at `inputRate` on `motorIndex` (zero-filled, never NaN, if that rate solve isn't "ok" -- e.g. exactly at a lock-up). */
function sampleAt(
  system: KinematicSystem,
  state: SolvedState,
  motorIndex: number,
  startInput: number,
  inputRate: number,
): SweepSample {
  const motorCount = system.motors.length;
  const rates = new Float64Array(motorCount);
  rates[motorIndex] = inputRate;
  const accels = new Float64Array(motorCount);
  const rate = solveVelocityAcceleration(system, state.q, rates, accels);
  return {
    input: state.inputs[motorIndex] - startInput,
    q: Float64Array.from(state.q),
    qDot: rate.qDot,
    qDDot: rate.qDDot,
  };
}

function noneResult(
  system: KinematicSystem,
  start: SolvedState,
  motorIndex: number,
  inputRate: number,
): SweepResult {
  const sample: SweepSample = {
    input: 0,
    q: Float64Array.from(start.q),
    qDot: new Float64Array(system.n),
    qDDot: new Float64Array(system.n),
  };
  return {
    kind: "none",
    motorIndex,
    inputRate,
    samples: [sample],
    inputMin: 0,
    inputMax: 0,
  };
}

interface MarchResult {
  readonly samples: SweepSample[];
  readonly reachedFullRotation: boolean;
  readonly lockUpInput?: number;
}

/** Marches from `start` in direction `sign`, `step` at a time, up to `maxSteps` accepted samples, stopping on a full rotation, a lock-up, a failed step, or a travel cap. Never includes the start sample itself. */
function march(
  system: KinematicSystem,
  start: SolvedState,
  motorIndex: number,
  sign: 1 | -1,
  step: number,
  maxSteps: number,
  maxTravel: number | undefined,
  fullRotationTarget: number | undefined,
  inputRate: number,
  startInput: number,
): MarchResult {
  const samples: SweepSample[] = [];
  let state = start;

  for (let i = 0; i < maxSteps; i++) {
    let nextInput = state.inputs[motorIndex] + sign * step;
    let isFullRotationStep = false;

    if (fullRotationTarget !== undefined) {
      const overshoot =
        sign > 0
          ? nextInput >= fullRotationTarget - FULL_ROTATION_EPSILON
          : nextInput <= fullRotationTarget + FULL_ROTATION_EPSILON;
      if (overshoot) {
        nextInput = fullRotationTarget;
        isFullRotationStep = true;
      }
    } else if (maxTravel !== undefined) {
      const traveled = Math.abs(nextInput - startInput);
      if (traveled >= maxTravel) {
        nextInput = startInput + sign * maxTravel;
      }
    }

    const target = Float64Array.from(state.inputs);
    target[motorIndex] = nextInput;

    const result = advanceDrive(system, state, target, { tolerance: SWEEP_TOLERANCE });

    if (result.status === "locked") {
      state = result.state;
      const sample = sampleAt(system, state, motorIndex, startInput, inputRate);
      samples.push(sample);
      return { samples, reachedFullRotation: false, lockUpInput: sample.input };
    }

    if (result.status !== "ok") {
      return { samples, reachedFullRotation: false };
    }

    state = result.state;
    samples.push(sampleAt(system, state, motorIndex, startInput, inputRate));

    if (isFullRotationStep) {
      return { samples, reachedFullRotation: true };
    }

    if (maxTravel !== undefined) {
      const traveled = Math.abs(state.inputs[motorIndex] - startInput);
      if (traveled >= maxTravel - 1e-12) {
        return { samples, reachedFullRotation: false };
      }
    }
  }

  return { samples, reachedFullRotation: false };
}

/**
 * Precomputes the full usable range of `system.motors[motorIndex]` from
 * `start` (typically `referenceState(system)`). With 0 motors or an
 * out-of-range `motorIndex`, returns `kind: "none"` with just the start
 * sample -- never throws.
 */
export function computeSweep(
  system: KinematicSystem,
  start: SolvedState,
  motorIndex: number,
  options: SweepOptions = {},
): SweepResult {
  const inputRate = options.inputRate ?? DEFAULT_INPUT_RATE;
  const maxSamples = options.maxSamples ?? DEFAULT_MAX_SAMPLES;

  if (system.motors.length === 0 || motorIndex < 0 || motorIndex >= system.motors.length) {
    return noneResult(system, start, motorIndex, inputRate);
  }

  const motor = system.motors[motorIndex];
  const startInput = start.inputs[motorIndex];
  const startSample = sampleAt(system, start, motorIndex, startInput, inputRate);

  const step =
    motor.kind === "rotary"
      ? (options.rotaryStep ?? DEFAULT_ROTARY_STEP)
      : (options.linearStepFraction ?? DEFAULT_LINEAR_STEP_FRACTION) * system.lengthScale;

  const maxTravel =
    motor.kind === "linear"
      ? (options.maxTravelFactor ?? DEFAULT_MAX_TRAVEL_FACTOR) * system.lengthScale
      : undefined;

  const fullRotationTarget = motor.kind === "rotary" ? startInput + FULL_ROTATION : undefined;

  const forwardBudget = Math.max(maxSamples - 1, 0);
  const forward = march(
    system,
    start,
    motorIndex,
    1,
    step,
    forwardBudget,
    maxTravel,
    fullRotationTarget,
    inputRate,
    startInput,
  );

  if (forward.reachedFullRotation) {
    return {
      kind: "full-rotation",
      motorIndex,
      inputRate,
      samples: [startSample, ...forward.samples],
      inputMin: 0,
      inputMax: FULL_ROTATION,
    };
  }

  const backwardBudget = Math.max(maxSamples - 1 - forward.samples.length, 0);
  const backward =
    backwardBudget > 0
      ? march(
          system,
          start,
          motorIndex,
          -1,
          step,
          backwardBudget,
          maxTravel,
          undefined,
          inputRate,
          startInput,
        )
      : { samples: [] as SweepSample[], reachedFullRotation: false, lockUpInput: undefined };

  const reversedBackward = [...backward.samples].reverse();
  const samples = [...reversedBackward, startSample, ...forward.samples];

  const inputMin = reversedBackward.length > 0 ? reversedBackward[0].input : startSample.input;
  const inputMax =
    forward.samples.length > 0
      ? forward.samples[forward.samples.length - 1].input
      : startSample.input;

  return {
    kind: "bounded",
    motorIndex,
    inputRate,
    samples,
    inputMin,
    inputMax,
    lockUpMin: backward.lockUpInput,
    lockUpMax: forward.lockUpInput,
  };
}
