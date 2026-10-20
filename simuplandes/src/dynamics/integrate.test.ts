import { describe, it, expect } from "vitest";
import { evalResidual } from "../kinematics";
import { build as buildNonGrashof } from "../kinematics/__fixtures__/nonGrashofFourBar";
import { MechanismDocumentSchema } from "../model";
import { energy } from "./assemble";
import { advance, initialState, projectState, step, type DynamicState } from "./integrate";
import {
  compileForDynamics,
  doublePendulum,
  oscillator,
  pendulum,
} from "./__fixtures__/mechanisms";
import type { DynamicSystem } from "./system";

const g = 9.81;

function start(dyn: DynamicSystem): DynamicState {
  const result = initialState(dyn, dyn.kin.q0);
  expect(result.status).toBe("ok");
  return result.state;
}

function totalEnergy(dyn: DynamicSystem, state: DynamicState): number {
  const e = energy(dyn, state.q, state.v);
  return e.kinetic + e.potential;
}

describe("initialState", () => {
  it("starts a free mechanism at rest", () => {
    const { dyn } = compileForDynamics(pendulum());
    const state = start(dyn);
    for (const rate of state.v) expect(rate).toBeCloseTo(0, 12);
    expect(state.t).toBe(0);
  });

  it("starts a motion-driven mechanism at its drive rate", () => {
    const { dyn } = compileForDynamics(
      pendulum({ motor: { drive: { mode: "constant", speed: 2 } } }),
    );
    expect(start(dyn).v[2]).toBeCloseTo(2, 9);
  });

  it("reports a motion motor whose drive does not compile", () => {
    const doc = pendulum({ motor: { drive: { mode: "expression", expression: "t +" } } });
    const { dyn } = compileForDynamics(doc);
    const result = initialState(dyn, dyn.kin.q0);
    expect(result.status).toBe("invalid-drive");
    expect(result.motorId).toBe(doc.motors[0].id);
  });

  it("reports positions that cannot be reached", () => {
    // A rod driven 1000 rad away from where Newton starts is fine, but a
    // drive that pulls a non-Grashof four-bar past its lock cannot close.
    const base = buildNonGrashof();
    const doc = MechanismDocumentSchema.parse({
      ...base,
      motors: [{ ...base.motors[0], drive: { mode: "expression", expression: "3" } }],
    });
    const { dyn } = compileForDynamics(doc);
    expect(projectState(dyn, 0, dyn.kin.q0, new Float64Array(dyn.kin.n)).status).toBe(
      "projection-failed",
    );
  });
});

describe("step and advance", () => {
  it("swing a pendulum with its small-amplitude period", () => {
    const { dyn } = compileForDynamics(pendulum({ angle: -Math.PI / 2 + 0.02 }));
    let state = start(dyn);
    const crossings: number[] = [];
    let previous = state.q[2] + Math.PI / 2;
    for (let i = 0; i < 3500; i++) {
      const result = step(dyn, state, 1e-3);
      expect(result.status).toBe("ok");
      const offset = result.state.q[2] + Math.PI / 2;
      if (previous > 0 !== offset > 0) {
        crossings.push(state.t + (1e-3 * previous) / (previous - offset));
      }
      previous = offset;
      state = result.state;
    }
    expect(crossings.length).toBeGreaterThanOrEqual(4);
    const period = (2 * (crossings[3] - crossings[0])) / 3;
    expect(period).toBeCloseTo(2 * Math.PI * Math.sqrt(2 / (3 * g)), 3);
  });

  it("conserves energy for a large swing", () => {
    const { dyn } = compileForDynamics(pendulum());
    const state = start(dyn);
    const before = totalEnergy(dyn, state);
    const result = advance(dyn, state, 3);
    expect(result.status).toBe("ok");
    expect(result.state.t).toBe(3);
    expect(Math.abs(totalEnergy(dyn, result.state) - before)).toBeLessThan(1e-6 * 0.5 * g * 0.5);
  });

  it("conserves energy and keeps the joints closed for a double pendulum", () => {
    const { dyn } = compileForDynamics(doublePendulum());
    const state = start(dyn);
    const before = totalEnergy(dyn, state);
    const result = advance(dyn, state, 2);
    expect(result.status).toBe("ok");
    expect(Math.abs(totalEnergy(dyn, result.state) - before)).toBeLessThan(
      1e-5 * Math.abs(before) + 1e-6,
    );
    const residual = new Float64Array(dyn.kin.m);
    evalResidual(dyn.kin, result.state.q, new Float64Array(0), residual);
    for (const r of residual) expect(Math.abs(r)).toBeLessThan(1e-8);
  });

  it("follows the analytic spring-mass oscillation", () => {
    const { dyn } = compileForDynamics(oscillator({ mass: 2, stiffness: 800, stretch: 20 }));
    const result = advance(dyn, start(dyn), 1);
    const omega = Math.sqrt(800 / 2);
    const expected = 100 + 20 * Math.cos(omega * 1);
    expect(result.state.q[0]).toBeCloseTo(expected, 4);
  });

  it("follows the analytic damped oscillation", () => {
    const { dyn } = compileForDynamics(
      oscillator({ mass: 2, stiffness: 800, damping: 8, stretch: 20 }),
    );
    const t = 0.7;
    const result = advance(dyn, start(dyn), t);
    const omega = Math.sqrt(800 / 2);
    const zeta = 8 / (2 * Math.sqrt(800 * 2));
    const omegaD = omega * Math.sqrt(1 - zeta * zeta);
    const expected =
      100 +
      20 *
        Math.exp(-zeta * omega * t) *
        (Math.cos(omegaD * t) + (zeta / Math.sqrt(1 - zeta * zeta)) * Math.sin(omegaD * t));
    expect(result.state.q[0]).toBeCloseTo(expected, 4);
  });

  it("spins a free rod up under a constant motor torque", () => {
    const doc = pendulum({
      gravity: [0, 0],
      motor: { dynamics: { mode: "effort", expression: "0.2" } },
    });
    const { dyn } = compileForDynamics(doc);
    const t = 1.5;
    const result = advance(dyn, start(dyn), t);
    const inertia = (0.5 * 1 * 1) / 3;
    expect(result.state.q[2]).toBeCloseTo(0.5 * (0.2 / inertia) * t * t, 6);
  });

  it("makes a motion-driven joint follow its drive exactly", () => {
    const { dyn } = compileForDynamics(
      pendulum({ motor: { drive: { mode: "constant", speed: 2 } } }),
    );
    const result = advance(dyn, start(dyn), 0.5, 0.01);
    expect(result.status).toBe("ok");
    expect(result.state.q[2]).toBeCloseTo(1, 9);
    expect(result.state.v[2]).toBeCloseTo(2, 9);
  });

  it("stops on an effort that is not finite", () => {
    const doc = pendulum({
      motor: { dynamics: { mode: "effort", expression: "sqrt(0.01 - t)" } },
    });
    const { dyn } = compileForDynamics(doc);
    const state = start(dyn);
    const result = advance(dyn, state, 0.05);
    expect(result.status).toBe("invalid-effort");
    expect(result.motorId).toBe(doc.motors[0].id);
    expect(result.state.t).toBeGreaterThan(0);
    expect(result.state.t).toBeLessThan(0.011);
  });

  it("stops when the motion runs away", () => {
    const doc = pendulum({
      gravity: [0, 0],
      motor: { dynamics: { mode: "effort", expression: "1e30" } },
    });
    const { dyn } = compileForDynamics(doc);
    expect(step(dyn, start(dyn), 1e-3).status).toBe("diverged");
  });

  it("stops when a motion driver cannot be followed", () => {
    const base = buildNonGrashof();
    const doc = MechanismDocumentSchema.parse({
      ...base,
      motors: [{ ...base.motors[0], drive: { mode: "constant", speed: 20 } }],
    });
    const { dyn } = compileForDynamics(doc);
    const result = advance(dyn, start(dyn), 1, 1e-3);
    expect(result.status).toBe("projection-failed");
    expect(result.state.t).toBeGreaterThan(0);
  });

  it("stops when a drive expression turns invalid mid-step", () => {
    const doc = pendulum({
      motor: { drive: { mode: "expression", expression: "sqrt(0.0015 - t)" } },
    });
    const { dyn } = compileForDynamics(doc);
    const result = advance(dyn, start(dyn), 0.01);
    expect(result.status).toBe("invalid-drive");
  });

  it("treats a zero duration as done and rejects a negative one", () => {
    const { dyn } = compileForDynamics(pendulum());
    const state = start(dyn);
    expect(advance(dyn, state, 0).status).toBe("ok");
    expect(advance(dyn, state, -1).status).toBe("invalid-input");
    expect(advance(dyn, state, 1, 0).status).toBe("invalid-input");
  });

  it("flags a singular step for redundant constraints and still moves", () => {
    const doc = doublePendulum();
    const [, upper, lower] = doc.links;
    // A second, redundant pin between upper and lower at the same point.
    const extra = MechanismDocumentSchema.parse({
      ...doc,
      joints: [
        ...doc.joints,
        { id: "dup", type: "R", siteA: upper.sites[1].id, siteB: lower.sites[0].id },
      ],
    });
    const { dyn } = compileForDynamics(extra);
    const result = step(dyn, start(dyn), 1e-3);
    expect(result.status).toBe("ok");
    expect(result.singular).toBe(true);
    expect(result.state.q[2]).toBeLessThan(0);
  });
});
