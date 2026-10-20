import { describe, it, expect } from "vitest";
import { build as buildFourBar } from "../kinematics/__fixtures__/fourBar";
import { createId, MechanismDocumentSchema, type MechanismDocument } from "../model";
import {
  actuatorEfforts,
  assembleForces,
  assembleMass,
  energy,
  springStates,
  toSIRates,
} from "./assemble";
import { compileForDynamics, oscillator, pendulum } from "./__fixtures__/mechanisms";

/** The four-bar with every kind of force element, an off-axis center of mass and gravity tilted. */
function loadedFourBar(unit: "mm" | "m" = "mm"): MechanismDocument {
  const doc = buildFourBar();
  const [ground, crank, coupler, rocker] = doc.links;
  const jointB = doc.joints.find((joint) => joint.name === "B")!;
  return MechanismDocumentSchema.parse({
    ...doc,
    units: { length: unit },
    links: [
      ground,
      crank,
      { ...coupler, massProperties: { mass: 0.3, com: [30, 12], inertia: 4e-4 } },
      rocker,
    ],
    loads: [
      { id: createId("load"), siteId: coupler.sites[1].id, force: [1.5, -2], torque: 0.25 },
      // A load on ground is ignored.
      { id: createId("load"), siteId: ground.sites[0].id, force: [100, 100], torque: 100 },
    ],
    springs: [
      {
        id: createId("spring"),
        kind: "linear",
        siteA: ground.sites[1].id,
        siteB: coupler.sites[0].id,
        stiffness: 250,
        damping: 0,
        freeLength: 40,
      },
      {
        id: createId("spring"),
        kind: "torsional",
        jointId: jointB.id,
        stiffness: 3,
        damping: 0,
        freeAngle: 0.1,
      },
    ],
    dynamics: { gravity: [1.2, -9.81] },
  });
}

function perturbed(q0: Float64Array, seed: number): Float64Array {
  const q = Float64Array.from(q0);
  for (let i = 0; i < q.length; i++) q[i] += 0.2 * Math.sin(seed * 3.7 + i * 2.1);
  return q;
}

describe("assembleMass", () => {
  it("gives 1/2 v^T M v equal to the kinetic energy", () => {
    const { dyn } = compileForDynamics(loadedFourBar());
    const n = dyn.kin.n;
    const q = perturbed(dyn.kin.q0, 1);
    const v = perturbed(new Float64Array(n), 2);
    const M = new Float64Array(n * n);
    assembleMass(dyn, q, M);
    const vSI = new Float64Array(n);
    toSIRates(dyn, v, vSI);
    let quadratic = 0;
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) quadratic += vSI[i] * M[i * n + j] * vSI[j];
    }
    expect(0.5 * quadratic).toBeCloseTo(energy(dyn, q, v).kinetic, 12);
  });

  it("is symmetric", () => {
    const { dyn } = compileForDynamics(loadedFourBar());
    const n = dyn.kin.n;
    const M = new Float64Array(n * n);
    assembleMass(dyn, perturbed(dyn.kin.q0, 3), M);
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) expect(M[i * n + j]).toBe(M[j * n + i]);
    }
  });
});

describe("assembleForces", () => {
  it.each(["mm", "m"] as const)(
    "gives conservative forces equal to -dV/dq at rest (%s)",
    (unit) => {
      const { dyn } = compileForDynamics(loadedFourBar(unit));
      const n = dyn.kin.n;
      const q = perturbed(dyn.kin.q0, 4);
      const zero = new Float64Array(n);
      const Q = new Float64Array(n);
      expect(assembleForces(dyn, 0, q, zero, Q).invalidMotorId).toBeNull();
      for (let i = 0; i < n; i++) {
        const h = 1e-6 * (i % 3 === 2 ? 1 : dyn.kin.lengthScale);
        const qp = Float64Array.from(q);
        const qm = Float64Array.from(q);
        qp[i] += h;
        qm[i] -= h;
        const dV = (energy(dyn, qp, zero).potential - energy(dyn, qm, zero).potential) / (2 * h);
        const expected = -dV / dyn.colScale[i];
        expect(Math.abs(Q[i] - expected)).toBeLessThan(1e-6 * Math.max(1, Math.abs(expected)));
      }
    },
  );

  it("makes dampers dissipate power", () => {
    const doc = loadedFourBar();
    const massless = MechanismDocumentSchema.parse({
      ...doc,
      links: doc.links.map((link) =>
        link.isGround ? link : { ...link, massProperties: { mass: 0, com: [0, 0], inertia: 0 } },
      ),
      loads: [],
      springs: doc.springs.map((spring) => ({ ...spring, stiffness: 0, damping: 5 })),
      dynamics: { gravity: [0, 0] },
    });
    const { dyn } = compileForDynamics(massless);
    const n = dyn.kin.n;
    const q = perturbed(dyn.kin.q0, 5);
    const v = perturbed(new Float64Array(n), 6);
    const Q = new Float64Array(n);
    assembleForces(dyn, 0, q, v, Q);
    const vSI = new Float64Array(n);
    toSIRates(dyn, v, vSI);
    let power = 0;
    for (let i = 0; i < n; i++) power += Q[i] * vSI[i];
    expect(power).toBeLessThan(0);
  });

  it("adds a rotary effort along the joint angle", () => {
    const doc = pendulum({
      gravity: [0, 0],
      motor: { dynamics: { mode: "effort", expression: "2 + t" } },
    });
    const { dyn } = compileForDynamics(doc);
    expect(dyn.kin.motors).toHaveLength(0);
    expect(dyn.actuators).toHaveLength(1);
    const Q = new Float64Array(dyn.kin.n);
    assembleForces(dyn, 1, dyn.kin.q0, new Float64Array(dyn.kin.n), Q);
    expect(Array.from(Q)).toEqual([0, 0, 3]);
  });

  it("adds a linear effort along the slide in newtons", () => {
    const { dyn } = compileForDynamics(oscillator({ effort: "5 - dq*0 - q*0" }));
    const Q = new Float64Array(dyn.kin.n);
    assembleForces(dyn, 0, dyn.kin.q0, new Float64Array(dyn.kin.n), Q);
    expect(Q[0]).toBeCloseTo(5, 12);
    expect(Q[1]).toBeCloseTo(0, 12);
    expect(actuatorEfforts(dyn, 0, dyn.kin.q0, new Float64Array(dyn.kin.n))[0]).toBe(5);
  });

  it("feeds the joint coordinate and its rate to the expression", () => {
    const { dyn } = compileForDynamics(oscillator({ effort: "-100*q - 3*dq" }));
    const q = Float64Array.from(dyn.kin.q0);
    q[0] += 2; // 2 mm of slide
    const v = new Float64Array(dyn.kin.n);
    v[0] = 10; // 10 mm/s
    expect(actuatorEfforts(dyn, 0, q, v)[0]).toBeCloseTo(-230, 9);
  });

  it("reports an effort motor whose expression does not compile", () => {
    const { dyn } = compileForDynamics(oscillator({ effort: "q +" }));
    expect(dyn.issues).toEqual([
      expect.objectContaining({
        code: "invalid-effort-expression",
        motorId: dyn.actuators[0].motorId,
      }),
    ]);
    const Q = new Float64Array(dyn.kin.n);
    const result = assembleForces(dyn, 0, dyn.kin.q0, new Float64Array(dyn.kin.n), Q);
    expect(result.invalidMotorId).toBe(dyn.actuators[0].motorId);
    expect(actuatorEfforts(dyn, 0, dyn.kin.q0, new Float64Array(dyn.kin.n))[0]).toBeNaN();
  });

  it("reports an effort that is not finite", () => {
    const { dyn } = compileForDynamics(oscillator({ effort: "sqrt(-1)" }));
    const Q = new Float64Array(dyn.kin.n);
    const result = assembleForces(dyn, 0, dyn.kin.q0, new Float64Array(dyn.kin.n), Q);
    expect(result.invalidMotorId).toBe(dyn.actuators[0].motorId);
  });

  it("ignores effort motors when efforts are off", () => {
    const doc = oscillator({ effort: "5" });
    const { dyn } = compileForDynamics(doc, false);
    expect(dyn.actuators).toHaveLength(0);
    expect(dyn.kin.motors).toHaveLength(1);
  });

  it("skips a spring whose ends coincide", () => {
    const doc = oscillator({ stretch: -100 }); // block sits on the anchor
    const { dyn } = compileForDynamics(doc);
    const Q = new Float64Array(dyn.kin.n);
    assembleForces(dyn, 0, dyn.kin.q0, new Float64Array(dyn.kin.n), Q);
    expect(Array.from(Q)).toEqual([0, 0, 0]);
  });
});

describe("springStates", () => {
  it("reports length in model units and tension in newtons", () => {
    const { dyn } = compileForDynamics(oscillator({ stretch: 20, stiffness: 800, damping: 4 }));
    const v = new Float64Array(dyn.kin.n);
    v[0] = 50; // mm/s, lengthening
    const [state] = springStates(dyn, dyn.kin.q0, v);
    expect(state.length).toBeCloseTo(120, 9);
    expect(state.force).toBeCloseTo(800 * 0.02 + 4 * 0.05, 9);
  });

  it("reports zero rate for coincident ends", () => {
    const { dyn } = compileForDynamics(oscillator({ stretch: -100, stiffness: 10, damping: 4 }));
    const [state] = springStates(dyn, dyn.kin.q0, Float64Array.from([5, 0, 0]));
    expect(state.length).toBe(0);
    expect(state.force).toBeCloseTo(-10 * 0.1, 12);
  });
});
