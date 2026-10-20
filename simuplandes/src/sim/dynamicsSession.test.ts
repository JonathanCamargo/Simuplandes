import { describe, it, expect } from "vitest";
import { createDynamicsSession } from "./dynamicsSession";
import { build as buildFourBar } from "../kinematics/__fixtures__/fourBar";
import { impossibleFourBar } from "../kinematics/__fixtures__/misassembled";
import { doublePendulum, oscillator, pendulum } from "../dynamics/__fixtures__/mechanisms";
import {
  createEmptyDocument,
  createId,
  MechanismDocumentSchema,
  type MechanismDocument,
} from "../model";

describe("createDynamicsSession", () => {
  it("classifies a document with no moving link as empty", () => {
    const session = createDynamicsSession(createEmptyDocument());
    expect(session.summary.status).toBe("empty");
    expect(session.system).toBeNull();
    expect(session.start).toBeNull();
  });

  it("makes an unmotorized pendulum ready with one free DOF", () => {
    const session = createDynamicsSession(pendulum());
    expect(session.summary).toMatchObject({
      status: "ready",
      dof: 1,
      motionMotorCount: 0,
      effortMotorCount: 0,
    });
    expect(session.start?.t).toBe(0);
    expect(session.dynamics?.actuators).toHaveLength(0);
  });

  it("simulates a two-DOF double pendulum, which kinematics cannot drive", () => {
    expect(createDynamicsSession(doublePendulum()).summary).toMatchObject({
      status: "ready",
      dof: 2,
    });
  });

  it("treats a motion motor as a driver and an effort motor as a force", () => {
    const driven = createDynamicsSession(buildFourBar());
    expect(driven.summary).toMatchObject({ status: "ready", dof: 0, motionMotorCount: 1 });
    expect(driven.system?.motors).toHaveLength(1);

    const effort = createDynamicsSession(oscillator({ effort: "1" }));
    expect(effort.summary).toMatchObject({ status: "ready", dof: 1, effortMotorCount: 1 });
    expect(effort.system?.motors).toHaveLength(0);
    expect(effort.dynamics?.actuators).toHaveLength(1);
  });

  it("starts a motion motor at its drive's value at t = 0", () => {
    const doc = pendulum({ motor: { drive: { mode: "expression", expression: "0.5 + t" } } });
    const session = createDynamicsSession(doc);
    expect(session.summary.status).toBe("ready");
    expect(session.start!.q[2]).toBeCloseTo(0.5, 9);
    expect(session.start!.v[2]).toBeCloseTo(1, 6);
  });

  it("reports bad drive and effort expressions", () => {
    const badDrive = pendulum({ motor: { drive: { mode: "expression", expression: "t +" } } });
    expect(createDynamicsSession(badDrive).summary).toMatchObject({
      status: "invalid-expression",
      invalidMotorIds: [badDrive.motors[0].id],
    });
    const badEffort = oscillator({ effort: "q *" });
    expect(createDynamicsSession(badEffort).summary).toMatchObject({
      status: "invalid-expression",
      invalidMotorIds: [badEffort.motors[0].id],
    });
  });

  it("reports a mechanism that cannot be assembled", () => {
    const session = createDynamicsSession(impossibleFourBar());
    expect(session.summary.status).toBe("assembly-failed");
    expect(session.summary.violations.length).toBeGreaterThan(0);
  });

  it("reports more motion motors than the mechanism has DOF", () => {
    const base = buildFourBar();
    const second = base.joints.find((joint) => joint.name === "B")!;
    const doc = MechanismDocumentSchema.parse({
      ...base,
      motors: [
        ...base.motors,
        {
          id: createId("motor"),
          jointId: second.id,
          kind: "rotary",
          drive: { mode: "constant", speed: 0 },
        },
      ],
    });
    expect(createDynamicsSession(doc).summary.status).toBe("over-driven");
  });

  it("reports a document that does not compile, without throwing", () => {
    const base = buildFourBar();
    const doc = {
      ...base,
      motors: [{ ...base.motors[0], jointId: "joint-does-not-exist" }],
    } as MechanismDocument;
    const session = createDynamicsSession(doc);
    expect(session.summary.status).toBe("invalid");
    expect(session.summary.errorMessage).toMatch(/joint-does-not-exist/);
  });
});
