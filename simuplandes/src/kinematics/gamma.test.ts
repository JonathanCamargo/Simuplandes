import { describe, it, expect } from "vitest";
import { compileSystem, type KinematicSystem } from "./system";
import { evalResidual, evalGamma } from "./constraints";
import * as fourBar from "./__fixtures__/fourBar";
import * as sliderCrank from "./__fixtures__/sliderCrank";
import * as invertedSliderCrank from "./__fixtures__/invertedSliderCrank";
import * as actuatorArm from "./__fixtures__/actuatorArm";
import type { MechanismDocument } from "../model";

/**
 * The mandatory finite-difference cross-check (research Pitfall 3): the
 * prismatic perpendicular-row and linear-driver `gamma` formulas are long
 * enough that a sign/term error is easy to make and easy to miss on
 * review. This is the arbiter — if `evalGamma` ever disagrees with this
 * file, the formula is wrong, not the tolerance.
 */

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

/** A qDot with |omega| ~ 1 on angle slots and |v| ~ lengthScale on position slots. */
function randomQDot(rng: () => number, n: number, lengthScale: number): Float64Array {
  const qDot = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const isAngle = i % 3 === 2;
    qDot[i] = (rng() * 2 - 1) * (isAngle ? 1 : lengthScale);
  }
  return qDot;
}

function finiteDifferenceGamma(
  system: KinematicSystem,
  q: Float64Array,
  qDot: Float64Array,
  inputs: Float64Array,
  h: number,
): Float64Array {
  const m = system.m;
  const qPlus = new Float64Array(system.n);
  const qMinus = new Float64Array(system.n);
  for (let i = 0; i < system.n; i++) {
    qPlus[i] = q[i] + h * qDot[i];
    qMinus[i] = q[i] - h * qDot[i];
  }

  const rPlus = new Float64Array(m);
  const rZero = new Float64Array(m);
  const rMinus = new Float64Array(m);
  evalResidual(system, qPlus, inputs, rPlus, m);
  evalResidual(system, q, inputs, rZero, m);
  evalResidual(system, qMinus, inputs, rMinus, m);

  const fd = new Float64Array(m);
  for (let i = 0; i < m; i++) {
    fd[i] = -(rPlus[i] - 2 * rZero[i] + rMinus[i]) / (h * h);
  }
  return fd;
}

const fixtures: { name: string; build: () => MechanismDocument }[] = [
  { name: "fourBar", build: fourBar.build },
  { name: "sliderCrank", build: sliderCrank.build },
  { name: "invertedSliderCrank", build: invertedSliderCrank.build },
  { name: "actuatorArm", build: actuatorArm.build },
];

const H = 1e-4;

describe.each(fixtures)("evalGamma matches -d^2/ds^2 Phi(q + s*qDot) ($name)", ({ build }) => {
  it("at 5 seeded pseudo-random (q, qDot) states near q0, inputAccels = 0", () => {
    const system = compileSystem(build());
    const inputs = new Float64Array(system.motors.length);
    const inputAccels = new Float64Array(system.motors.length);

    for (let seed = 1; seed <= 5; seed++) {
      const rngQ = makeLcg(seed * 97 + 1);
      const rngQDot = makeLcg(seed * 233 + 7);
      const q = perturbQ(system.q0, rngQ, system.lengthScale);
      const qDot = randomQDot(rngQDot, system.n, system.lengthScale);

      const gamma = new Float64Array(system.m);
      evalGamma(system, q, qDot, inputAccels, gamma, system.m);
      const fd = finiteDifferenceGamma(system, q, qDot, inputs, H);

      for (let i = 0; i < system.m; i++) {
        const tol = 1e-5 * Math.max(1, Math.abs(gamma[i]));
        expect(Math.abs(gamma[i] - fd[i])).toBeLessThanOrEqual(tol);
      }
    }
  });

  it("driver rows equal the scleronomic part plus inputAccels", () => {
    const system = compileSystem(build());
    if (system.motors.length === 0) return;

    const rngQ = makeLcg(11);
    const rngQDot = makeLcg(19);
    const q = perturbQ(system.q0, rngQ, system.lengthScale);
    const qDot = randomQDot(rngQDot, system.n, system.lengthScale);

    const zeroAccels = new Float64Array(system.motors.length);
    const gammaZero = new Float64Array(system.m);
    evalGamma(system, q, qDot, zeroAccels, gammaZero, system.m);

    const appliedAccels = new Float64Array(system.motors.length).fill(2.5);
    const gammaWithAccel = new Float64Array(system.m);
    evalGamma(system, q, qDot, appliedAccels, gammaWithAccel, system.m);

    for (const c of system.constraints) {
      if (c.kind === "rotary-driver" || c.kind === "linear-driver") {
        const diff = gammaWithAccel[c.row] - gammaZero[c.row];
        expect(diff).toBeCloseTo(appliedAccels[c.motorIndex], 9);
      }
    }
  });
});
