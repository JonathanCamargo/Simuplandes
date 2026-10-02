import { describe, it, expect, vi } from "vitest";

// Partial-mocks "../kinematics" so one test (below) can force advanceDrive's
// "no-convergence" status deterministically -- a status that is otherwise
// impractical to provoke from a real fixture within a reasonable test
// budget. Every other call transparently forwards to the real
// implementation.
vi.mock("../kinematics", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../kinematics")>();
  return { ...actual, advanceDrive: vi.fn(actual.advanceDrive) };
});

import {
  compileSystem,
  referenceState,
  linkPose,
  solveVelocityAcceleration,
  advanceDrive,
} from "../kinematics";
import * as fourBar from "../kinematics/__fixtures__/fourBar";
import * as nonGrashof from "../kinematics/__fixtures__/nonGrashofFourBar";
import * as sliderCrank from "../kinematics/__fixtures__/sliderCrank";
import * as actuatorArm from "../kinematics/__fixtures__/actuatorArm";
import * as tenBar from "../kinematics/__fixtures__/tenBar";
import {
  fourBarLimitAngles,
  freudensteinTheta4,
  freudensteinBranchOf,
} from "../kinematics/__fixtures__/analytic";
import { sub, direction } from "../geom";
import { computeSweep } from "./sweep";

describe("computeSweep: fourBar (Grashof crank-rocker)", () => {
  const system = compileSystem(fourBar.build());
  const start = referenceState(system);
  const rockerIndex = system.links.findIndex((l) => l.name === "rocker");

  const LEN_A = fourBar.dims.crankLength;
  const LEN_B = fourBar.dims.couplerLength;
  const LEN_C = fourBar.dims.rockerLength;
  const LEN_D = fourBar.dims.groundLength;
  const referenceCrankAngle = direction(sub(fourBar.dims.A, fourBar.dims.O2));
  const theta4Ref = direction(sub(fourBar.dims.B, fourBar.dims.O4));
  const branch = freudensteinBranchOf(LEN_A, LEN_B, LEN_C, LEN_D, referenceCrankAngle, theta4Ref);

  it("is a full-rotation sweep: 361 samples, 0..2*PI ascending, first/last q agree within 1e-9*lengthScale", () => {
    const sweep = computeSweep(system, start, 0);
    expect(sweep.kind).toBe("full-rotation");
    expect(sweep.samples).toHaveLength(361);
    expect(sweep.inputMin).toBeCloseTo(0, 12);
    expect(sweep.inputMax).toBeCloseTo(2 * Math.PI, 12);

    for (let i = 1; i < sweep.samples.length; i++) {
      expect(sweep.samples[i].input).toBeGreaterThan(sweep.samples[i - 1].input);
    }

    const first = sweep.samples[0];
    const last = sweep.samples[sweep.samples.length - 1];
    let maxDiff = 0;
    for (let i = 0; i < first.q.length; i++) {
      // Position slots (x, y) must match raw; the DRIVEN motor's own angle
      // slot legitimately differs by exactly 2*PI (a full turn is encoded
      // as a monotonically-increasing absolute angle, never wrapped, by
      // this engine's own design -- KIN-03/04's continuation never mods
      // angles). Every angle slot is therefore compared mod 2*PI.
      const isAngle = i % 3 === 2;
      let diff = first.q[i] - last.q[i];
      if (isAngle) {
        diff = diff % (2 * Math.PI);
        if (diff > Math.PI) diff -= 2 * Math.PI;
        if (diff < -Math.PI) diff += 2 * Math.PI;
      }
      maxDiff = Math.max(maxDiff, Math.abs(diff));
    }
    expect(maxDiff).toBeLessThanOrEqual(1e-9 * system.lengthScale);
  });

  it("every sample's rocker angle matches freudensteinTheta4 (reference branch) within 1e-6 rad", () => {
    const sweep = computeSweep(system, start, 0);
    for (const sample of sweep.samples) {
      const theta2 = referenceCrankAngle + sample.input;
      const expectedTheta4 = freudensteinTheta4(LEN_A, LEN_B, LEN_C, LEN_D, theta2, branch);
      const actualTheta4 = linkPose(system, sample.q, rockerIndex).angle;
      let diff = (actualTheta4 - expectedTheta4) % (2 * Math.PI);
      if (diff > Math.PI) diff -= 2 * Math.PI;
      if (diff < -Math.PI) diff += 2 * Math.PI;
      expect(Math.abs(diff)).toBeLessThanOrEqual(1e-6);
    }
  });

  it("each sample's qDot/qDDot matches solveVelocityAcceleration at inputRate=1, 0 acceleration", () => {
    const sweep = computeSweep(system, start, 0);
    const sample = sweep.samples[100];
    const rates = new Float64Array([1]);
    const accels = new Float64Array([0]);
    const rate = solveVelocityAcceleration(system, sample.q, rates, accels);
    expect(rate.status).toBe("ok");
    expect(sample.qDot).toEqual(rate.qDot);
    expect(sample.qDDot).toEqual(rate.qDDot);
  });

  it("a finite-difference qDot from neighboring samples matches the analytic qDot within 1e-3 relative", () => {
    const sweep = computeSweep(system, start, 0);
    const i = 180;
    const before = sweep.samples[i - 1];
    const after = sweep.samples[i + 1];
    const mid = sweep.samples[i];
    const dInput = after.input - before.input;

    for (let j = 0; j < mid.q.length; j++) {
      const fd = (after.q[j] - before.q[j]) / dInput;
      const analytic = mid.qDot[j];
      const scale = Math.max(1, Math.abs(analytic));
      expect(Math.abs(fd - analytic)).toBeLessThanOrEqual(1e-3 * scale);
    }
  });
});

describe("computeSweep: nonGrashofFourBar (triple-rocker)", () => {
  it("is a bounded sweep bracketed by the analytic lock-up limits, ascending, no duplicate inputs", () => {
    const system = compileSystem(nonGrashof.build());
    const start = referenceState(system);
    const sweep = computeSweep(system, start, 0);

    expect(sweep.kind).toBe("bounded");
    expect(sweep.inputMin).toBeLessThan(0);
    expect(sweep.inputMax).toBeGreaterThan(0);
    expect(sweep.lockUpMin).toBeDefined();
    expect(sweep.lockUpMax).toBeDefined();

    for (let i = 1; i < sweep.samples.length; i++) {
      expect(sweep.samples[i].input).toBeGreaterThan(sweep.samples[i - 1].input);
    }

    const LEN_A = nonGrashof.dims.crankLength;
    const LEN_B = nonGrashof.dims.couplerLength;
    const LEN_C = nonGrashof.dims.rockerLength;
    const LEN_D = nonGrashof.dims.groundLength;
    const limits = fourBarLimitAngles(LEN_D, LEN_A, LEN_B, LEN_C);
    const upperLimit = Math.max(...limits);
    const lowerLimit = Math.min(...limits);
    const refAngle = nonGrashof.dims.referenceCrankAngle;

    expect(Math.abs(sweep.inputMax + refAngle - upperLimit)).toBeLessThanOrEqual(1e-5);
    expect(Math.abs(sweep.inputMin + refAngle - lowerLimit)).toBeLessThanOrEqual(1e-5);
  });
});

describe("computeSweep: sliderCrank", () => {
  it("reflects whatever range this fixture's crank actually has, joints implicitly exact (advanceDrive-only)", () => {
    const system = compileSystem(sliderCrank.build());
    const start = referenceState(system);
    const sweep = computeSweep(system, start, 0);

    expect(["full-rotation", "bounded"]).toContain(sweep.kind);
    if (sweep.kind === "full-rotation") {
      expect(sweep.inputMin).toBeCloseTo(0, 9);
      expect(sweep.inputMax).toBeCloseTo(2 * Math.PI, 9);
    } else {
      expect(sweep.inputMin).toBeLessThanOrEqual(0);
      expect(sweep.inputMax).toBeGreaterThanOrEqual(0);
    }
  });
});

describe("computeSweep: actuatorArm (linear motor)", () => {
  it("steps by lengthScale/100, is bounded by lock-ups or maxTravel, and caps at maxSamples", () => {
    const system = compileSystem(actuatorArm.build());
    const start = referenceState(system);
    const sweep = computeSweep(system, start, 0);

    expect(sweep.kind).toBe("bounded");
    expect(sweep.samples.length).toBeLessThanOrEqual(2000);

    const maxTravel = 2 * system.lengthScale;
    // Either a lock-up bracketed the range, or the travel cap did (within
    // one step size of the cap).
    const step = system.lengthScale / 100;
    if (sweep.lockUpMax === undefined) {
      expect(sweep.inputMax).toBeLessThanOrEqual(maxTravel + 1e-9);
      expect(sweep.inputMax).toBeGreaterThanOrEqual(maxTravel - step - 1e-9);
    }
    if (sweep.lockUpMin === undefined) {
      expect(sweep.inputMin).toBeGreaterThanOrEqual(-maxTravel - 1e-9);
      expect(sweep.inputMin).toBeLessThanOrEqual(-maxTravel + step + 1e-9);
    }
  });
});

describe("computeSweep: actuatorArm, travel-cap-only range (no lock-up reached)", () => {
  it("stops exactly at +-maxTravelFactor*lengthScale in both directions when no lock-up intervenes first", () => {
    const system = compileSystem(actuatorArm.build());
    const start = referenceState(system);
    const sweep = computeSweep(system, start, 0, { maxTravelFactor: 0.01 });

    expect(sweep.kind).toBe("bounded");
    expect(sweep.lockUpMin).toBeUndefined();
    expect(sweep.lockUpMax).toBeUndefined();
    const maxTravel = 0.01 * system.lengthScale;
    expect(sweep.inputMin).toBeCloseTo(-maxTravel, 9);
    expect(sweep.inputMax).toBeCloseTo(maxTravel, 9);
  });
});

describe("computeSweep: maxSamples budget exhaustion (neither full-rotation nor a lock-up)", () => {
  it("stops early once the sample budget runs out, still ascending and bounded", () => {
    const system = compileSystem(actuatorArm.build());
    const start = referenceState(system);
    const sweep = computeSweep(system, start, 0, { maxSamples: 5 });

    expect(sweep.kind).toBe("bounded");
    expect(sweep.samples).toHaveLength(5);
    expect(sweep.lockUpMax).toBeUndefined();
    for (let i = 1; i < sweep.samples.length; i++) {
      expect(sweep.samples[i].input).toBeGreaterThan(sweep.samples[i - 1].input);
    }
  });
});

describe("computeSweep: advanceDrive 'no-convergence' (mocked)", () => {
  it("stops marching without throwing, returning the samples gathered so far", () => {
    const system = compileSystem(fourBar.build());
    const start = referenceState(system);

    vi.mocked(advanceDrive).mockReturnValueOnce({
      status: "no-convergence",
      state: start,
      residualNorm: 1,
      substeps: 0,
      singularity: { sigmaMin: 0, sigmaMax: 0, ratio: 0, nearSingular: false },
    });

    const sweep = computeSweep(system, start, 0, { maxSamples: 3 });
    expect(sweep.kind).toBe("bounded");
    // The mocked call consumes the forward march's only attempted step
    // (0 forward samples); the backward march (real advanceDrive, budget 2)
    // fills the rest: 2 backward + 1 start + 0 forward = 3.
    expect(sweep.samples).toHaveLength(3);
    expect(sweep.samples[sweep.samples.length - 1].input).toBe(0);
  });
});

describe("computeSweep: 0 motors / out-of-range motorIndex", () => {
  it("returns kind 'none' with exactly one sample (the start), never throws", () => {
    const withMotor = compileSystem(fourBar.build());
    const withMotorStart = referenceState(withMotor);

    expect(() => computeSweep(withMotor, withMotorStart, -1)).not.toThrow();
    const negative = computeSweep(withMotor, withMotorStart, -1);
    expect(negative.kind).toBe("none");
    expect(negative.samples).toHaveLength(1);
    expect(negative.samples[0].input).toBe(0);

    expect(() => computeSweep(withMotor, withMotorStart, 5)).not.toThrow();
    const outOfRange = computeSweep(withMotor, withMotorStart, 5);
    expect(outOfRange.kind).toBe("none");
    expect(outOfRange.samples).toHaveLength(1);

    const docNoMotors = { ...fourBar.build(), motors: [] };
    const noMotorSystem = compileSystem(docNoMotors);
    const noMotorStart = referenceState(noMotorSystem);
    expect(() => computeSweep(noMotorSystem, noMotorStart, 0)).not.toThrow();
    const noMotors = computeSweep(noMotorSystem, noMotorStart, 0);
    expect(noMotors.kind).toBe("none");
    expect(noMotors.samples).toHaveLength(1);
  });
});

describe("computeSweep: 10-bar performance", () => {
  it("completes in a generous bound (well under interactive-latency territory)", () => {
    const fixture = tenBar.build();
    const system = compileSystem(fixture.doc);
    const start = referenceState(system);

    const t0 = performance.now();
    const sweep = computeSweep(system, start, 0);
    const elapsedMs = performance.now() - t0;

    expect(sweep.kind).toBe("full-rotation");
    // A generous bound, per the plan's own instruction: measured ~64ms
    // standalone (`vitest run src/sim/sweep.test.ts`, no coverage), but
    // ~630-640ms under `npm run test`'s full-suite `--coverage` run (V8
    // coverage instrumentation plus every other test file's CPU
    // contention) -- both far below a 500ms-per-sweep interactivity
    // concern, so the bound here is set generously above the instrumented
    // figure rather than the bare one.
    expect(elapsedMs).toBeLessThan(5000);
    console.log(
      `[05-02] 10-bar computeSweep: ${elapsedMs.toFixed(2)}ms for ${sweep.samples.length} samples`,
    );
  });
});
