import { describe, it, expect } from "vitest";
import { compileSystem, linkPose, type KinematicSystem } from "./system";
import { evalResidual, type LinearDriverConstraint } from "./constraints";
import { evaluateDrivesAtTime } from "./drives";
import { newtonSolve, solvePosition, referenceState } from "./position";
import { createLinalgWorkspace } from "./linalg";
import type { LinkSlot, SiteRef, SolverWorkspace } from "./system";
import type { CompiledConstraint } from "./constraints";
import { rotate, localToWorld, vec2 } from "../geom";
import { poseFromWorldPoints, createId } from "../model";
import { defineLink, makeDocument } from "./__fixtures__/build";
import * as fourBar from "./__fixtures__/fourBar";
import * as sliderCrank from "./__fixtures__/sliderCrank";
import * as invertedSliderCrank from "./__fixtures__/invertedSliderCrank";
import * as actuatorArm from "./__fixtures__/actuatorArm";
import type { MechanismDocument } from "../model";

function makeLcg(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0xffffffff;
  };
}

function residualNormAt(system: KinematicSystem, q: Float64Array, inputs: Float64Array): number {
  const r = new Float64Array(system.m);
  evalResidual(system, q, inputs, r, system.m);
  let sum = 0;
  for (const v of r) sum += v * v;
  return Math.sqrt(sum);
}

function angleDiffMod2Pi(a: number, b: number): number {
  let d = (a - b) % (2 * Math.PI);
  if (d > Math.PI) d -= 2 * Math.PI;
  if (d < -Math.PI) d += 2 * Math.PI;
  return d;
}

const oneMotorFixtures: { name: string; build: () => MechanismDocument }[] = [
  { name: "fourBar", build: fourBar.build },
  { name: "sliderCrank", build: sliderCrank.build },
  { name: "invertedSliderCrank", build: invertedSliderCrank.build },
];

describe.each(oneMotorFixtures)("KIN-01 full 360-degree sweep ($name)", ({ build }) => {
  it("every 1-degree step converges to ok with residualNorm < 1e-9, and a full turn returns to q0", () => {
    const system = compileSystem(build());
    let state = referenceState(system);

    for (let deg = 1; deg <= 360; deg++) {
      const target = new Float64Array([(deg * Math.PI) / 180]);
      const result = solvePosition(system, state, target);
      expect(result.status).toBe("ok");
      expect(result.residualNorm).toBeLessThan(1e-9);
      state = result.state;
    }

    for (let i = 0; i < system.n; i++) {
      const isAngle = i % 3 === 2;
      if (isAngle) {
        expect(Math.abs(angleDiffMod2Pi(state.q[i], system.q0[i]))).toBeLessThan(1e-8);
      } else {
        expect(Math.abs(state.q[i] - system.q0[i])).toBeLessThan(1e-8);
      }
    }
  });
});

describe("KIN-01 rigidity — coupler length is preserved through the sweep (fourBar)", () => {
  it("the coupler's A-B distance at the end of a sweep matches its authored length", () => {
    const doc = fourBar.build();
    const system = compileSystem(doc);

    const jointA = system.constraints.find((c) => c.kind === "revolute" && c.label === "A");
    const jointB = system.constraints.find((c) => c.kind === "revolute" && c.label === "B");
    if (!jointA || jointA.kind !== "revolute" || !jointB || jointB.kind !== "revolute") {
      throw new Error("expected revolute A and B constraints");
    }
    const couplerA = jointA.b;
    const couplerB = jointB.a;

    const worldOf = (q: Float64Array, ref: typeof couplerA) => {
      const pose = linkPose(system, q, ref.linkIndex);
      return localToWorld({ x: ref.local.x, y: ref.local.y }, { x: pose.x, y: pose.y }, pose.angle);
    };
    const refA = worldOf(system.q0, couplerA);
    const refB = worldOf(system.q0, couplerB);
    const refLength = Math.hypot(refA.x - refB.x, refA.y - refB.y);

    let state = referenceState(system);
    for (let deg = 1; deg <= 90; deg++) {
      const target = new Float64Array([(deg * Math.PI) / 180]);
      const result = solvePosition(system, state, target);
      state = result.state;
    }

    const finalA = worldOf(state.q, couplerA);
    const finalB = worldOf(state.q, couplerB);
    const finalLength = Math.hypot(finalA.x - finalB.x, finalA.y - finalB.y);
    expect(finalLength).toBeCloseTo(refLength, 6);
  });
});

function strokeValue(system: KinematicSystem, q: Float64Array): number {
  const driver = system.constraints.find(
    (c): c is LinearDriverConstraint => c.kind === "linear-driver",
  );
  if (!driver) throw new Error("expected a linear-driver constraint");
  const poseI = linkPose(system, q, driver.a.linkIndex);
  const poseJ = linkPose(system, q, driver.b.linkIndex);
  const axisWorld = rotate({ x: driver.axisLocal.x, y: driver.axisLocal.y }, poseI.angle);
  const pA = localToWorld(
    { x: driver.a.local.x, y: driver.a.local.y },
    { x: poseI.x, y: poseI.y },
    poseI.angle,
  );
  const pB = localToWorld(
    { x: driver.b.local.x, y: driver.b.local.y },
    { x: poseJ.x, y: poseJ.y },
    poseJ.angle,
  );
  const dx = pB.x - pA.x;
  const dy = pB.y - pA.y;
  return axisWorld.x * dx + axisWorld.y * dy - driver.refDist;
}

describe("KIN-02 time mode — actuatorArm's linear expression motor", () => {
  it("converges at every sampled t, and stroke value matches 20*sin(t) within 1e-9", () => {
    const system = compileSystem(actuatorArm.build());
    let state = referenceState(system);

    for (let t = 0; t <= 2 * Math.PI + 1e-9; t += 0.05) {
      const drives = evaluateDrivesAtTime(system, t);
      expect(drives.ok).toBe(true);
      const result = solvePosition(system, state, drives.values);
      expect(result.status).toBe("ok");
      expect(result.residualNorm).toBeLessThan(1e-9);
      state = result.state;

      const stroke = strokeValue(system, state.q);
      expect(Math.abs(stroke - 20 * Math.sin(t))).toBeLessThan(1e-9);
    }
  });
});

describe("KIN-02 time mode — fourBar's constant-speed rotary motor", () => {
  it("crank angle minus reference equals t", () => {
    const system = compileSystem(fourBar.build());
    const jointO2 = system.constraints.find((c) => c.kind === "rotary-driver");
    if (!jointO2 || jointO2.kind !== "rotary-driver")
      throw new Error("expected a rotary-driver constraint");
    const crankLinkIndex = jointO2.linkB;
    const referenceAngle = system.links[crankLinkIndex].reference.angle;

    let state = referenceState(system);
    for (let t = 0.5; t <= 5; t += 0.5) {
      const drives = evaluateDrivesAtTime(system, t);
      expect(drives.ok).toBe(true);
      const result = solvePosition(system, state, drives.values);
      expect(result.status).toBe("ok");
      state = result.state;

      const pose = linkPose(system, state.q, crankLinkIndex);
      expect(pose.angle - referenceAngle).toBeCloseTo(t, 6);
    }
  });
});

describe("KIN-02 scrubber mode — fourBar", () => {
  it("each warm-started target converges with the crank relative angle equal to the target", () => {
    const system = compileSystem(fourBar.build());
    const jointO2 = system.constraints.find((c) => c.kind === "rotary-driver");
    if (!jointO2 || jointO2.kind !== "rotary-driver")
      throw new Error("expected a rotary-driver constraint");
    const crankLinkIndex = jointO2.linkB;
    const referenceAngle = system.links[crankLinkIndex].reference.angle;

    let state = referenceState(system);
    for (const target of [0.3, -1.2, 2.5]) {
      const result = solvePosition(system, state, new Float64Array([target]));
      expect(result.status).toBe("ok");
      state = result.state;
      const pose = linkPose(system, state.q, crankLinkIndex);
      expect(pose.angle - referenceAngle).toBeCloseTo(target, 9);
    }
  });
});

describe("Continuation — a large jump matches many small steps (fourBar)", () => {
  it("a +170 degree jump matches 170 1-degree steps within 1e-8, with substeps > 1", () => {
    const system = compileSystem(fourBar.build());

    const jumpResult = solvePosition(
      system,
      referenceState(system),
      new Float64Array([(170 * Math.PI) / 180]),
    );
    expect(jumpResult.status).toBe("ok");
    expect(jumpResult.substeps).toBeGreaterThan(1);

    let stepState = referenceState(system);
    for (let deg = 1; deg <= 170; deg++) {
      const target = new Float64Array([(deg * Math.PI) / 180]);
      const stepResult = solvePosition(system, stepState, target);
      expect(stepResult.status).toBe("ok");
      stepState = stepResult.state;
    }

    for (let i = 0; i < system.n; i++) {
      expect(Math.abs(jumpResult.state.q[i] - stepState.q[i])).toBeLessThan(1e-8);
    }
  });
});

describe("newtonSolve — quadratic-ish convergence from a perturbed q0 (fourBar)", () => {
  it("converges within 10 iterations with the default tiny damping", () => {
    const system = compileSystem(fourBar.build());
    const rng = makeLcg(123);
    const q = Float64Array.from(system.q0);
    for (let i = 0; i < q.length; i++) {
      const isAngle = i % 3 === 2;
      q[i] += (rng() * 2 - 1) * (isAngle ? 0.1 : 5);
    }
    const inputs = new Float64Array(system.motors.length);
    const result = newtonSolve(system, q, inputs);
    expect(result.converged).toBe(true);
    expect(result.iterations).toBeLessThanOrEqual(10);
  });
});

describe("solvePosition — failure safety", () => {
  it("wrong-length target -> invalid-input, prev untouched", () => {
    const system = compileSystem(fourBar.build());
    const prev = referenceState(system);
    const prevQCopy = Float64Array.from(prev.q);
    const prevInputsCopy = Float64Array.from(prev.inputs);

    const result = solvePosition(system, prev, new Float64Array(2));
    expect(result.status).toBe("invalid-input");
    expect(prev.q).toEqual(prevQCopy);
    expect(prev.inputs).toEqual(prevInputsCopy);
  });

  it("NaN in target -> invalid-input, prev untouched", () => {
    const system = compileSystem(fourBar.build());
    const prev = referenceState(system);
    const prevQCopy = Float64Array.from(prev.q);

    const result = solvePosition(system, prev, new Float64Array([NaN]));
    expect(result.status).toBe("invalid-input");
    expect(prev.q).toEqual(prevQCopy);
  });

  function buildShortCouplerSliderCrank(): MechanismDocument {
    const crankLength = 40;
    const couplerLength = 25; // short enough to lock up well before a full crank turn
    const offset = 10;
    const referenceCrankAngle = Math.PI / 6;

    const O2 = vec2(0, 0);
    const A = vec2(
      crankLength * Math.cos(referenceCrankAngle),
      crankLength * Math.sin(referenceCrankAngle),
    );
    const slideAlongAxis =
      crankLength * Math.cos(referenceCrankAngle) +
      Math.sqrt(
        couplerLength * couplerLength -
          Math.pow(crankLength * Math.sin(referenceCrankAngle) - offset, 2),
      );
    const P = vec2(slideAlongAxis, offset);
    const railAnchor = vec2(0, offset);

    const ground = defineLink({
      name: "ground",
      isGround: true,
      origin: [O2.x, O2.y],
      sites: { O2: [O2.x, O2.y], rail: [railAnchor.x, railAnchor.y] },
    });
    const crankPose = poseFromWorldPoints(O2, A);
    const crank = defineLink({
      name: "crank",
      origin: crankPose.position,
      angle: crankPose.angle,
      sites: { O2: [O2.x, O2.y], A: [A.x, A.y] },
    });
    const couplerPose = poseFromWorldPoints(A, P);
    const coupler = defineLink({
      name: "coupler",
      origin: couplerPose.position,
      angle: couplerPose.angle,
      sites: { A: [A.x, A.y], P: [P.x, P.y] },
    });
    const slider = defineLink({
      name: "slider",
      origin: [P.x, P.y],
      angle: 0,
      sites: { P: [P.x, P.y] },
    });

    const jointO2Id = createId("joint");
    return makeDocument({
      schemaVersion: 1,
      name: "short-coupler-slider-crank",
      links: [ground.link, crank.link, coupler.link, slider.link],
      joints: [
        { id: jointO2Id, name: "O2", type: "R", siteA: ground.siteIds.O2, siteB: crank.siteIds.O2 },
        {
          id: createId("joint"),
          name: "A",
          type: "R",
          siteA: crank.siteIds.A,
          siteB: coupler.siteIds.A,
        },
        {
          id: createId("joint"),
          name: "P",
          type: "R",
          siteA: coupler.siteIds.P,
          siteB: slider.siteIds.P,
        },
        {
          id: createId("joint"),
          name: "rail",
          type: "P",
          siteA: ground.siteIds.rail,
          siteB: slider.siteIds.P,
          axis: [1, 0],
        },
      ],
      motors: [
        {
          id: createId("motor"),
          name: "crank-motor",
          jointId: jointO2Id,
          kind: "rotary",
          drive: { mode: "constant", speed: 1 },
        },
      ],
      markers: [],
    });
  }

  it("reports no-convergence with a finite, still-converged last state when driven past reach", () => {
    const system = compileSystem(buildShortCouplerSliderCrank());
    let state = referenceState(system);
    let hitNoConvergence = false;

    for (let deg = 1; deg <= 180; deg++) {
      const target = new Float64Array([(deg * Math.PI) / 180]);
      const result = solvePosition(system, state, target);
      if (result.status === "no-convergence") {
        hitNoConvergence = true;
        for (const v of result.state.q) expect(Number.isFinite(v)).toBe(true);
        expect(residualNormAt(system, result.state.q, result.state.inputs)).toBeLessThan(1e-9);
        break;
      }
      expect(result.status).toBe("ok");
      state = result.state;
    }

    expect(hitNoConvergence).toBe(true);
  });
});

describe("newtonSolve — n === 0 (a joint between two ground links)", () => {
  it("converges trivially when the two ground sites already coincide", () => {
    const g1 = defineLink({ name: "g1", isGround: true, origin: [0, 0], sites: { p: [0, 0] } });
    const g2 = defineLink({ name: "g2", isGround: true, origin: [5, 5], sites: { p: [0, 0] } });
    const doc = makeDocument({
      schemaVersion: 1,
      name: "ground-ground",
      links: [g1.link, g2.link],
      joints: [
        { id: createId("joint"), name: "j", type: "R", siteA: g1.siteIds.p, siteB: g2.siteIds.p },
      ],
      motors: [],
      markers: [],
    });
    const system = compileSystem(doc);
    expect(system.n).toBe(0);
    expect(system.m).toBeGreaterThan(0);

    const result = newtonSolve(system, new Float64Array(0), new Float64Array(0));
    expect(result.converged).toBe(true);
    expect(result.q.length).toBe(0);
  });

  it("does not converge when the two ground sites are apart (nothing can move to fix it)", () => {
    const g1 = defineLink({ name: "g1", isGround: true, origin: [0, 0], sites: { p: [0, 0] } });
    const g2 = defineLink({ name: "g2", isGround: true, origin: [0, 0], sites: { p: [10, 0] } });
    const doc = makeDocument({
      schemaVersion: 1,
      name: "ground-ground-apart",
      links: [g1.link, g2.link],
      joints: [
        { id: createId("joint"), name: "j", type: "R", siteA: g1.siteIds.p, siteB: g2.siteIds.p },
      ],
      motors: [],
      markers: [],
    });
    const system = compileSystem(doc);
    expect(system.n).toBe(0);

    const result = newtonSolve(system, new Float64Array(0), new Float64Array(0));
    expect(result.converged).toBe(false);
    expect(result.residualNorm).toBeCloseTo(10, 9);
  });
});

describe("newtonSolve — a trial step whose infinity norm exceeds 1e3*lengthScale is rejected", () => {
  function buildPathologicalSystem(): KinematicSystem {
    const n = 3;
    const m = 2;
    const links: LinkSlot[] = [
      {
        id: "ground",
        name: "ground",
        isGround: true,
        offset: -1,
        reference: { x: 0, y: 0, angle: 0 },
      },
      {
        id: "moving",
        name: "moving",
        isGround: false,
        offset: 0,
        reference: { x: 0, y: 0, angle: 0 },
      },
    ];
    const groundSite: SiteRef = { linkIndex: 0, local: { x: 0, y: 0 } };
    const movingSite: SiteRef = { linkIndex: 1, local: { x: 0, y: 0 } };
    const constraints: CompiledConstraint[] = [
      { kind: "revolute", jointId: "j", label: "j", row: 0, a: groundSite, b: movingSite },
    ];
    const workspace: SolverWorkspace = {
      r: new Float64Array(m),
      rTrial: new Float64Array(m),
      J: new Float64Array(m * n),
      qTrial: new Float64Array(n),
      dx: new Float64Array(n),
      linalg: createLinalgWorkspace(n),
    };
    return {
      links,
      linkIndexById: new Map([
        ["ground", 0],
        ["moving", 1],
      ]),
      sites: new Map([
        ["gs", groundSite],
        ["ms", movingSite],
      ]),
      markers: [],
      n,
      jointRows: m,
      m,
      constraints,
      motors: [],
      q0: new Float64Array(n),
      lengthScale: 1,
      issues: [],
      workspace,
    };
  }

  it("returns converged:false immediately instead of accepting a huge step", () => {
    const system = buildPathologicalSystem();
    // The moving link starts 1e6 units away from the ground site it must
    // coincide with: the very first (near-undamped) Newton step would need
    // to move it by ~1e6, far past 1e3*lengthScale (lengthScale=1 here).
    const qStart = new Float64Array([1e6, 1e6, 0]);
    const result = newtonSolve(system, qStart, new Float64Array(0));
    expect(result.converged).toBe(false);
  });
});

describe("newtonSolve — under-determined system (fourBar with its motor removed)", () => {
  it("still converges from a perturbed q0 (the lambda floor handles rank deficiency)", () => {
    const doc = fourBar.build();
    const docNoMotor: MechanismDocument = { ...doc, motors: [] };
    const system = compileSystem(docNoMotor);

    const rng = makeLcg(55);
    const q = Float64Array.from(system.q0);
    for (let i = 0; i < q.length; i++) {
      const isAngle = i % 3 === 2;
      q[i] += (rng() * 2 - 1) * (isAngle ? 0.05 : 2);
    }

    const result = newtonSolve(system, q, new Float64Array(0));
    expect(result.converged).toBe(true);
    expect(result.residualNorm).toBeLessThan(1e-9);
  });
});
