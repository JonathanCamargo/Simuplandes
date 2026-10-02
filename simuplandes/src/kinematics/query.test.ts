import { describe, it, expect } from "vitest";
import { compileSystem, linkPose, type KinematicSystem } from "./system";
import { newtonSolve, referenceState, solvePosition } from "./position";
import { solveVelocity, solveAcceleration } from "./velocity";
import { pointKinematics, computeFrameKinematics } from "./query";
import { localToWorld } from "../geom";
import * as fourBar from "./__fixtures__/fourBar";
import type { RevoluteConstraint } from "./constraints";

/** Marches from the reference state to `nearT` at the fixture's constant-speed-1 rate. */
function marchTo(
  system: KinematicSystem,
  nearT: number,
): { q: Float64Array; inputs: Float64Array } {
  let state = referenceState(system);
  const steps = Math.max(1, Math.ceil(nearT / 0.05));
  for (let i = 1; i <= steps; i++) {
    const t = (nearT * i) / steps;
    const result = solvePosition(system, state, new Float64Array([t]));
    expect(result.status).toBe("ok");
    state = result.state;
  }
  return state;
}

const H_VELOCITY = 1e-4;
const H_ACCELERATION = 3e-4;
const SAMPLE_TIMES = [0.4, 1.3, 2.9];

describe("pointKinematics matches finite-difference world velocity/acceleration (fourBar's crank-tip site A)", () => {
  it.each(SAMPLE_TIMES)("at t=%f", (t) => {
    const system = compileSystem(fourBar.build());
    const jointA = system.constraints.find(
      (c): c is RevoluteConstraint => c.kind === "revolute" && c.label === "A",
    );
    if (!jointA) throw new Error("expected a revolute A constraint");
    const crankIndex = jointA.a.linkIndex;
    const local = { x: jointA.a.local.x, y: jointA.a.local.y };

    const warm = marchTo(system, t);
    const solveAt = (time: number): Float64Array => {
      const result = newtonSolve(system, warm.q, new Float64Array([time]), { tolerance: 1e-12 });
      expect(result.converged).toBe(true);
      return result.q;
    };

    const worldAt = (q: Float64Array): { x: number; y: number } => {
      const pose = linkPose(system, q, crankIndex);
      return localToWorld(local, { x: pose.x, y: pose.y }, pose.angle);
    };

    const qZero = solveAt(t);
    const pV = { minus: worldAt(solveAt(t - H_VELOCITY)), plus: worldAt(solveAt(t + H_VELOCITY)) };
    const pA = {
      minus: worldAt(solveAt(t - H_ACCELERATION)),
      zero: worldAt(qZero),
      plus: worldAt(solveAt(t + H_ACCELERATION)),
    };

    const velocityFd = {
      x: (pV.plus.x - pV.minus.x) / (2 * H_VELOCITY),
      y: (pV.plus.y - pV.minus.y) / (2 * H_VELOCITY),
    };
    const accelerationFd = {
      x: (pA.plus.x - 2 * pA.zero.x + pA.minus.x) / (H_ACCELERATION * H_ACCELERATION),
      y: (pA.plus.y - 2 * pA.zero.y + pA.minus.y) / (H_ACCELERATION * H_ACCELERATION),
    };

    const vel = solveVelocity(system, qZero, new Float64Array([1]));
    expect(vel.status).toBe("ok");
    const acc = solveAcceleration(system, qZero, vel.values, new Float64Array([0]));
    expect(acc.status).toBe("ok");

    const pk = pointKinematics(system, qZero, vel.values, acc.values, crankIndex, local);

    expect(Math.abs(pk.velocity.x - velocityFd.x)).toBeLessThanOrEqual(
      1e-6 * Math.max(1, Math.abs(velocityFd.x)),
    );
    expect(Math.abs(pk.velocity.y - velocityFd.y)).toBeLessThanOrEqual(
      1e-6 * Math.max(1, Math.abs(velocityFd.y)),
    );
    expect(Math.abs(pk.acceleration.x - accelerationFd.x)).toBeLessThanOrEqual(
      1e-4 * Math.max(1, Math.abs(accelerationFd.x)),
    );
    expect(Math.abs(pk.acceleration.y - accelerationFd.y)).toBeLessThanOrEqual(
      1e-4 * Math.max(1, Math.abs(accelerationFd.y)),
    );
  });
});

describe("computeFrameKinematics", () => {
  it("returns an entry for every link (ground included) and every marker", () => {
    const system = compileSystem(fourBar.build());
    const state = referenceState(system);
    const vel = solveVelocity(system, state.q, new Float64Array([1]));
    expect(vel.status).toBe("ok");
    const acc = solveAcceleration(system, state.q, vel.values, new Float64Array([0]));
    expect(acc.status).toBe("ok");

    const frame = computeFrameKinematics(system, state.q, vel.values, acc.values);

    expect(frame.links.size).toBe(system.links.length);
    for (const slot of system.links) {
      expect(frame.links.has(slot.id)).toBe(true);
    }
    expect(frame.markers.size).toBe(system.markers.length);
    for (const marker of system.markers) {
      expect(frame.markers.has(marker.id)).toBe(true);
    }

    const groundSlot = system.links.find((l) => l.isGround);
    if (!groundSlot) throw new Error("expected a ground link");
    const groundKinematics = frame.links.get(groundSlot.id);
    if (!groundKinematics) throw new Error("expected ground link kinematics");

    expect(groundKinematics.pose).toEqual({
      x: groundSlot.reference.x,
      y: groundSlot.reference.y,
      angle: groundSlot.reference.angle,
    });
    expect(groundKinematics.velocity).toEqual({ x: 0, y: 0, omega: 0 });
    expect(groundKinematics.acceleration).toEqual({ x: 0, y: 0, alpha: 0 });
  });

  it("the fourBar coupler marker position equals localToWorld(markerLocal, couplerPose) within 1e-12", () => {
    const doc = fourBar.build();
    const system = compileSystem(doc);
    const marker = system.markers[0];
    if (!marker) throw new Error("expected a coupler marker");

    let state = referenceState(system);
    for (let deg = 10; deg <= 50; deg += 10) {
      const result = solvePosition(system, state, new Float64Array([(deg * Math.PI) / 180]));
      expect(result.status).toBe("ok");
      state = result.state;
    }

    const vel = solveVelocity(system, state.q, new Float64Array([1]));
    expect(vel.status).toBe("ok");
    const acc = solveAcceleration(system, state.q, vel.values, new Float64Array([0]));
    expect(acc.status).toBe("ok");

    const frame = computeFrameKinematics(system, state.q, vel.values, acc.values);
    const markerKinematics = frame.markers.get(marker.id);
    if (!markerKinematics) throw new Error("expected marker kinematics");

    const pose = linkPose(system, state.q, marker.linkIndex);
    const expected = localToWorld(
      { x: marker.local.x, y: marker.local.y },
      { x: pose.x, y: pose.y },
      pose.angle,
    );

    expect(Math.abs(markerKinematics.position.x - expected.x)).toBeLessThanOrEqual(1e-12);
    expect(Math.abs(markerKinematics.position.y - expected.y)).toBeLessThanOrEqual(1e-12);
  });
});
