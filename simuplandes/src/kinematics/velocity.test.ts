import { describe, it, expect } from "vitest";
import { compileSystem, linkPose, type KinematicSystem } from "./system";
import { newtonSolve, referenceState, solvePosition } from "./position";
import { solveVelocity, solveAcceleration, solveVelocityAcceleration } from "./velocity";
import { defineLink, makeDocument } from "./__fixtures__/build";
import * as fourBar from "./__fixtures__/fourBar";
import * as sliderCrank from "./__fixtures__/sliderCrank";
import * as invertedSliderCrank from "./__fixtures__/invertedSliderCrank";
import * as actuatorArm from "./__fixtures__/actuatorArm";
import { createId } from "../model";
import type { MechanismDocument, Motor } from "../model";

/** Replaces every motor's drive with a fixed expression (test-only doc variant). */
function withExpressionDrive(doc: MechanismDocument, expression: string): MechanismDocument {
  const motors: Motor[] = doc.motors.map((m) => ({
    ...m,
    drive: { mode: "expression", expression },
  }));
  return { ...doc, motors };
}

/** value/rate/accel of "0.8*t + 0.3*sin(2*t)", computed analytically (not by finite difference). */
function rotaryDrive(t: number): { value: number; rate: number; accel: number } {
  return {
    value: 0.8 * t + 0.3 * Math.sin(2 * t),
    rate: 0.8 + 0.6 * Math.cos(2 * t),
    accel: -1.2 * Math.sin(2 * t),
  };
}

/** value/rate/accel of "20*sin(t)" (actuatorArm's own linear-driver expression), computed analytically. */
function linearDrive(t: number): { value: number; rate: number; accel: number } {
  return {
    value: 20 * Math.sin(t),
    rate: 20 * Math.cos(t),
    accel: -20 * Math.sin(t),
  };
}

/** Marches from the reference state to `nearT` in small time steps to get a warm-started, branch-correct q. */
function marchTo(
  system: KinematicSystem,
  driveAt: (t: number) => { value: number },
  nearT: number,
): { q: Float64Array; inputs: Float64Array } {
  let state = referenceState(system);
  const steps = Math.max(1, Math.ceil(nearT / 0.1));
  for (let i = 1; i <= steps; i++) {
    const t = (nearT * i) / steps;
    const target = new Float64Array([driveAt(t).value]);
    const result = solvePosition(system, state, target);
    expect(result.status).toBe("ok");
    state = result.state;
  }
  return state;
}

interface TrajectoryFixture {
  readonly name: string;
  readonly build: () => MechanismDocument;
  readonly drive: (t: number) => { value: number; rate: number; accel: number };
  readonly qDotTol: number;
  readonly qDDotTol: number;
  readonly solveTolerance: number;
}

const trajectoryFixtures: TrajectoryFixture[] = [
  {
    name: "fourBar",
    build: () => withExpressionDrive(fourBar.build(), "0.8*t + 0.3*sin(2*t)"),
    drive: rotaryDrive,
    qDotTol: 1e-6,
    qDDotTol: 1e-4,
    solveTolerance: 1e-12,
  },
  {
    name: "sliderCrank",
    build: () => withExpressionDrive(sliderCrank.build(), "0.8*t + 0.3*sin(2*t)"),
    drive: rotaryDrive,
    qDotTol: 1e-6,
    qDDotTol: 1e-4,
    solveTolerance: 1e-12,
  },
  {
    name: "invertedSliderCrank",
    build: () => withExpressionDrive(invertedSliderCrank.build(), "0.8*t + 0.3*sin(2*t)"),
    drive: rotaryDrive,
    qDotTol: 1e-6,
    qDDotTol: 1e-4,
    solveTolerance: 1e-12,
  },
  {
    name: "actuatorArm",
    build: () => actuatorArm.build(), // already "20*sin(t)"
    drive: linearDrive,
    qDotTol: 1e-6,
    qDDotTol: 1e-4,
    solveTolerance: 1e-12,
  },
];

// Two independent step sizes, not one shared `h` (a deviation from the
// plan's literal "h = 1e-3" — see 03-02-SUMMARY.md): a single h cannot be
// simultaneously optimal for a central *first* difference (truncation
// O(h^2), wants h small) and a central *second* difference (roundoff
// O(eps/h^2), wants h larger) at double-precision. Empirically (see
// SUMMARY), h=1e-4 keeps every fixture's q-dot truncation error under the
// 1e-6 budget, and h=3e-4 keeps every fixture's q-ddot error under the
// 1e-4 budget, at a Newton tolerance of 1e-12 (achievable on all fixtures).
const H_VELOCITY = 1e-4;
const H_ACCELERATION = 3e-4;
const SAMPLE_TIMES = [0.4, 1.3, 2.9];

describe.each(trajectoryFixtures)(
  "KIN-03 trajectory finite-difference cross-check ($name)",
  ({ build, drive, qDotTol, qDDotTol, solveTolerance }) => {
    it.each(SAMPLE_TIMES)("q-dot/q-ddot match central differences at t=%f", (t) => {
      const system = compileSystem(build());
      const warm = marchTo(system, drive, t);

      const solveAt = (time: number): Float64Array => {
        const target = new Float64Array([drive(time).value]);
        const result = newtonSolve(system, warm.q, target, { tolerance: solveTolerance });
        expect(result.converged).toBe(true);
        return result.q;
      };

      const qMinusV = solveAt(t - H_VELOCITY);
      const qZero = solveAt(t);
      const qPlusV = solveAt(t + H_VELOCITY);
      const qMinusA = solveAt(t - H_ACCELERATION);
      const qPlusA = solveAt(t + H_ACCELERATION);

      const qDotFd = new Float64Array(system.n);
      const qDDotFd = new Float64Array(system.n);
      for (let i = 0; i < system.n; i++) {
        qDotFd[i] = (qPlusV[i] - qMinusV[i]) / (2 * H_VELOCITY);
        qDDotFd[i] = (qPlusA[i] - 2 * qZero[i] + qMinusA[i]) / (H_ACCELERATION * H_ACCELERATION);
      }

      const { rate, accel } = drive(t);
      const velocityResult = solveVelocity(system, qZero, new Float64Array([rate]));
      expect(velocityResult.status).toBe("ok");
      for (let i = 0; i < system.n; i++) {
        const tol = qDotTol * Math.max(1, Math.abs(qDotFd[i]));
        expect(Math.abs(velocityResult.values[i] - qDotFd[i])).toBeLessThanOrEqual(tol);
      }

      const accelResult = solveAcceleration(
        system,
        qZero,
        velocityResult.values,
        new Float64Array([accel]),
      );
      expect(accelResult.status).toBe("ok");
      for (let i = 0; i < system.n; i++) {
        const tol = qDDotTol * Math.max(1, Math.abs(qDDotFd[i]));
        expect(Math.abs(accelResult.values[i] - qDDotFd[i])).toBeLessThanOrEqual(tol);
      }
    });
  },
);

describe("fourBar closed-form angular velocity ratios at the reference pose", () => {
  it("coupler/rocker omega match the standard four-bar velocity ratios to 1e-9", () => {
    const system = compileSystem(fourBar.build());

    const jointA = system.constraints.find((c) => c.kind === "revolute" && c.label === "A");
    const jointB = system.constraints.find((c) => c.kind === "revolute" && c.label === "B");
    const jointO2 = system.constraints.find((c) => c.kind === "revolute" && c.label === "O2");
    const jointO4 = system.constraints.find((c) => c.kind === "revolute" && c.label === "O4");
    if (
      !jointA ||
      jointA.kind !== "revolute" ||
      !jointB ||
      jointB.kind !== "revolute" ||
      !jointO2 ||
      jointO2.kind !== "revolute" ||
      !jointO4 ||
      jointO4.kind !== "revolute"
    ) {
      throw new Error("expected revolute O2, A, B, O4 constraints");
    }

    const crankIndex = jointO2.b.linkIndex;
    const couplerIndex = jointA.b.linkIndex;
    const rockerIndex = jointO4.a.linkIndex;

    const theta2 = linkPose(system, system.q0, crankIndex).angle;
    const theta3 = linkPose(system, system.q0, couplerIndex).angle;
    const theta4 = linkPose(system, system.q0, rockerIndex).angle;

    const a2 = fourBar.dims.crankLength;
    const a3 = fourBar.dims.couplerLength;
    const a4 = fourBar.dims.rockerLength;
    const omega2 = 1;

    const omega3Expected =
      (a2 * omega2 * Math.sin(theta4 - theta2)) / (a3 * Math.sin(theta3 - theta4));
    const omega4Expected =
      (a2 * omega2 * Math.sin(theta2 - theta3)) / (a4 * Math.sin(theta4 - theta3));

    const result = solveVelocity(system, system.q0, new Float64Array([omega2]));
    expect(result.status).toBe("ok");

    const omega3Actual = result.values[system.links[couplerIndex].offset + 2];
    const omega4Actual = result.values[system.links[rockerIndex].offset + 2];

    expect(Math.abs(omega3Actual - omega3Expected)).toBeLessThanOrEqual(1e-9);
    expect(Math.abs(omega4Actual - omega4Expected)).toBeLessThanOrEqual(1e-9);
  });
});

describe("solveVelocity — defensive statuses", () => {
  it("wrong input length -> invalid-input", () => {
    const system = compileSystem(fourBar.build());
    const result = solveVelocity(system, system.q0, new Float64Array(2));
    expect(result.status).toBe("invalid-input");
  });

  it("NaN input -> invalid-input", () => {
    const system = compileSystem(fourBar.build());
    const result = solveVelocity(system, system.q0, new Float64Array([NaN]));
    expect(result.status).toBe("invalid-input");
  });

  it("under-determined system (fourBar without its motor) -> singular, all zeros, no NaN", () => {
    const doc = fourBar.build();
    const docNoMotor: MechanismDocument = { ...doc, motors: [] };
    const system = compileSystem(docNoMotor);

    const result = solveVelocity(system, system.q0, new Float64Array(0));
    expect(result.status).toBe("singular");
    expect(result.values.length).toBe(system.n);
    for (const v of result.values) {
      expect(v).toBe(0);
      expect(Number.isFinite(v)).toBe(true);
    }
  });

  it("n === 0 (a joint between two ground links) -> ok, empty values", () => {
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

    const velocityResult = solveVelocity(system, new Float64Array(0), new Float64Array(0));
    expect(velocityResult.status).toBe("ok");
    expect(velocityResult.values.length).toBe(0);

    const accelerationResult = solveAcceleration(
      system,
      new Float64Array(0),
      new Float64Array(0),
      new Float64Array(0),
    );
    expect(accelerationResult.status).toBe("ok");
    expect(accelerationResult.values.length).toBe(0);
  });
});

describe("solveAcceleration — defensive statuses", () => {
  it("wrong qDot length -> invalid-input", () => {
    const system = compileSystem(fourBar.build());
    const result = solveAcceleration(
      system,
      system.q0,
      new Float64Array(system.n - 1),
      new Float64Array([0]),
    );
    expect(result.status).toBe("invalid-input");
    expect(result.values.length).toBe(system.n);
  });

  it("NaN inputAccels -> invalid-input", () => {
    const system = compileSystem(fourBar.build());
    const result = solveAcceleration(
      system,
      system.q0,
      new Float64Array(system.n),
      new Float64Array([NaN]),
    );
    expect(result.status).toBe("invalid-input");
  });
});

describe("solveVelocityAcceleration", () => {
  it("chains solveVelocity and solveAcceleration on a healthy pose", () => {
    const system = compileSystem(fourBar.build());
    const result = solveVelocityAcceleration(
      system,
      system.q0,
      new Float64Array([1]),
      new Float64Array([0]),
    );
    expect(result.status).toBe("ok");

    const velocityOnly = solveVelocity(system, system.q0, new Float64Array([1]));
    const accelerationOnly = solveAcceleration(
      system,
      system.q0,
      velocityOnly.values,
      new Float64Array([0]),
    );
    expect(result.qDot).toEqual(velocityOnly.values);
    expect(result.qDDot).toEqual(accelerationOnly.values);
  });

  it("reports the velocity failure and returns zero qDDot when the velocity solve itself fails", () => {
    const system = compileSystem(fourBar.build());
    const result = solveVelocityAcceleration(
      system,
      system.q0,
      new Float64Array(2), // wrong length -> invalid-input
      new Float64Array([0]),
    );
    expect(result.status).toBe("invalid-input");
    expect(result.qDDot.length).toBe(system.n);
    for (const v of result.qDDot) expect(v).toBe(0);
  });
});
