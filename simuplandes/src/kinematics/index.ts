/**
 * Public barrel for `src/kinematics`: a pure TypeScript kinematic engine
 * (no React, Konva, matter-js, zustand or immer — only `../geom` and
 * `../model`, lint-enforced). Newton-Raphson position solving in absolute
 * coordinates for R/P joints (KIN-01), rotary/linear motors driven by
 * scrubber or time (KIN-02).
 *
 * A `KinematicSystem`'s `workspace` is mutated in place by every solve
 * call, so a compiled system is NOT re-entrant: use it from a single
 * logical thread of control (fine for this project's single-threaded
 * simulation loop), and never call into the same system concurrently from
 * two overlapping solves.
 */

export { KinematicsError, type KinematicsErrorCode } from "./errors";

export { compileExpression, ExpressionError, type CompiledExpression } from "./expression";

export {
  luFactor,
  luSolve,
  solveLeastSquares,
  estimateSingularValues,
  numericalRank,
  createLinalgWorkspace,
  type LuInfo,
  type LinalgWorkspace,
} from "./linalg";

export {
  compileDrive,
  evaluateDrivesAtTime,
  type DriveFunction,
  type DriveEvaluation,
} from "./drives";

export { evalResidual, evalJacobian, evalGamma, type CompiledConstraint } from "./constraints";

export { estimateDragInputDelta, type DragEstimate } from "./dragDrive";

export {
  compileSystem,
  linkPose,
  type KinematicSystem,
  type LinkSlot,
  type SiteRef,
  type CompiledMotor,
  type CompiledMarker,
  type SystemIssue,
  type SolverWorkspace,
} from "./system";

export {
  newtonSolve,
  solvePosition,
  referenceState,
  type NewtonOptions,
  type NewtonResult,
  type SolvedState,
  type PositionStatus,
  type PositionSolveResult,
} from "./position";

export {
  solveVelocity,
  solveAcceleration,
  solveVelocityAcceleration,
  type RateStatus,
  type RateResult,
} from "./velocity";

export {
  pointKinematics,
  computeFrameKinematics,
  type PointKinematics,
  type LinkKinematics,
  type FrameKinematics,
} from "./query";

export {
  analyzeSingularity,
  advanceDrive,
  advanceRocking,
  SINGULAR_RATIO,
  type SingularityInfo,
  type LockUp,
  type DriveStatus,
  type DriveStepResult,
  type RockingResult,
  type AdvanceOptions,
} from "./singularity";

export {
  assemble,
  jointResiduals,
  type JointViolation,
  type AssemblyResult,
  type AssemblyOptions,
} from "./assembly";

export {
  analyzeMobility,
  grueblerMobility,
  type MobilityReport,
  type GrueblerReport,
} from "./mobility";
