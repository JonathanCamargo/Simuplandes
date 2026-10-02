/**
 * KIN-05: assembly by damped least squares. `assemble` is NOT a second
 * solver (D2) -- it is `newtonSolve` called with a larger `initialDamping`
 * and iteration cap than the per-frame continuation step, reusing the one
 * LM routine every other module in this package shares. `jointResiduals`
 * names every joint's current constraint violation, falling back to the
 * joint's id when it has no name.
 */

import { evalResidual } from "./constraints";
import { newtonSolve } from "./position";
import type { KinematicSystem } from "./system";

/** One joint's current constraint violation (and, if driven, its motor's row). */
export interface JointViolation {
  readonly jointId: string;
  readonly label: string;
  readonly motorId?: string;
  readonly residual: number;
}

/** The result of `assemble`. */
export interface AssemblyResult {
  readonly ok: boolean;
  readonly q: Float64Array;
  readonly residualNorm: number;
  readonly iterations: number;
  readonly violations: readonly JointViolation[];
}

/** Options controlling `assemble`'s damped-least-squares solve. */
export interface AssemblyOptions {
  /** Convergence tolerance on ||residual||_2. Default 1e-9. */
  readonly tolerance?: number;
  /** Maximum number of Newton trials. Default 200 (larger than the per-frame default). */
  readonly maxIterations?: number;
  /** Initial Levenberg-Marquardt damping. Default 1e-3 (larger than the per-frame default, for a possibly-far-off guess). */
  readonly initialDamping?: number;
  /** Whether motor driver rows participate. Default true. */
  readonly includeDrivers?: boolean;
  /** A joint's residual must exceed this to be reported as a violation. Default 1e-6 * system.lengthScale. */
  readonly violationTolerance?: number;
}

const DEFAULT_TOLERANCE = 1e-9;
const DEFAULT_MAX_ITERATIONS = 200;
const DEFAULT_INITIAL_DAMPING = 1e-3;

/**
 * Every joint's current residual: the Euclidean norm of its own 2
 * constraint rows, plus its motor's driver row if one drives it (recorded
 * as `motorId`). `label` is the joint's authored name, falling back to its
 * id when unnamed (matching `compileSystem`'s own label derivation).
 * Returned sorted by residual, descending -- the worst-violated joint
 * first.
 */
export function jointResiduals(
  system: KinematicSystem,
  q: Float64Array,
  inputs: Float64Array,
): JointViolation[] {
  const r = new Float64Array(system.m);
  evalResidual(system, q, inputs, r, system.m);

  const motorByJointId = new Map<string, { id: string; row: number }>();
  for (const motor of system.motors) {
    motorByJointId.set(motor.jointId, { id: motor.id, row: motor.row });
  }

  const violations: JointViolation[] = [];
  for (const c of system.constraints) {
    if (c.kind !== "revolute" && c.kind !== "prismatic") continue;
    let sumSq = r[c.row] * r[c.row] + r[c.row + 1] * r[c.row + 1];
    const motor = motorByJointId.get(c.jointId);
    if (motor) sumSq += r[motor.row] * r[motor.row];
    violations.push({
      jointId: c.jointId,
      label: c.label,
      motorId: motor?.id,
      residual: Math.sqrt(sumSq),
    });
  }

  violations.sort((a, b) => b.residual - a.residual);
  return violations;
}

/**
 * Pulls a not-yet-closed mechanism into assembly by damped least squares
 * (the same LM routine as the per-frame solve, D2 -- just a larger initial
 * damping and iteration cap). Never mutates `guess` (`newtonSolve` always
 * copies its starting vector). On convergence: `ok: true`, `violations: []`.
 * Otherwise: `ok: false`, `q` is the best-effort (lowest-residual-seen)
 * pose -- `newtonSolve` only ever accepts monotone-decreasing-residual
 * trial steps, so its returned `q` already IS that best iterate, not just
 * the last one tried -- and `violations` names every joint whose residual
 * exceeds `violationTolerance`, sorted worst-first.
 */
export function assemble(
  system: KinematicSystem,
  guess: Float64Array = system.q0,
  inputs: Float64Array = new Float64Array(system.motors.length),
  options: AssemblyOptions = {},
): AssemblyResult {
  const tolerance = options.tolerance ?? DEFAULT_TOLERANCE;
  const maxIterations = options.maxIterations ?? DEFAULT_MAX_ITERATIONS;
  const initialDamping = options.initialDamping ?? DEFAULT_INITIAL_DAMPING;
  const includeDrivers = options.includeDrivers ?? true;
  const violationTolerance = options.violationTolerance ?? 1e-6 * system.lengthScale;

  const result = newtonSolve(system, guess, inputs, {
    tolerance,
    maxIterations,
    initialDamping,
    includeDrivers,
  });

  if (result.converged) {
    return {
      ok: true,
      q: result.q,
      residualNorm: result.residualNorm,
      iterations: result.iterations,
      violations: [],
    };
  }

  const violations = jointResiduals(system, result.q, inputs).filter(
    (v) => v.residual > violationTolerance,
  );

  return {
    ok: false,
    q: result.q,
    residualNorm: result.residualNorm,
    iterations: result.iterations,
    violations,
  };
}
