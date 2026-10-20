/**
 * `describeFrame`: everything readable about one solved dynamics frame --
 * joint reactions, motor efforts and power, spring states and energy --
 * computed once so plots and readouts never touch the solver.
 */

import { energy as frameEnergy, actuatorEfforts, springStates, type Energy } from "./assemble";
import { evalCoordinate, type JointCoordinate } from "./coordinates";
import { reactionsFromLambda, type Reactions } from "./reactions";
import type { DynamicSystem } from "./system";

/** A motor's effort (N·m or N) and power (W, positive when the motor does work). */
export interface MotorState {
  readonly effort: number;
  readonly power: number;
}

/** The readable state of one frame. Motor arrays follow `kin.motors` and `dyn.actuators`. */
export interface DynamicsFrame {
  readonly reactions: Reactions;
  readonly drivers: readonly MotorState[];
  readonly actuators: readonly MotorState[];
  /** Linear springs: current length (model units) and tension (N). */
  readonly linearSprings: readonly { readonly length: number; readonly force: number }[];
  /** Torsional springs: twist from the free angle (rad) and the torque they apply (N·m). */
  readonly torsionalSprings: readonly { readonly twist: number; readonly torque: number }[];
  readonly energy: Energy;
}

/** A joint coordinate's rate in SI (rad/s, or m/s for a slide). */
function coordinateRateSI(
  dyn: DynamicSystem,
  q: Float64Array,
  v: Float64Array,
  coord: JointCoordinate,
): number {
  const grad = dyn.workspace.grad;
  evalCoordinate(dyn.kin, q, coord, grad);
  let rate = 0;
  for (let i = 0; i < v.length; i++) rate += grad[i] * v[i];
  return coord.kind === "slide" ? rate * dyn.metersPerUnit : rate;
}

/** Describes the frame `(t, q, v)` whose multipliers are `lambda`. */
export function describeFrame(
  dyn: DynamicSystem,
  t: number,
  q: Float64Array,
  v: Float64Array,
  lambda: Float64Array,
): DynamicsFrame {
  const reactions = reactionsFromLambda(dyn, q, lambda);

  const drivers = reactions.motors.map((motor, k) => ({
    effort: motor.effort,
    power: motor.effort * coordinateRateSI(dyn, q, v, dyn.driverCoordinates[k]),
  }));

  const efforts = actuatorEfforts(dyn, t, q, v);
  const actuators = dyn.actuators.map((actuator, k) => ({
    effort: efforts[k],
    power: efforts[k] * coordinateRateSI(dyn, q, v, actuator.coord),
  }));

  const torsionalSprings = dyn.torsionalSprings.map((spring) => {
    const grad = dyn.workspace.grad;
    const value = evalCoordinate(dyn.kin, q, spring.coord, grad);
    let rate = 0;
    for (let i = 0; i < v.length; i++) rate += grad[i] * v[i];
    const twist = value - spring.freeAngle;
    return { twist, torque: -spring.stiffness * twist - spring.damping * rate };
  });

  return {
    reactions,
    drivers,
    actuators,
    linearSprings: springStates(dyn, q, v),
    torsionalSprings,
    energy: frameEnergy(dyn, q, v),
  };
}
