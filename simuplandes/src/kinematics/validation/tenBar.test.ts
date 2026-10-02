/**
 * The synthetic 10-bar (n = 27, m = 27): a full-turn sweep matches the
 * independent dyad construction within 1e-6, and every frame's
 * velocity/acceleration solve succeeds -- the fixture the benchmark
 * (`bench/tenBar.bench.ts`) also drives.
 */
import { describe, it, expect } from "vitest";
import { compileSystem, linkPose, type KinematicSystem } from "../system";
import { referenceState } from "../position";
import { advanceDrive } from "../singularity";
import { solveVelocityAcceleration } from "../velocity";
import { analyzeMobility } from "../mobility";
import { solveDyadChain } from "../__fixtures__/dyads";
import { build as buildTenBar } from "../__fixtures__/tenBar";
import { add, rotate, distance, type Vec2 } from "../../geom";
import type { RevoluteConstraint } from "../constraints";

const JOINT_NAMES = ["O2", "A", "B", "O4", "C", "D", "O6", "E", "F", "O8", "G", "H", "O10"];

function findRevolute(system: KinematicSystem, jointName: string): RevoluteConstraint {
  const c = system.constraints.find((c2) => c2.kind === "revolute" && c2.label === jointName);
  if (!c || c.kind !== "revolute") throw new Error(`no revolute joint named "${jointName}"`);
  return c;
}

function siteWorld(
  system: KinematicSystem,
  q: Float64Array,
  ref: { linkIndex: number; local: { x: number; y: number } },
): Vec2 {
  const pose = linkPose(system, q, ref.linkIndex);
  return add({ x: pose.x, y: pose.y }, rotate(ref.local, pose.angle));
}

describe("10-bar synthetic fixture", () => {
  const fixture = buildTenBar();
  const system = compileSystem(fixture.doc);

  it("compiles to n = 27, m = 27", () => {
    expect(system.n).toBe(27);
    expect(system.m).toBe(27);
  });

  it("analyzeMobility: gruebler 1, rankDof 1, drivenDof 0", () => {
    const report = analyzeMobility(system);
    expect(report.gruebler).toBe(1);
    expect(report.rankDof).toBe(1);
    expect(report.drivenDof).toBe(0);
  });

  it("a full 360-sample turn matches the dyad construction within 1e-6, every frame solves", () => {
    const crankIndex = system.links.findIndex((l) => l.name === "crank");

    let state = referenceState(system);
    for (let deg = 1; deg <= 360; deg++) {
      const target = new Float64Array([(deg * Math.PI) / 180]);
      const result = advanceDrive(system, state, target);
      expect(result.status).toBe("ok");
      expect(result.residualNorm).toBeLessThan(1e-9);
      state = result.state;

      const rates = solveVelocityAcceleration(
        system,
        state.q,
        new Float64Array([1]),
        new Float64Array([0]),
      );
      expect(rates.status).toBe("ok");

      const theta2 = linkPose(system, state.q, crankIndex).angle;
      const dyadPoints = solveDyadChain(fixture.spec, theta2);

      for (const jointName of JOINT_NAMES) {
        const joint = findRevolute(system, jointName);
        const worldA = siteWorld(system, state.q, joint.a);
        const worldB = siteWorld(system, state.q, joint.b);
        expect(distance(worldA, worldB)).toBeLessThan(1e-9);

        const pointName = fixture.jointPoint.get(jointName);
        if (!pointName) throw new Error(`no jointPoint mapping for "${jointName}"`);
        const expected = dyadPoints.get(pointName);
        if (!expected) throw new Error(`solveDyadChain has no point "${pointName}"`);
        expect(distance(worldA, expected)).toBeLessThan(1e-6);
      }
    }
  });
});
