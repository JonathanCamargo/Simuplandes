/**
 * Public barrel for `src/dynamics`: planar rigid-body dynamics on top of the
 * kinematic engine. Pure TypeScript -- it may import only `../geom`,
 * `../model` and `../kinematics` (lint-enforced), and only `src/sim/**` may
 * import it.
 *
 * - `compileDynamics`: mass properties, gravity, loads, springs and effort
 *   motors over a compiled `KinematicSystem`.
 * - `inverseDynamics`/`forwardDynamics`: the one augmented solve, with the
 *   right-hand side picking which.
 * - `reactionsFromLambda`: joint reactions and motor efforts.
 * - `initialState`/`step`/`advance`: RK4 with constraint projection.
 */

export {
  compileDynamics,
  EFFORT_VARIABLES,
  type DynamicSystem,
  type DynamicsIssue,
  type Body,
  type CompileDynamicsOptions,
} from "./system";

export {
  jointCoordinateOf,
  evalCoordinate,
  type JointCoordinate,
  type AngleCoordinate,
  type SlideCoordinate,
} from "./coordinates";

export {
  assembleMass,
  assembleForces,
  actuatorEfforts,
  energy,
  springStates,
  type Energy,
  type ForceResult,
} from "./assemble";

export {
  forwardDynamics,
  inverseDynamics,
  projectVelocity,
  type DynamicsSolution,
  type DynamicsStatus,
  type VelocityProjection,
} from "./solve";

export {
  reactionsFromLambda,
  type JointReaction,
  type MotorEffort,
  type Reactions,
} from "./reactions";

export { describeFrame, type DynamicsFrame, type MotorState } from "./frame";

export {
  initialState,
  projectState,
  step,
  advance,
  DEFAULT_MAX_STEP,
  type DynamicState,
  type StepResult,
  type StepStatus,
} from "./integrate";
