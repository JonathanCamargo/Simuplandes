import { describe, it, expect } from "vitest";
import { solveVelocityAcceleration } from "../kinematics";
import { createId, MechanismDocumentSchema } from "../model";
import { describeFrame } from "./frame";
import { forwardDynamics, inverseDynamics } from "./solve";
import { compileForDynamics, oscillator, pendulum } from "./__fixtures__/mechanisms";

const g = 9.81;

describe("describeFrame", () => {
  it("reports a driving motor's effort and power", () => {
    const omega = 2;
    const doc = pendulum({ motor: { drive: { mode: "constant", speed: omega } } });
    const { dyn, kin } = compileForDynamics(doc);
    const k = solveVelocityAcceleration(
      kin,
      kin.q0,
      Float64Array.from([omega]),
      new Float64Array(1),
    );
    const solution = inverseDynamics(dyn, 0, kin.q0, k.qDot, k.qDDot);
    const frame = describeFrame(dyn, 0, kin.q0, k.qDot, solution.lambda);
    expect(frame.drivers[0].effort).toBeCloseTo(0.5 * g * 0.5, 9);
    expect(frame.drivers[0].power).toBeCloseTo(0.5 * g * 0.5 * omega, 9);
    expect(frame.reactions.joints).toHaveLength(1);
  });

  it("reports an effort motor's effort and power along a slide", () => {
    const { dyn, kin } = compileForDynamics(oscillator({ effort: "4" }));
    const v = Float64Array.from([250, 0, 0]); // 0.25 m/s
    const solution = forwardDynamics(dyn, 0, kin.q0, v, new Float64Array(0));
    const frame = describeFrame(dyn, 0, kin.q0, v, solution.lambda);
    expect(frame.actuators[0].effort).toBe(4);
    expect(frame.actuators[0].power).toBeCloseTo(1, 12);
  });

  it("reports springs and energy", () => {
    const base = pendulum({ gravity: [0, 0] });
    const joint = base.joints[0];
    const doc = MechanismDocumentSchema.parse({
      ...base,
      springs: [
        {
          id: createId("spring"),
          kind: "torsional",
          jointId: joint.id,
          stiffness: 2,
          damping: 0.5,
          freeAngle: -0.25,
        },
      ],
    });
    const { dyn, kin } = compileForDynamics(doc);
    const v = Float64Array.from([0, 0, 1]);
    const solution = forwardDynamics(dyn, 0, kin.q0, v, new Float64Array(0));
    const frame = describeFrame(dyn, 0, kin.q0, v, solution.lambda);
    expect(frame.torsionalSprings[0].twist).toBeCloseTo(0.25, 12);
    expect(frame.torsionalSprings[0].torque).toBeCloseTo(-2 * 0.25 - 0.5 * 1, 12);
    expect(frame.energy.potential).toBeCloseTo(0.5 * 2 * 0.25 * 0.25, 12);
    expect(frame.energy.kinetic).toBeCloseTo(0.5 * (0.5 / 3) * 1, 12);
    expect(frame.linearSprings).toEqual([]);
  });
});
