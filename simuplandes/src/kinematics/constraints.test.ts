import { describe, it, expect } from "vitest";
import { compileSystem, linkPose, type KinematicSystem } from "./system";
import { evalResidual, evalJacobian } from "./constraints";
import { KinematicsError } from "./errors";
import { localToWorld } from "../geom";
import * as fourBar from "./__fixtures__/fourBar";
import * as sliderCrank from "./__fixtures__/sliderCrank";
import * as invertedSliderCrank from "./__fixtures__/invertedSliderCrank";
import * as actuatorArm from "./__fixtures__/actuatorArm";
import type { MechanismDocument } from "../model";

/** Deterministic LCG so tests never depend on Math.random. */
function makeLcg(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0xffffffff;
  };
}

/** Perturbs q0 by +/-0.3 rad on angle slots and +/-0.1*lengthScale on position slots. */
function perturbQ(q0: Float64Array, rng: () => number, lengthScale: number): Float64Array {
  const q = Float64Array.from(q0);
  for (let i = 0; i < q.length; i++) {
    const isAngle = i % 3 === 2;
    const amplitude = isAngle ? 0.3 : 0.1 * lengthScale;
    q[i] += (rng() * 2 - 1) * amplitude;
  }
  return q;
}

function checkJacobianAgainstFiniteDifference(system: KinematicSystem, q: Float64Array): void {
  const { n, m } = system;
  const inputs = new Float64Array(system.motors.length);
  const J = new Float64Array(m * n);
  evalJacobian(system, q, J, m);

  const h = 1e-6 * Math.max(1, system.lengthScale);
  const rPlus = new Float64Array(m);
  const rMinus = new Float64Array(m);
  const qPerturbed = Float64Array.from(q);

  for (let j = 0; j < n; j++) {
    const original = qPerturbed[j];
    qPerturbed[j] = original + h;
    evalResidual(system, qPerturbed, inputs, rPlus, m);
    qPerturbed[j] = original - h;
    evalResidual(system, qPerturbed, inputs, rMinus, m);
    qPerturbed[j] = original;

    for (let i = 0; i < m; i++) {
      const analytic = J[i * n + j];
      const fd = (rPlus[i] - rMinus[i]) / (2 * h);
      const tol = 1e-6 * Math.max(1, Math.abs(analytic));
      expect(Math.abs(analytic - fd)).toBeLessThanOrEqual(tol);
    }
  }
}

const fixtures: { name: string; build: () => MechanismDocument }[] = [
  { name: "fourBar", build: fourBar.build },
  { name: "sliderCrank", build: sliderCrank.build },
  { name: "invertedSliderCrank", build: invertedSliderCrank.build },
  { name: "actuatorArm", build: actuatorArm.build },
];

describe.each(fixtures)("evalJacobian matches finite differences ($name)", ({ build }) => {
  it("at q0", () => {
    const system = compileSystem(build());
    checkJacobianAgainstFiniteDifference(system, system.q0);
  });

  it("at 5 deterministic pseudo-random perturbations", () => {
    const system = compileSystem(build());
    for (let seed = 1; seed <= 5; seed++) {
      const rng = makeLcg(seed * 97 + 1);
      const q = perturbQ(system.q0, rng, system.lengthScale);
      checkJacobianAgainstFiniteDifference(system, q);
    }
  });
});

describe("evalResidual / evalJacobian — defensive q-length check", () => {
  it("throws KinematicsError('bad-input-length') when q.length !== system.n", () => {
    const system = compileSystem(fourBar.build());
    const badQ = new Float64Array(system.n - 1);
    const inputs = new Float64Array(system.motors.length);
    const r = new Float64Array(system.m);
    const J = new Float64Array(system.m * (system.n - 1));

    expect(() => evalResidual(system, badQ, inputs, r, system.m)).toThrow(KinematicsError);
    expect(() => evalJacobian(system, badQ, J, system.m)).toThrow(KinematicsError);
  });
});

describe("hot-path site-position math matches src/geom's localToWorld", () => {
  it("the four-bar's O2 revolute residual matches an independent localToWorld computation", () => {
    const system = compileSystem(fourBar.build());
    const q = perturbQ(system.q0, makeLcg(5), system.lengthScale);
    const r = new Float64Array(system.m);
    evalResidual(system, q, new Float64Array(system.motors.length), r, system.m);

    const o2 = system.constraints.find((c) => c.kind === "revolute" && c.label === "O2");
    if (!o2 || o2.kind !== "revolute") throw new Error("expected a revolute O2 constraint");

    const poseA = linkPose(system, q, o2.a.linkIndex);
    const poseB = linkPose(system, q, o2.b.linkIndex);
    const worldA = localToWorld(
      { x: o2.a.local.x, y: o2.a.local.y },
      { x: poseA.x, y: poseA.y },
      poseA.angle,
    );
    const worldB = localToWorld(
      { x: o2.b.local.x, y: o2.b.local.y },
      { x: poseB.x, y: poseB.y },
      poseB.angle,
    );

    expect(r[o2.row]).toBeCloseTo(worldA.x - worldB.x, 9);
    expect(r[o2.row + 1]).toBeCloseTo(worldA.y - worldB.y, 9);
  });
});
