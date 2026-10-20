import { describe, it, expect } from "vitest";
import { evalJacobian, solveVelocity, solveVelocityAcceleration, evalGamma } from "../kinematics";
import { build as buildFourBar } from "../kinematics/__fixtures__/fourBar";
import { build as buildDoubleParallelogram } from "../kinematics/__fixtures__/doubleParallelogram";
import { build as buildSliderCrank } from "../kinematics/__fixtures__/sliderCrank";
import { MechanismDocumentSchema } from "../model";
import { assembleForces, assembleMass } from "./assemble";
import { forwardDynamics, inverseDynamics, projectVelocity } from "./solve";
import { reactionsFromLambda } from "./reactions";
import { compileForDynamics, pendulum } from "./__fixtures__/mechanisms";

const g = 9.81;

describe("forwardDynamics", () => {
  it("drops a horizontal uniform rod at -3g/(2l)", () => {
    const { dyn } = compileForDynamics(pendulum());
    const zero = new Float64Array(dyn.kin.n);
    const solution = forwardDynamics(dyn, 0, dyn.kin.q0, zero, new Float64Array(0));
    expect(solution.status).toBe("ok");
    expect(solution.singular).toBe(false);
    expect(solution.qDDot[2]).toBeCloseTo((-3 * g) / 2, 9);
    // The frame origin is the pivot, so it does not accelerate.
    expect(solution.qDDot[0]).toBeCloseTo(0, 9);
    expect(solution.qDDot[1]).toBeCloseTo(0, 9);
  });

  it("gives the same physics in millimetres and metres", () => {
    const mm = compileForDynamics(pendulum({ unit: "mm", length: 800, angle: 0.4 })).dyn;
    const m = compileForDynamics(pendulum({ unit: "m", length: 0.8, angle: 0.4 })).dyn;
    const v = (n: number) => Float64Array.from({ length: n }, () => 0);
    const a = forwardDynamics(mm, 0, mm.kin.q0, v(3), new Float64Array(0));
    const b = forwardDynamics(m, 0, m.kin.q0, v(3), new Float64Array(0));
    expect(a.qDDot[2]).toBeCloseTo(b.qDDot[2], 9);
    for (let r = 0; r < a.lambda.length; r++) expect(a.lambda[r]).toBeCloseTo(b.lambda[r], 9);
  });

  it("matches the kinematic accelerations when every DOF is driven", () => {
    const doc = buildFourBar();
    const { dyn, kin } = compileForDynamics(doc);
    const q = kin.q0;
    const rates = Float64Array.from([1.5]);
    const accels = Float64Array.from([0.7]);
    const kinematic = solveVelocityAcceleration(kin, q, rates, accels);
    const fd = forwardDynamics(dyn, 0, q, kinematic.qDot, accels);
    for (let i = 0; i < kin.n; i++) expect(fd.qDDot[i]).toBeCloseTo(kinematic.qDDot[i], 8);
  });

  it("satisfies the acceleration constraints for a free mechanism", () => {
    const doc = MechanismDocumentSchema.parse({ ...buildSliderCrank(), motors: [] });
    const { dyn, kin } = compileForDynamics(doc);
    const v = solveVelocity(
      compileForDynamics(buildSliderCrank()).kin,
      kin.q0,
      Float64Array.from([2]),
    ).values;
    const fd = forwardDynamics(dyn, 0, kin.q0, v, new Float64Array(0));
    expect(fd.status).toBe("ok");
    const J = new Float64Array(kin.m * kin.n);
    evalJacobian(kin, kin.q0, J);
    const gamma = new Float64Array(kin.m);
    evalGamma(kin, kin.q0, v, new Float64Array(0), gamma);
    for (let r = 0; r < kin.m; r++) {
      let sum = 0;
      for (let c = 0; c < kin.n; c++) sum += J[r * kin.n + c] * fd.qDDot[c];
      expect(sum).toBeCloseTo(gamma[r], 6);
    }
  });

  it("rejects mismatched inputs", () => {
    const { dyn } = compileForDynamics(pendulum());
    expect(
      forwardDynamics(dyn, 0, new Float64Array(2), new Float64Array(3), new Float64Array(0)).status,
    ).toBe("invalid-input");
    expect(
      forwardDynamics(dyn, 0, dyn.kin.q0, new Float64Array(3), new Float64Array(1)).status,
    ).toBe("invalid-input");
    const nan = Float64Array.from([NaN, 0, 0]);
    expect(forwardDynamics(dyn, 0, dyn.kin.q0, nan, new Float64Array(0)).status).toBe(
      "invalid-input",
    );
  });

  it("reports an invalid effort", () => {
    const doc = pendulum({ motor: { dynamics: { mode: "effort", expression: "1/0 - 1/0" } } });
    const { dyn } = compileForDynamics(doc);
    const result = forwardDynamics(dyn, 0, dyn.kin.q0, new Float64Array(3), new Float64Array(0));
    expect(result.status).toBe("invalid-effort");
    expect(result.invalidMotorId).toBe(doc.motors[0].id);
  });

  it("is balanced by an effort equal to the static torque", () => {
    const doc = pendulum({
      motor: { dynamics: { mode: "effort", expression: `${0.5 * g * 0.5}` } },
    });
    const { dyn } = compileForDynamics(doc);
    const result = forwardDynamics(dyn, 0, dyn.kin.q0, new Float64Array(3), new Float64Array(0));
    expect(result.qDDot[2]).toBeCloseTo(0, 12);
  });
});

describe("inverseDynamics", () => {
  it("finds the torque that holds a horizontal rod", () => {
    const doc = pendulum({ motor: {} });
    const { dyn } = compileForDynamics(doc);
    const zero = new Float64Array(3);
    const solution = inverseDynamics(dyn, 0, dyn.kin.q0, zero, zero);
    expect(solution.status).toBe("ok");
    const reactions = reactionsFromLambda(dyn, dyn.kin.q0, solution.lambda);
    expect(reactions.motors[0].effort).toBeCloseTo(0.5 * g * 0.5, 9);
    expect(reactions.joints[0].fx).toBeCloseTo(0, 9);
    expect(reactions.joints[0].fy).toBeCloseTo(0.5 * g, 9);
  });

  it("adds the centripetal pull for a spinning rod", () => {
    const omega = 3;
    const doc = pendulum({ motor: { drive: { mode: "constant", speed: omega } } });
    const { dyn, kin } = compileForDynamics(doc);
    const kinematic = solveVelocityAcceleration(
      kin,
      kin.q0,
      Float64Array.from([omega]),
      Float64Array.from([0]),
    );
    const solution = inverseDynamics(dyn, 0, kin.q0, kinematic.qDot, kinematic.qDDot);
    const { joints, motors } = reactionsFromLambda(dyn, kin.q0, solution.lambda);
    expect(motors[0].effort).toBeCloseTo(0.5 * g * 0.5, 9);
    expect(joints[0].fx).toBeCloseTo(-0.5 * omega * omega * 0.5, 9);
    expect(joints[0].fy).toBeCloseTo(0.5 * g, 9);
  });

  it("agrees with forward dynamics on the multipliers", () => {
    const doc = buildFourBar();
    const { dyn, kin } = compileForDynamics(doc);
    const rates = Float64Array.from([2]);
    const accels = Float64Array.from([-1]);
    const kinematic = solveVelocityAcceleration(kin, kin.q0, rates, accels);
    const fd = forwardDynamics(dyn, 0, kin.q0, kinematic.qDot, accels);
    const id = inverseDynamics(dyn, 0, kin.q0, kinematic.qDot, kinematic.qDDot);
    for (let r = 0; r < kin.m; r++) expect(id.lambda[r]).toBeCloseTo(fd.lambda[r], 8);
  });

  it("finds minimum-norm reactions for redundant constraints", () => {
    const doc = buildDoubleParallelogram();
    const { dyn, kin } = compileForDynamics(doc);
    const kinematic = solveVelocityAcceleration(
      kin,
      kin.q0,
      Float64Array.from([1]),
      Float64Array.from([0]),
    );
    const solution = inverseDynamics(dyn, 0, kin.q0, kinematic.qDot, kinematic.qDDot);
    expect(solution.status).toBe("ok");
    expect(solution.singular).toBe(true);
    // The multipliers still balance the equations of motion: J^T lambda = Q - M a.
    const n = kin.n;
    const M = new Float64Array(n * n);
    const Q = new Float64Array(n);
    assembleMass(dyn, kin.q0, M);
    assembleForces(dyn, 0, kin.q0, kinematic.qDot, Q);
    const J = new Float64Array(kin.m * n);
    evalJacobian(kin, kin.q0, J);
    for (let c = 0; c < n; c++) {
      let jtl = 0;
      for (let r = 0; r < kin.m; r++) {
        jtl += ((J[r * n + c] * dyn.rowScale[r]) / dyn.colScale[c]) * solution.lambda[r];
      }
      let ma = 0;
      for (let k = 0; k < n; k++) ma += M[c * n + k] * kinematic.qDDot[k] * dyn.colScale[k];
      expect(jtl).toBeCloseTo(Q[c] - ma, 6);
    }
  });

  it("rejects mismatched inputs and invalid efforts", () => {
    const { dyn } = compileForDynamics(pendulum({ motor: {} }));
    expect(
      inverseDynamics(dyn, 0, dyn.kin.q0, new Float64Array(2), new Float64Array(3)).status,
    ).toBe("invalid-input");
    const effort = compileForDynamics(
      pendulum({ motor: { dynamics: { mode: "effort", expression: "x" } } }),
    ).dyn;
    expect(
      inverseDynamics(effort, 0, effort.kin.q0, new Float64Array(3), new Float64Array(3)).status,
    ).toBe("invalid-effort");
  });
});

describe("projectVelocity", () => {
  it("returns the unique velocity of a fully driven mechanism", () => {
    const { dyn, kin } = compileForDynamics(buildFourBar());
    const rates = Float64Array.from([2]);
    const projected = projectVelocity(dyn, kin.q0, new Float64Array(kin.n), rates);
    const exact = solveVelocity(kin, kin.q0, rates).values;
    expect(projected.status).toBe("ok");
    expect(projected.residual).toBeLessThan(1e-9);
    for (let i = 0; i < kin.n; i++) expect(projected.v[i]).toBeCloseTo(exact[i], 8);
  });

  it("removes the part of a guess that breaks a joint", () => {
    const { dyn } = compileForDynamics(pendulum());
    // Translating the frame origin would pull the pin apart; spinning is allowed.
    const guess = Float64Array.from([100, 50, 2]);
    const projected = projectVelocity(dyn, dyn.kin.q0, guess, new Float64Array(0));
    expect(projected.v[0]).toBeCloseTo(0, 9);
    expect(projected.v[1]).toBeCloseTo(0, 9);
    expect(projected.residual).toBeLessThan(1e-9);
  });

  it("rejects mismatched inputs", () => {
    const { dyn } = compileForDynamics(pendulum());
    expect(projectVelocity(dyn, dyn.kin.q0, new Float64Array(3), new Float64Array(2)).status).toBe(
      "invalid-input",
    );
  });
});
