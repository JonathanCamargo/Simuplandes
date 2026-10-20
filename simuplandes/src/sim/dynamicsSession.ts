/**
 * Pure dynamics-session classifier: the forward-dynamics counterpart of
 * `session.ts`. It never throws and never mutates the document.
 *
 * Unlike kinematic simulation, dynamics does not need the mechanism to be
 * fully driven by one input. Motors set to follow their motion become
 * kinematic drivers (prescribed in time); motors set to an effort, springs,
 * gravity and loads supply forces; whatever freedom is left moves under
 * them. So a double pendulum (2 DOF, no motor) is perfectly simulable here.
 */

import {
  analyzeMobility,
  assemble,
  compileSystem,
  evaluateDrivesAtTime,
  jointResiduals,
  type KinematicSystem,
} from "../kinematics";
import { compileDynamics, initialState, type DynamicState, type DynamicSystem } from "../dynamics";
import type { Id, MechanismDocument } from "../model";

/** What `createDynamicsSession` classified the document as. */
export type DynamicsSessionStatus =
  "ready" | "empty" | "invalid" | "invalid-expression" | "assembly-failed" | "over-driven";

/** Everything the transport needs to know about a dynamics session. */
export interface DynamicsSessionSummary {
  readonly status: DynamicsSessionStatus;
  /** Free DOF left after the motion drivers (`null` until compiled and assembled). */
  readonly dof: number | null;
  readonly motionMotorCount: number;
  readonly effortMotorCount: number;
  readonly violations: readonly { readonly jointId: Id; readonly label: string }[];
  readonly invalidMotorIds: readonly Id[];
  readonly errorMessage: string | null;
}

/** A classified dynamics session and, when ready, its compiled systems and consistent start state. */
export interface DynamicsSession {
  readonly document: MechanismDocument;
  readonly summary: DynamicsSessionSummary;
  readonly system: KinematicSystem | null;
  readonly dynamics: DynamicSystem | null;
  readonly start: DynamicState | null;
}

/** Classifies `doc` for forward dynamics. Never throws, never mutates `doc`. */
export function createDynamicsSession(doc: MechanismDocument): DynamicsSession {
  const motionMotors = doc.motors.filter((motor) => motor.dynamics.mode === "motion");
  const base = {
    motionMotorCount: motionMotors.length,
    effortMotorCount: doc.motors.length - motionMotors.length,
  };
  const result = (
    summary: Omit<DynamicsSessionSummary, "motionMotorCount" | "effortMotorCount">,
    system: KinematicSystem | null = null,
    dynamics: DynamicSystem | null = null,
    start: DynamicState | null = null,
  ): DynamicsSession => ({
    document: doc,
    summary: { ...base, ...summary },
    system,
    dynamics,
    start,
  });
  const noDetails = { dof: null, violations: [], invalidMotorIds: [], errorMessage: null };

  if (!doc.links.some((link) => !link.isGround)) return result({ status: "empty", ...noDetails });

  let system: KinematicSystem;
  let dynamics: DynamicSystem;
  try {
    system = compileSystem({ ...doc, motors: motionMotors });
    dynamics = compileDynamics(doc, system, { efforts: true });
  } catch (err) {
    return result({ status: "invalid", ...noDetails, errorMessage: (err as Error).message });
  }

  const drives = evaluateDrivesAtTime(system, 0);
  const invalidMotorIds = [
    ...drives.invalidMotorIds,
    ...dynamics.issues.map((issue) => issue.motorId),
  ];
  if (invalidMotorIds.length > 0) {
    return result(
      { status: "invalid-expression", ...noDetails, invalidMotorIds },
      system,
      dynamics,
    );
  }

  let q = system.q0;
  if (jointResiduals(system, q, drives.values).length > 0) {
    const assembled = assemble(system, q, drives.values);
    if (!assembled.ok) {
      return result(
        {
          status: "assembly-failed",
          ...noDetails,
          violations: assembled.violations.map((v) => ({ jointId: v.jointId, label: v.label })),
        },
        system,
        dynamics,
      );
    }
    q = assembled.q;
  }

  const mobility = analyzeMobility(system, q);
  const jointRank = system.n - mobility.rankDof;
  const fullRank = system.n - mobility.drivenDof;
  if (fullRank - jointRank < system.motors.length) {
    return result({ status: "over-driven", ...noDetails, dof: 0 }, system, dynamics);
  }

  const initial = initialState(dynamics, q, 0);
  if (initial.status !== "ok") {
    return result(
      { status: "assembly-failed", ...noDetails, dof: mobility.drivenDof },
      system,
      dynamics,
    );
  }

  return result(
    { status: "ready", ...noDetails, dof: mobility.drivenDof },
    system,
    dynamics,
    initial.state,
  );
}
