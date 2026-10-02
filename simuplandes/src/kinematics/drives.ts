/**
 * Per-motor drive evaluation: turns a document's `MotorDrive` into a
 * `DriveFunction` (value/rate/accel at a time `t`), and evaluates every
 * motor in a compiled system at once.
 *
 * Scrubber mode needs no code here: callers pass input values straight to
 * `solvePosition` (see `position.ts`) — this module only covers the
 * time-driven case (`evaluateDrivesAtTime`).
 */

import { compileExpression } from "./expression";
import type { MotorDrive } from "../model";
import type { KinematicSystem } from "./system";

/** A compiled motor drive: the driven relative angle (rad) or displacement (model units), as a function of time in seconds (time 0 is the reference pose). */
export interface DriveFunction {
  value(t: number): number;
  rate(t: number): number;
  accel(t: number): number;
}

/** Compiles a `MotorDrive` into a `DriveFunction`. Throws `ExpressionError` for a bad expression. */
export function compileDrive(drive: MotorDrive): DriveFunction {
  if (drive.mode === "constant") {
    const speed = drive.speed;
    return {
      value: (t: number) => speed * t,
      rate: () => speed,
      accel: () => 0,
    };
  }

  const compiled = compileExpression(drive.expression); // throws ExpressionError

  return {
    value: (t: number) => compiled.evaluate(t),
    rate: (t: number) => {
      const h = 1e-6 * Math.max(1, Math.abs(t));
      return (compiled.evaluate(t + h) - compiled.evaluate(t - h)) / (2 * h);
    },
    accel: (t: number) => {
      const h = 1e-4 * Math.max(1, Math.abs(t));
      return (
        (compiled.evaluate(t + h) - 2 * compiled.evaluate(t) + compiled.evaluate(t - h)) / (h * h)
      );
    },
  };
}

/** Values/rates/accels for every motor in a system at time `t`, indexed like `system.motors`. */
export interface DriveEvaluation {
  readonly ok: boolean;
  readonly values: Float64Array;
  readonly rates: Float64Array;
  readonly accels: Float64Array;
  readonly invalidMotorIds: readonly string[];
}

/** Evaluates every motor's drive at time `t`. A motor with a null or non-finite drive is reported by id and does not make `ok` true. */
export function evaluateDrivesAtTime(system: KinematicSystem, t: number): DriveEvaluation {
  const count = system.motors.length;
  const values = new Float64Array(count);
  const rates = new Float64Array(count);
  const accels = new Float64Array(count);
  const invalidMotorIds: string[] = [];
  let ok = true;

  system.motors.forEach((motor, k) => {
    if (!motor.drive) {
      invalidMotorIds.push(motor.id);
      ok = false;
      return;
    }
    const value = motor.drive.value(t);
    const rate = motor.drive.rate(t);
    const accel = motor.drive.accel(t);
    if (!Number.isFinite(value) || !Number.isFinite(rate) || !Number.isFinite(accel)) {
      invalidMotorIds.push(motor.id);
      ok = false;
      return;
    }
    values[k] = value;
    rates[k] = rate;
    accels[k] = accel;
  });

  return { ok, values, rates, accels, invalidMotorIds };
}
