import { describe, it, expect } from "vitest";
import {
  compileSystem,
  referenceState,
  jointResiduals,
  linkPose,
  estimateDragInputDelta,
  type KinematicSystem,
  type SolvedState,
} from "../kinematics";
import * as fourBar from "../kinematics/__fixtures__/fourBar";
import * as nonGrashof from "../kinematics/__fixtures__/nonGrashofFourBar";
import * as sliderCrank from "../kinematics/__fixtures__/sliderCrank";
import * as actuatorArm from "../kinematics/__fixtures__/actuatorArm";
import {
  fourBarLimitAngles,
  freudensteinTheta4,
  freudensteinBranchOf,
} from "../kinematics/__fixtures__/analytic";
import {
  add,
  sub,
  rotate,
  direction,
  fromPolar,
  perp,
  normalize,
  scale,
  distance,
  type Vec2,
} from "../geom";
import { dragToward, type DragTarget } from "./drag";

const MAX_JOINT_RESIDUAL = 1e-9;

function maxJointResidual(system: KinematicSystem, state: SolvedState): number {
  const residuals = jointResiduals(system, state.q, state.inputs);
  return residuals.length === 0 ? 0 : Math.max(...residuals.map((v) => v.residual));
}

describe("dragToward: fourBar (Grashof crank-rocker), following the true coupler curve", () => {
  const system = compileSystem(fourBar.build());
  const marker = system.markers[0];
  const target: DragTarget = { linkIndex: marker.linkIndex, local: marker.local };
  const crankIndex = system.links.findIndex((l) => l.name === "crank");

  const LEN_A = fourBar.dims.crankLength;
  const LEN_B = fourBar.dims.couplerLength;
  const LEN_C = fourBar.dims.rockerLength;
  const LEN_D = fourBar.dims.groundLength;
  const referenceCrankAngle = direction(sub(fourBar.dims.A, fourBar.dims.O2));
  const theta4Ref = direction(sub(fourBar.dims.B, fourBar.dims.O4));
  const branch = freudensteinBranchOf(LEN_A, LEN_B, LEN_C, LEN_D, referenceCrankAngle, theta4Ref);

  /** The marker's TRUE world position at crank angle `theta2`, built entirely from closed-form geometry -- never from solver output. */
  function couplerMarkerWorld(theta2: number): Vec2 {
    const A = add(fourBar.dims.O2, fromPolar(LEN_A, theta2));
    const theta4 = freudensteinTheta4(LEN_A, LEN_B, LEN_C, LEN_D, theta2, branch);
    const B = add(fourBar.dims.O4, fromPolar(LEN_C, theta4));
    const couplerAngle = direction(sub(B, A));
    return add(A, rotate(marker.local, couplerAngle));
  }

  it("tracks the coupler curve from 60deg to 120deg (5deg steps): on-target, joints exact, crank angle matches", () => {
    let state = referenceState(system);

    for (let deg = 60; deg <= 120; deg += 5) {
      const theta2 = (deg * Math.PI) / 180;
      const pointerWorld = couplerMarkerWorld(theta2);

      const result = dragToward(system, state, target, pointerWorld);
      expect(result.status).toBe("ok");

      expect(distance(result.pointWorld, pointerWorld)).toBeLessThanOrEqual(
        1e-6 * system.lengthScale,
      );
      expect(maxJointResidual(system, result.state)).toBeLessThanOrEqual(MAX_JOINT_RESIDUAL);

      const crankAngle = linkPose(system, result.state.q, crankIndex).angle;
      expect(Math.abs(crankAngle - theta2)).toBeLessThanOrEqual(1e-6);

      state = result.state;
    }
  });

  it("an off-curve target (50mm along the curve normal) settles at the closest reachable point, joints exact", () => {
    const start = referenceState(system);
    const onCurve = couplerMarkerWorld(referenceCrankAngle);

    // The tangent at the reference pose (dragDrive's own, already-validated
    // primitive), rotated 90deg, gives the curve's local normal direction.
    const tangentEstimate = estimateDragInputDelta(
      system,
      start.q,
      target.linkIndex,
      target.local,
      onCurve,
    );
    expect(tangentEstimate.status).toBe("ok");
    const g: Vec2 = { x: tangentEstimate.tangent[0], y: tangentEstimate.tangent[1] };
    const normalDirection = normalize(perp(g));
    const pointerWorld = add(onCurve, scale(normalDirection, 50));

    const result = dragToward(system, start, target, pointerWorld, { maxInnerIterations: 20 });
    expect(result.status).toBe("ok");
    expect(maxJointResidual(system, result.state)).toBeLessThanOrEqual(MAX_JOINT_RESIDUAL);

    const finalTangent = estimateDragInputDelta(
      system,
      result.state.q,
      target.linkIndex,
      target.local,
      pointerWorld,
    );
    expect(finalTangent.status).toBe("ok");
    const gFinal: Vec2 = { x: finalTangent.tangent[0], y: finalTangent.tangent[1] };
    const gFinalMag = Math.hypot(gFinal.x, gFinal.y);
    const residualVec = sub(pointerWorld, result.pointWorld);
    const projection = Math.abs(gFinal.x * residualVec.x + gFinal.y * residualVec.y) / gFinalMag;
    expect(projection).toBeLessThanOrEqual(1e-6 * system.lengthScale);
  });

  it("never mutates or aliases `prev`", () => {
    const start = referenceState(system);
    const qCopy = Float64Array.from(start.q);
    const inputsCopy = Float64Array.from(start.inputs);
    const pointerWorld = couplerMarkerWorld((80 * Math.PI) / 180);

    const result = dragToward(system, start, target, pointerWorld);

    expect(start.q).toEqual(qCopy);
    expect(start.inputs).toEqual(inputsCopy);
    expect(result.state).not.toBe(start);
    expect(result.state.q).not.toBe(start.q);
  });

  it("an invalid drag target (a ground link) gives status 'invalid-input' without calling advanceDrive", () => {
    const groundIndex = system.links.findIndex((l) => l.isGround);
    const start = referenceState(system);
    const result = dragToward(
      system,
      start,
      { linkIndex: groundIndex, local: { x: 0, y: 0 } },
      { x: 0, y: 0 },
    );
    expect(result.status).toBe("invalid-input");
    expect(result.state.q).toEqual(start.q);
    expect(result.residualNorm).toBe(0);
    expect(result.nearSingular).toBe(false);
  });

  it("a pointer already exactly at the grabbed point converges with zero inner iterations (state unchanged)", () => {
    const start = referenceState(system);
    const pointerWorld = couplerMarkerWorld(referenceCrankAngle);
    const result = dragToward(system, start, target, pointerWorld);
    expect(result.status).toBe("ok");
    expect(result.state.q).toEqual(start.q);
    expect(result.residualToPointer).toBeLessThan(1e-9 * system.lengthScale);
  });

  it("a tiny maxInputStep clamps the per-step delta going forward (positive clamp)", () => {
    const start = referenceState(system);
    const farAhead = couplerMarkerWorld((150 * Math.PI) / 180);
    const result = dragToward(system, start, target, farAhead, { maxInputStep: 1e-4 });
    expect(result.status).toBe("ok");
    expect(maxJointResidual(system, result.state)).toBeLessThanOrEqual(MAX_JOINT_RESIDUAL);
    // 4 inner iterations x a 1e-4 clamp bounds how far the crank could move.
    expect(Math.abs(result.state.inputs[0])).toBeLessThanOrEqual(4 * 1e-4 + 1e-9);
  });

  it("a tiny maxInputStep clamps the per-step delta going backward (negative clamp)", () => {
    const start = referenceState(system);
    const behind = couplerMarkerWorld((10 * Math.PI) / 180);
    const result = dragToward(system, start, target, behind, { maxInputStep: 1e-4 });
    expect(result.status).toBe("ok");
    expect(maxJointResidual(system, result.state)).toBeLessThanOrEqual(MAX_JOINT_RESIDUAL);
    expect(Math.abs(result.state.inputs[0])).toBeLessThanOrEqual(4 * 1e-4 + 1e-9);
  });
});

describe("dragToward: actuatorArm (linear motor), default per-kind step clamp", () => {
  it("moves the linear motor's input toward a nearby target, joints stay exact", () => {
    const system = compileSystem(actuatorArm.build());
    const armIndex = system.links.findIndex((l) => l.name === "arm");
    const target: DragTarget = {
      linkIndex: armIndex,
      local: { x: actuatorArm.dims.armLength, y: 0 },
    };

    const start = referenceState(system);
    const pointerWorld: Vec2 = add(actuatorArm.dims.T, { x: 2, y: -1 });

    const result = dragToward(system, start, target, pointerWorld);

    expect(result.status).toBe("ok");
    expect(maxJointResidual(system, result.state)).toBeLessThanOrEqual(MAX_JOINT_RESIDUAL);
    expect(result.state.inputs[0]).not.toBeCloseTo(start.inputs[0], 6);
  });
});

describe("dragToward: nonGrashofFourBar (triple-rocker), dragging the coupler past the lock-up", () => {
  it("stalls with status 'locked' at the analytic crank limit, joints exact", () => {
    const system = compileSystem(nonGrashof.build());
    const couplerIndex = system.links.findIndex((l) => l.name === "coupler");
    const target: DragTarget = {
      linkIndex: couplerIndex,
      local: { x: nonGrashof.dims.couplerLength / 2, y: 20 },
    };

    const LEN_A = nonGrashof.dims.crankLength;
    const LEN_B = nonGrashof.dims.couplerLength;
    const LEN_C = nonGrashof.dims.rockerLength;
    const LEN_D = nonGrashof.dims.groundLength;
    const referenceCrankAngle = nonGrashof.dims.referenceCrankAngle;
    const theta4Ref = direction(sub(nonGrashof.dims.B, nonGrashof.dims.O4));
    const branch = freudensteinBranchOf(LEN_A, LEN_B, LEN_C, LEN_D, referenceCrankAngle, theta4Ref);

    /** The dragged point's TRUE world position at crank angle `theta2` (closed-form, not solver output). */
    function couplerPointAt(theta2: number): Vec2 {
      const A = add(nonGrashof.dims.O2, fromPolar(LEN_A, theta2));
      const theta4 = freudensteinTheta4(LEN_A, LEN_B, LEN_C, LEN_D, theta2, branch);
      const B = add(nonGrashof.dims.O4, fromPolar(LEN_C, theta4));
      const couplerAngle = direction(sub(B, A));
      return add(A, rotate(target.local, couplerAngle));
    }

    // Drive the pointer target degree-by-degree past the analytic limit
    // (~82.8deg here) via the true closed-form curve -- past the limit the
    // curve's own clipped-discriminant value still gives a well-defined
    // extrapolated point, which is exactly what a user's mouse does when
    // dragging past where the mechanism can physically follow.
    let state = referenceState(system);
    let locked: ReturnType<typeof dragToward> | undefined;

    for (let deg = 31; deg <= 100; deg++) {
      const theta2 = (deg * Math.PI) / 180;
      const pointerWorld = couplerPointAt(theta2);
      const result = dragToward(system, state, target, pointerWorld);
      if (result.status === "locked") {
        locked = result;
        break;
      }
      expect(result.status).toBe("ok");
      expect(maxJointResidual(system, result.state)).toBeLessThanOrEqual(MAX_JOINT_RESIDUAL);
      state = result.state;
    }

    if (!locked || !locked.lockUp) throw new Error("expected to reach a lock-up");
    expect(maxJointResidual(system, locked.state)).toBeLessThanOrEqual(MAX_JOINT_RESIDUAL);

    const limits = fourBarLimitAngles(LEN_D, LEN_A, LEN_B, LEN_C);
    const upperLimit = Math.max(...limits);
    const crankAngleAtLock = locked.lockUp.inputs[0] + referenceCrankAngle;
    expect(Math.abs(crankAngleAtLock - upperLimit)).toBeLessThanOrEqual(1e-5);
  });
});

describe("dragToward: sliderCrank, dragging the slider along its rail", () => {
  it("moves the crank input, joints stay exact", () => {
    const system = compileSystem(sliderCrank.build());
    const sliderIndex = system.links.findIndex((l) => l.name === "slider");
    const target: DragTarget = { linkIndex: sliderIndex, local: { x: 0, y: 0 } };

    const start = referenceState(system);
    const pointerWorld: Vec2 = { x: sliderCrank.dims.P.x + 20, y: sliderCrank.dims.offset };

    const result = dragToward(system, start, target, pointerWorld);

    expect(result.status).toBe("ok");
    expect(maxJointResidual(system, result.state)).toBeLessThanOrEqual(MAX_JOINT_RESIDUAL);
    expect(result.state.inputs[0]).not.toBeCloseTo(start.inputs[0], 6);
    expect(distance(result.pointWorld, pointerWorld)).toBeLessThan(
      distance({ x: sliderCrank.dims.P.x, y: sliderCrank.dims.offset }, pointerWorld),
    );
  });
});
