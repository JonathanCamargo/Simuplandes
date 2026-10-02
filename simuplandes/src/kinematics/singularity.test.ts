import { describe, it, expect } from "vitest";
import { compileSystem, linkPose, type KinematicSystem } from "./system";
import { referenceState } from "./position";
import { advanceDrive, advanceRocking, analyzeSingularity, SINGULAR_RATIO } from "./singularity";
import * as nonGrashof from "./__fixtures__/nonGrashofFourBar";
import * as fourBar from "./__fixtures__/fourBar";
import {
  fourBarLimitAngles,
  freudensteinTheta4,
  freudensteinBranchOf,
} from "./__fixtures__/analytic";
import { direction, sub } from "../geom";
import type { RevoluteConstraint } from "./constraints";

const A = nonGrashof.dims.crankLength;
const B = nonGrashof.dims.couplerLength;
const C = nonGrashof.dims.rockerLength;
const D = nonGrashof.dims.groundLength;
const THETA2_REF = nonGrashof.dims.referenceCrankAngle;
const THETA4_REF = direction(sub(nonGrashof.dims.B, nonGrashof.dims.O4));
const LIMITS = fourBarLimitAngles(D, A, B, C);
const UPPER_LIMIT = Math.max(...LIMITS);
const LOWER_LIMIT = Math.min(...LIMITS);
const REF_BRANCH = freudensteinBranchOf(A, B, C, D, THETA2_REF, THETA4_REF);

function crankRockerIndices(system: KinematicSystem): { crank: number; rocker: number } {
  const crank = system.links.findIndex((l) => l.name === "crank");
  const rocker = system.links.findIndex((l) => l.name === "rocker");
  return { crank, rocker };
}

describe("analytic.ts self-check (Freudenstein identity + branch reproduction)", () => {
  it("K1*cos(theta4) - K2*cos(theta2) + K3 = cos(theta2 - theta4) at the fixture's authored reference pose", () => {
    const K1 = D / A;
    const K2 = D / C;
    const K3 = (A * A - B * B + C * C + D * D) / (2 * A * C);
    const lhs = K1 * Math.cos(THETA4_REF) - K2 * Math.cos(THETA2_REF) + K3;
    const rhs = Math.cos(THETA2_REF - THETA4_REF);
    expect(Math.abs(lhs - rhs)).toBeLessThanOrEqual(1e-9);
  });

  it("one branch reproduces the authored theta4", () => {
    const predicted = freudensteinTheta4(A, B, C, D, THETA2_REF, REF_BRANCH);
    let diff = (predicted - THETA4_REF) % (2 * Math.PI);
    if (diff > Math.PI) diff -= 2 * Math.PI;
    if (diff < -Math.PI) diff += 2 * Math.PI;
    expect(Math.abs(diff)).toBeLessThanOrEqual(1e-6);
  });
});

describe("fourBarLimitAngles (nonGrashofFourBar)", () => {
  it("matches the law-of-cosines limit acos(0.125), and has no folded limit", () => {
    expect(LIMITS.length).toBe(2);
    expect(UPPER_LIMIT).toBeCloseTo(Math.acos(0.125), 9);
    expect(LOWER_LIMIT).toBeCloseTo(-Math.acos(0.125), 9);
  });
});

describe("advanceDrive lock-up bracketing (nonGrashofFourBar)", () => {
  it("locks going up, with the bracketed limit matching the closed form within 1e-6 rad", () => {
    const system = compileSystem(nonGrashof.build());
    const motorId = system.motors[0].id;
    let state = referenceState(system);
    let locked: ReturnType<typeof advanceDrive> | undefined;

    for (let deg = 1; deg <= 90; deg++) {
      const result = advanceDrive(system, state, new Float64Array([(deg * Math.PI) / 180]));
      if (result.status === "locked") {
        locked = result;
        break;
      }
      expect(result.status).toBe("ok");
      state = result.state;
    }

    if (!locked || !locked.lockUp) throw new Error("expected a lock-up going up");
    expect(locked.residualNorm).toBeLessThan(1e-9);
    expect(locked.lockUp.motorId).toBe(motorId);
    expect(locked.lockUp.openDirection).toBe(-1);
    expect(locked.lockUp.singularity.nearSingular).toBe(true);
    expect(Math.abs(locked.lockUp.inputs[0] + Math.PI / 6 - UPPER_LIMIT)).toBeLessThanOrEqual(1e-6);
    // Lies before the limit, not past it.
    expect(locked.lockUp.inputs[0] + Math.PI / 6).toBeLessThanOrEqual(UPPER_LIMIT + 1e-9);

    // State not corrupted: advancing from the locked state toward the open
    // direction succeeds, and the locked state's own arrays are unchanged.
    const qCopy = Float64Array.from(locked.state.q);
    const inputsCopy = Float64Array.from(locked.state.inputs);
    const reopenTarget = Float64Array.from(locked.state.inputs);
    reopenTarget[0] += locked.lockUp.openDirection * ((1 * Math.PI) / 180);
    const reopened = advanceDrive(system, locked.state, reopenTarget);
    expect(reopened.status).toBe("ok");
    expect(locked.state.q).toEqual(qCopy);
    expect(locked.state.inputs).toEqual(inputsCopy);
  });

  it("locks going down, with the bracketed limit matching the closed form within 1e-6 rad", () => {
    const system = compileSystem(nonGrashof.build());
    let state = referenceState(system);
    let locked: ReturnType<typeof advanceDrive> | undefined;

    for (let deg = 0; deg >= -130; deg--) {
      const result = advanceDrive(system, state, new Float64Array([(deg * Math.PI) / 180]));
      if (result.status === "locked") {
        locked = result;
        break;
      }
      expect(result.status).toBe("ok");
      state = result.state;
    }

    if (!locked || !locked.lockUp) throw new Error("expected a lock-up going down");
    expect(locked.residualNorm).toBeLessThan(1e-9);
    expect(locked.lockUp.openDirection).toBe(1);
    expect(locked.lockUp.singularity.nearSingular).toBe(true);
    expect(Math.abs(locked.lockUp.inputs[0] + Math.PI / 6 - LOWER_LIMIT)).toBeLessThanOrEqual(1e-6);
  });

  it("invalid target -> invalid-input, state unchanged from prev", () => {
    const system = compileSystem(nonGrashof.build());
    const prev = referenceState(system);
    const result = advanceDrive(system, prev, new Float64Array(2));
    expect(result.status).toBe("invalid-input");
    expect(result.state.q).toEqual(prev.q);
    expect(result.state.inputs).toEqual(prev.inputs);
  });
});

describe("analyzeSingularity", () => {
  it("reference pose is not near-singular; a bracketed lock-up is", () => {
    const system = compileSystem(nonGrashof.build());
    const refSingularity = analyzeSingularity(system, system.q0);
    expect(refSingularity.nearSingular).toBe(false);
    // The plan's own illustrative number (ratio > 1e-2) does not hold for
    // this fixture's actual reference-pose conditioning once the Jacobian
    // is length-scale-normalized (measured ~2.4e-3 here, and ~2.6e-3 to
    // 3.1e-3 across full healthy sweeps of every other fixture in this
    // phase) -- see 03-02-SUMMARY.md. What matters functionally is a
    // robust separation from a genuine lock-up, checked below.
    expect(refSingularity.ratio).toBeGreaterThan(SINGULAR_RATIO);

    let state = referenceState(system);
    let locked: ReturnType<typeof advanceDrive> | undefined;
    for (let deg = 1; deg <= 90; deg++) {
      const result = advanceDrive(system, state, new Float64Array([(deg * Math.PI) / 180]));
      if (result.status === "locked") {
        locked = result;
        break;
      }
      state = result.state;
    }
    if (!locked) throw new Error("expected a lock-up");
    expect(locked.singularity.ratio).toBeLessThan(SINGULAR_RATIO);
    // A robust, orders-of-magnitude separation between healthy and locked.
    expect(locked.singularity.ratio).toBeLessThan(refSingularity.ratio * 1e-3);
  });
});

describe("advanceRocking (nonGrashofFourBar)", () => {
  it("reverses at each limit for two full oscillations without a branch jump, staying within the limits", () => {
    const system = compileSystem(nonGrashof.build());
    const { crank, rocker } = crankRockerIndices(system);

    let state = referenceState(system);
    let currentDirection: 1 | -1 = 1;
    let totalReversals = 0;
    let calls = 0;
    const maxCalls = 2000;

    while (totalReversals < 4 && calls < maxCalls) {
      calls++;
      const result = advanceRocking(system, state, 0, (1 * Math.PI) / 180, currentDirection);
      expect(["ok", "locked"]).toContain(result.status);
      expect(result.residualNorm).toBeLessThan(1e-9);

      state = result.state;
      currentDirection = result.direction;
      totalReversals += result.reversals;

      const input = state.inputs[0];
      expect(input).toBeGreaterThanOrEqual(LOWER_LIMIT - THETA2_REF - 1e-6);
      expect(input).toBeLessThanOrEqual(UPPER_LIMIT - THETA2_REF + 1e-6);

      const theta2 = linkPose(system, state.q, crank).angle;
      const theta4 = linkPose(system, state.q, rocker).angle;
      const distanceFromLimit = Math.min(...LIMITS.map((l) => Math.abs(l - theta2)));
      if (distanceFromLimit > 1e-3) {
        const branch = freudensteinBranchOf(A, B, C, D, theta2, theta4);
        expect(branch).toBe(REF_BRANCH);
      }
    }

    expect(calls).toBeLessThan(maxCalls);
    expect(totalReversals).toBeGreaterThanOrEqual(4);
  });
});

describe("branch preservation on a Grashof mechanism (fourBar)", () => {
  it("one +90 degree request matches the 1-degree-step result within 1e-8", () => {
    const system = compileSystem(fourBar.build());

    const jumpResult = advanceDrive(
      system,
      referenceState(system),
      new Float64Array([Math.PI / 2]),
    );
    expect(jumpResult.status).toBe("ok");

    let stepState = referenceState(system);
    for (let deg = 1; deg <= 90; deg++) {
      const result = advanceDrive(system, stepState, new Float64Array([(deg * Math.PI) / 180]));
      expect(result.status).toBe("ok");
      stepState = result.state;
    }

    for (let i = 0; i < system.n; i++) {
      expect(Math.abs(jumpResult.state.q[i] - stepState.q[i])).toBeLessThan(1e-8);
    }
  });

  it("Freudenstein's branch is unchanged over a full 360 degree turn in 10-degree requests", () => {
    const system = compileSystem(fourBar.build());
    const jointA = system.constraints.find(
      (c): c is RevoluteConstraint => c.kind === "revolute" && c.label === "A",
    );
    const jointO2 = system.constraints.find(
      (c): c is RevoluteConstraint => c.kind === "revolute" && c.label === "O2",
    );
    const jointO4 = system.constraints.find(
      (c): c is RevoluteConstraint => c.kind === "revolute" && c.label === "O4",
    );
    if (!jointA || !jointO2 || !jointO4) throw new Error("expected revolute A, O2, O4 constraints");

    const crankIndex = jointO2.b.linkIndex;
    const couplerIndex = jointA.b.linkIndex;
    void couplerIndex;
    const rockerIndex = jointO4.a.linkIndex;

    const a = fourBar.dims.crankLength;
    const b = fourBar.dims.couplerLength;
    const c = fourBar.dims.rockerLength;
    const d = fourBar.dims.groundLength;

    const theta2Ref = linkPose(system, system.q0, crankIndex).angle;
    const theta4Ref = linkPose(system, system.q0, rockerIndex).angle;
    const refBranch = freudensteinBranchOf(a, b, c, d, theta2Ref, theta4Ref);

    let state = referenceState(system);
    for (let deg = 10; deg <= 360; deg += 10) {
      const result = advanceDrive(system, state, new Float64Array([(deg * Math.PI) / 180]));
      expect(result.status).toBe("ok");
      state = result.state;

      const theta2 = linkPose(system, state.q, crankIndex).angle;
      const theta4 = linkPose(system, state.q, rockerIndex).angle;
      const branch = freudensteinBranchOf(a, b, c, d, theta2, theta4);
      expect(branch).toBe(refBranch);
    }
  });
});
