/**
 * Pure simulation-session classifier: turns any `MechanismDocument` into a
 * `SimSession` describing what can be simulated and how, without ever
 * throwing or mutating the document. This is the Phase 5 seam's other half
 * of `poses.ts` -- everything downstream (transport, DOF badge, hint text)
 * reads a `SimSessionSummary`, never `src/kinematics` directly.
 *
 * v1 limitation (SIM-02): the transport drives only `document.motors[0]`.
 * A document with more than one motor still classifies and simulates fine;
 * `ignoredMotorCount` tells the UI how many motors are along for the ride.
 */

import {
  assemble,
  analyzeMobility,
  compileSystem,
  jointResiduals,
  type KinematicSystem,
  type MobilityReport,
  type SolvedState,
} from "../kinematics";
import { indexDocument, type Id, type Joint, type MechanismDocument, type Motor } from "../model";

/** The synthetic motor id used for a document with no motor but a drivable rank-1 DOF. */
export const TEMP_DRIVER_ID = "sim:temporary-driver";

/** What `createSimSession` classified the document as. */
export type SimSessionStatus = "ready" | "not-drivable" | "assembly-failed" | "invalid" | "empty";

/** Why a `"not-drivable"` document can't be driven by the transport's single input. */
export type NotDrivableReason = "no-dof" | "multi-dof" | "no-input";

/** Where the driven input comes from: an authored motor, a synthetic one-off driver, or none. */
export type DrivingMode = "motor" | "temporary" | "none";

/** The driven input's valid relative-input range (rad for rotary, length units for linear). */
export interface SimRange {
  readonly min: number;
  readonly max: number;
  readonly fullRotation: boolean;
}

/** Everything the Phase 5 UI needs to know about the driven input and drivability, computed once per document change. */
export interface SimSessionSummary {
  readonly status: SimSessionStatus;
  readonly reason: NotDrivableReason | null;
  readonly drivingMode: DrivingMode;
  readonly inputKind: "rotary" | "linear" | null;
  readonly inputJointId: Id | null;
  readonly inputMotorId: Id | null;
  readonly inputLabel: string;
  readonly ignoredMotorCount: number;
  readonly inputDisplayOffset: number;
  readonly gruebler: number | null;
  readonly rankDof: number | null;
  readonly violations: readonly { readonly jointId: Id; readonly label: string }[];
  readonly errorMessage: string | null;
}

/** A classified simulation session: the source document, its summary, and (when compilable) the compiled system and its assembled/reference start state. */
export interface SimSession {
  readonly document: MechanismDocument;
  readonly summary: SimSessionSummary;
  readonly system: KinematicSystem | null;
  readonly start: SolvedState | null;
  readonly motorIndex: number;
}

/** The summary fields fully determined by "which input does the transport drive" (step 2), before compilation. */
interface DrivenInputInfo {
  readonly drivingMode: DrivingMode;
  readonly inputKind: "rotary" | "linear" | null;
  readonly inputJointId: Id | null;
  readonly inputMotorId: Id | null;
  readonly inputLabel: string;
  readonly ignoredMotorCount: number;
}

/** `DrivenInputInfo` plus the one-motor document to compile. */
interface DrivenInputChoice extends DrivenInputInfo {
  readonly simDoc: MechanismDocument;
}

/**
 * The first joint (in document order) whose two sites belong to exactly one
 * ground link and one moving link -- GraphThe's "first binary neighbor of
 * ground" input convention. R joints are preferred: every R joint is
 * scanned first, then every P joint, each in document order.
 */
function findTemporaryDriverJoint(doc: MechanismDocument): Joint | null {
  const index = indexDocument(doc);
  const isGroundMovingPair = (joint: Joint): boolean => {
    const linkA = index.sites.get(joint.siteA)?.link;
    const linkB = index.sites.get(joint.siteB)?.link;
    if (!linkA || !linkB) return false;
    return linkA.isGround !== linkB.isGround;
  };
  const firstR = doc.joints.find((joint) => joint.type === "R" && isGroundMovingPair(joint));
  if (firstR) return firstR;
  return doc.joints.find((joint) => joint.type === "P" && isGroundMovingPair(joint)) ?? null;
}

/**
 * Chooses the input the transport will drive, and builds `simDoc` -- a
 * shallow-spread copy of `doc` restricted to that one input. `doc` itself is
 * never touched: `simDoc.motors` is always either `[doc.motors[0]]` (a
 * one-element slice of the SAME motor object) or a brand-new array holding a
 * synthetic driver.
 */
function chooseDrivenInput(doc: MechanismDocument): DrivenInputChoice {
  if (doc.motors.length >= 1) {
    const motor = doc.motors[0];
    const joint = indexDocument(doc).joints.get(motor.jointId);
    const jointLabel = joint?.name || joint?.id || motor.jointId;
    return {
      simDoc: { ...doc, motors: [motor] },
      drivingMode: "motor",
      inputKind: motor.kind,
      inputJointId: motor.jointId,
      inputMotorId: motor.id,
      inputLabel: motor.name || jointLabel,
      ignoredMotorCount: doc.motors.length - 1,
    };
  }

  const tempJoint = findTemporaryDriverJoint(doc);
  if (!tempJoint) {
    return {
      simDoc: doc,
      drivingMode: "none",
      inputKind: null,
      inputJointId: null,
      inputMotorId: null,
      inputLabel: "",
      ignoredMotorCount: 0,
    };
  }

  const kind: "rotary" | "linear" = tempJoint.type === "R" ? "rotary" : "linear";
  const tempMotor: Motor = {
    id: TEMP_DRIVER_ID,
    name: "",
    jointId: tempJoint.id,
    kind,
    drive: { mode: "constant", speed: 1 },
  };
  return {
    simDoc: { ...doc, motors: [tempMotor] },
    drivingMode: "temporary",
    inputKind: kind,
    inputJointId: tempJoint.id,
    inputMotorId: null,
    inputLabel: tempJoint.name || tempJoint.id,
    ignoredMotorCount: 0,
  };
}

/** The compiled system's rotary driver offset (`dThetaRef`) for `motors[0]`, or 0 (linear, or no rotary driver). */
function rotaryDriverOffset(system: KinematicSystem): number {
  for (const constraint of system.constraints) {
    if (constraint.kind === "rotary-driver" && constraint.motorIndex === 0) {
      return constraint.dThetaRef;
    }
  }
  return 0;
}

/**
 * Classifies drivability (step 6): the joint-rows-only rank DOF decides
 * no-dof/multi-dof first (it's a topology fact, independent of what drives
 * it); only then does the presence/adequacy of a driven input matter. A
 * real authored motor must also fully drive the pose's rank DOF
 * (`mobility.drivenDof === 0`) -- a motor mounted on a redundant/ineffective
 * row does not make the mechanism ready.
 *
 * Exported for direct unit testing: `"no-input"` requires a document with no
 * ground-connected joint anywhere, but ANY floating (ungrounded) rigid
 * component provably contributes at least 3 to `rankDof` (its own free
 * translation + rotation, which no internal joint can constrain) -- so a
 * real compiled document can only ever reach this branch with `rankDof`
 * already >= 3, never exactly 1. `classifyDrivability` is tested directly
 * against a synthetic `MobilityReport` instead of relying on
 * `createSimSession` to (impossibly) construct one.
 */
export function classifyDrivability(
  drivingMode: DrivingMode,
  mobility: MobilityReport,
): { status: SimSessionStatus; reason: NotDrivableReason | null } {
  if (mobility.rankDof === 0) return { status: "not-drivable", reason: "no-dof" };
  if (mobility.rankDof > 1) return { status: "not-drivable", reason: "multi-dof" };
  if (drivingMode === "none") return { status: "not-drivable", reason: "no-input" };
  if (drivingMode === "motor" && mobility.drivenDof !== 0) {
    return { status: "not-drivable", reason: "multi-dof" };
  }
  return { status: "ready", reason: null };
}

function baseSummary(
  info: DrivenInputInfo,
  inputDisplayOffset: number,
): Omit<
  SimSessionSummary,
  "status" | "reason" | "gruebler" | "rankDof" | "violations" | "errorMessage"
> {
  return {
    drivingMode: info.drivingMode,
    inputKind: info.inputKind,
    inputJointId: info.inputJointId,
    inputMotorId: info.inputMotorId,
    inputLabel: info.inputLabel,
    ignoredMotorCount: info.ignoredMotorCount,
    inputDisplayOffset,
  };
}

const EMPTY_INPUT_INFO: DrivenInputInfo = {
  drivingMode: "none",
  inputKind: null,
  inputJointId: null,
  inputMotorId: null,
  inputLabel: "",
  ignoredMotorCount: 0,
};

function emptySession(doc: MechanismDocument): SimSession {
  return {
    document: doc,
    summary: {
      status: "empty",
      reason: null,
      ...baseSummary(EMPTY_INPUT_INFO, 0),
      gruebler: null,
      rankDof: null,
      violations: [],
      errorMessage: null,
    },
    system: null,
    start: null,
    motorIndex: -1,
  };
}

function invalidSession(
  doc: MechanismDocument,
  choice: DrivenInputChoice,
  motorIndex: number,
  err: unknown,
): SimSession {
  // compileSystem only ever throws Error instances (KinematicsError, or a
  // programmer error surfaced as-is) -- see its TSDoc.
  const message = (err as Error).message;
  return {
    document: doc,
    summary: {
      status: "invalid",
      reason: null,
      ...baseSummary(choice, 0),
      gruebler: null,
      rankDof: null,
      violations: [],
      errorMessage: message,
    },
    system: null,
    start: null,
    motorIndex,
  };
}

/**
 * Classifies `doc` for simulation. Never throws, never mutates `doc`.
 *
 * Algorithm:
 * 1. No moving link at all -> `"empty"`.
 * 2. Choose the driven input (`chooseDrivenInput`): the first authored
 *    motor, or -- when there is none -- a synthetic temporary driver on the
 *    first ground-to-moving R joint (falling back to a P joint), or no
 *    input at all when neither exists.
 * 3. `compileSystem` the resulting one-motor document; any thrown error
 *    (dangling reference, bad joint/motor pairing, ...) becomes `"invalid"`.
 * 4. If the reference pose already satisfies every joint (no violation at
 *    all), it IS the start state. Otherwise, `assemble` from `q0`: success
 *    becomes the start state; failure becomes `"assembly-failed"` (the
 *    compiled `system` is still returned -- only `start` is null).
 * 5. Mobility (Gruebler + Jacobian rank) is analyzed at the resolved start
 *    pose.
 * 6. Drivability is classified from rank DOF and the driven input (see
 *    `classifyDrivability`).
 * 7. `inputDisplayOffset` is read off the compiled rotary driver row, if any.
 */
export function createSimSession(doc: MechanismDocument): SimSession {
  const hasMovingLink = doc.links.some((link) => !link.isGround);
  if (!hasMovingLink) return emptySession(doc);

  const choice = chooseDrivenInput(doc);
  const motorIndex = choice.drivingMode === "none" ? -1 : 0;

  let system: KinematicSystem;
  try {
    system = compileSystem(choice.simDoc);
  } catch (err) {
    return invalidSession(doc, choice, motorIndex, err);
  }

  const inputs = new Float64Array(system.motors.length);
  const initialViolations = jointResiduals(system, system.q0, inputs);

  let start: SolvedState | null;
  let qForMobility: Float64Array;
  let assemblyViolations: readonly { readonly jointId: Id; readonly label: string }[] = [];

  if (initialViolations.length > 0) {
    const assembled = assemble(system, system.q0, inputs);
    qForMobility = assembled.q;
    if (assembled.ok) {
      start = { q: assembled.q, inputs };
    } else {
      start = null;
      assemblyViolations = assembled.violations.map((v) => ({
        jointId: v.jointId,
        label: v.label,
      }));
    }
  } else {
    qForMobility = system.q0;
    start = { q: Float64Array.from(system.q0), inputs };
  }

  const inputDisplayOffset = rotaryDriverOffset(system);

  if (!start) {
    return {
      document: doc,
      summary: {
        status: "assembly-failed",
        reason: null,
        ...baseSummary(choice, inputDisplayOffset),
        gruebler: null,
        rankDof: null,
        violations: assemblyViolations,
        errorMessage: null,
      },
      system,
      start: null,
      motorIndex,
    };
  }

  const mobility = analyzeMobility(system, qForMobility);
  const { status, reason } = classifyDrivability(choice.drivingMode, mobility);

  return {
    document: doc,
    summary: {
      status,
      reason,
      ...baseSummary(choice, inputDisplayOffset),
      gruebler: mobility.gruebler,
      rankDof: mobility.rankDof,
      violations: [],
      errorMessage: null,
    },
    system,
    start,
    motorIndex,
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/** The value congruent to `value` modulo `period` that is nearest to `target`. */
function nearestCongruent(value: number, target: number, period: number): number {
  const diff = value - target;
  const wrapped = diff - period * Math.round(diff / period);
  return target + wrapped;
}

function wrapDegrees(deg: number): number {
  const wrapped = deg % 360;
  return wrapped < 0 ? wrapped + 360 : wrapped;
}

const TWO_PI = 2 * Math.PI;
const RAD_TO_DEG = 180 / Math.PI;
const DEG_TO_RAD = Math.PI / 180;

/**
 * The scrubber's displayed value for a relative motor `input`: degrees
 * (`(offset + input) * 180/pi`, wrapped to `[0, 360)` only for a full
 * rotation range) for a rotary input, or the input itself (length units,
 * `inputDisplayOffset` is always 0 for linear) for a linear input.
 */
export function inputDisplayValue(
  summary: SimSessionSummary,
  range: SimRange | null,
  input: number,
): number {
  if (summary.inputKind === "linear" || summary.inputKind === null) {
    return input;
  }
  const deg = (summary.inputDisplayOffset + input) * RAD_TO_DEG;
  return range?.fullRotation ? wrapDegrees(deg) : deg;
}

/**
 * The relative motor input for a scrubber `display` value -- the inverse of
 * `inputDisplayValue`. For a full-rotation rotary range, the wrapped display
 * maps to infinitely many congruent inputs; this picks the one nearest to
 * `currentInput` (never jumps a full turn on drag). For a bounded rotary or
 * linear range, the result is clamped to `[range.min, range.max]`; a null
 * range applies no clamp.
 */
export function inputFromDisplay(
  summary: SimSessionSummary,
  range: SimRange | null,
  display: number,
  currentInput: number,
): number {
  if (summary.inputKind === "linear" || summary.inputKind === null) {
    return range ? clamp(display, range.min, range.max) : display;
  }
  const raw = display * DEG_TO_RAD - summary.inputDisplayOffset;
  if (range?.fullRotation) {
    return nearestCongruent(raw, currentInput, TWO_PI);
  }
  return range ? clamp(raw, range.min, range.max) : raw;
}
