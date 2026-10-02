/**
 * DOF diagnosis for the Simulate-mode badge (SIM-06): `computeDofReport`
 * always headlines Gruebler's `F` (a pure topology count, `research
 * Pitfall 2` -- never derive the headline from rank instead), and derives
 * the badge's color/explanation/motor note from comparing `F` to the
 * Jacobian's numerical rank at the document's reference pose (D5's
 * Gruebler-vs-rank split, `src/kinematics/mobility.ts`).
 *
 * `classifyDof`'s six-case ladder (documented on the function itself) is
 * the ONLY place this comparison happens; nothing else in this module
 * re-derives `gruebler` from `rankDof` or vice-versa.
 */

import {
  compileSystem,
  analyzeMobility,
  grueblerMobility,
  type KinematicSystem,
} from "../kinematics";
import type { MechanismDocument } from "../model";

/** The DOF classification: why the badge looks the way it does. */
export type DofKind =
  "empty" | "invalid" | "ok" | "redundant-mobile" | "structure" | "multi-dof" | "singular";

/** The badge's color bucket. */
export type DofSeverity = "neutral" | "ok" | "warn" | "error";

/** The full DOF diagnosis for one document, at its reference pose. */
export interface DofReport {
  readonly kind: DofKind;
  readonly severity: DofSeverity;
  readonly gruebler: number | null;
  readonly linkCount: number;
  readonly jointCount: number;
  readonly rankDof: number | null;
  readonly redundantConstraints: number | null;
  readonly motorCount: number;
  readonly headlineKey: "sim.dof.badge" | "sim.dof.badgeEmpty";
  readonly explanationKey: string;
  readonly motorNoteKey: "sim.dof.motors.none" | "sim.dof.motors.many" | null;
  readonly values: Readonly<Record<string, number>>;
}

/**
 * Classifies a compiled, non-empty, non-invalid document's DOF from its
 * Gruebler count `gruebler` and its Jacobian-rank `rankDof` (joint rows
 * only, motors excluded -- see `analyzeMobility`'s own doc comment):
 *
 * 1. `rankDof === 0` -> `"structure"` (no freedom at all, however Gruebler counts it).
 * 2. `rankDof === gruebler` -> `"ok"` if that shared value is 1, else `"multi-dof"`.
 * 3. `rankDof > gruebler` -> `"singular"` if `gruebler >= 1` (a pose-local rank drop
 *    on an otherwise-mobile topology), else `"redundant-mobile"` (a structurally
 *    redundant topology, e.g. a double parallelogram, that is nonetheless mobile).
 * 4. Anything else (`rankDof < gruebler`, excluding the `rankDof === 0` case
 *    already handled above) falls back to `"singular"`.
 */
export function classifyDof(
  gruebler: number,
  rankDof: number,
): Exclude<DofKind, "empty" | "invalid"> {
  if (rankDof === 0) return "structure";
  if (rankDof === gruebler) return rankDof === 1 ? "ok" : "multi-dof";
  if (rankDof > gruebler) return gruebler >= 1 ? "singular" : "redundant-mobile";
  return "singular";
}

function severityFor(kind: Exclude<DofKind, "empty" | "invalid">): DofSeverity {
  if (kind === "ok") return "ok";
  if (kind === "structure") return "error";
  return "warn"; // redundant-mobile, multi-dof, singular
}

function toCamelCase(kind: string): string {
  return kind.replace(/-([a-z])/g, (_match, c: string) => c.toUpperCase());
}

function computeMotorNoteKey(
  motorCount: number,
  rankDof: number | null,
): DofReport["motorNoteKey"] {
  if (motorCount === 0 && (rankDof ?? 0) >= 1) return "sim.dof.motors.none";
  if (motorCount > 1) return "sim.dof.motors.many";
  return null;
}

function emptyReport(system: KinematicSystem): DofReport {
  const { linkCount, jointCount } = grueblerMobility(system);
  const motorCount = system.motors.length;
  return {
    kind: "empty",
    severity: "neutral",
    gruebler: null,
    linkCount,
    jointCount,
    rankDof: null,
    redundantConstraints: null,
    motorCount,
    headlineKey: "sim.dof.badgeEmpty",
    explanationKey: "sim.dof.explain.empty",
    motorNoteKey: null,
    values: { n: linkCount, j: jointCount, motorCount },
  };
}

function invalidReport(): DofReport {
  return {
    kind: "invalid",
    severity: "error",
    gruebler: null,
    linkCount: 0,
    jointCount: 0,
    rankDof: null,
    redundantConstraints: null,
    motorCount: 0,
    headlineKey: "sim.dof.badge",
    explanationKey: "sim.dof.explain.invalid",
    motorNoteKey: null,
    values: {},
  };
}

/**
 * The DOF report for `doc` at its reference pose (`system.q0` -- badge
 * updates on document change only; playback reuses `advanceDrive`'s own
 * per-frame `SingularityInfo` for a "near singular pose" flag instead of
 * recomputing this every frame). Never throws and never mutates `doc`:
 * an uncompilable document (dangling site/joint reference) yields `kind
 * "invalid"`; a document with no moving links yields `kind "empty"`.
 */
export function computeDofReport(doc: MechanismDocument): DofReport {
  let system: KinematicSystem;
  try {
    system = compileSystem(doc);
  } catch {
    return invalidReport();
  }

  const movingLinkCount = system.links.filter((link) => !link.isGround).length;
  if (movingLinkCount === 0) {
    return emptyReport(system);
  }

  const mobility = analyzeMobility(system, system.q0);
  const kind = classifyDof(mobility.gruebler, mobility.rankDof);
  const severity = severityFor(kind);
  const motorNoteKey = computeMotorNoteKey(mobility.motorCount, mobility.rankDof);

  return {
    kind,
    severity,
    gruebler: mobility.gruebler,
    linkCount: mobility.linkCount,
    jointCount: mobility.jointCount,
    rankDof: mobility.rankDof,
    redundantConstraints: mobility.redundantConstraints,
    motorCount: mobility.motorCount,
    headlineKey: "sim.dof.badge",
    explanationKey: `sim.dof.explain.${toCamelCase(kind)}`,
    motorNoteKey,
    values: {
      f: mobility.gruebler,
      n: mobility.linkCount,
      j: mobility.jointCount,
      rank: mobility.rankDof,
      count: mobility.redundantConstraints,
      motorCount: mobility.motorCount,
    },
  };
}
