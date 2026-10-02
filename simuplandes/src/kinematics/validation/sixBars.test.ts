/**
 * KIN-06: Watt II and Stephenson III six-bars, validated against an
 * independent circle-intersection (dyad) construction that shares NO code
 * with the solver.
 */
import { describe, it, expect } from "vitest";
import { compileSystem, linkPose, type KinematicSystem } from "../system";
import { referenceState } from "../position";
import { advanceDrive } from "../singularity";
import { analyzeMobility } from "../mobility";
import { solveDyadChain } from "../__fixtures__/dyads";
import { buildWattII, buildStephensonIII, type SixBarFixture } from "../__fixtures__/sixBars";
import { add, rotate, distance, type Vec2 } from "../../geom";
import type { RevoluteConstraint } from "../constraints";

const JOINT_NAMES = ["O2", "A", "B", "O4", "C", "D", "O6"];

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

function runSixBarCheck(fixture: SixBarFixture): void {
  const system = compileSystem(fixture.doc);

  const mobility = analyzeMobility(system);
  expect(mobility.gruebler).toBe(1);
  expect(mobility.rankDof).toBe(1);
  expect(mobility.redundantConstraints).toBe(0);

  let state = referenceState(system);
  for (let deg = 1; deg <= 360; deg++) {
    const target = new Float64Array([(deg * Math.PI) / 180]);
    const result = advanceDrive(system, state, target);
    expect(result.status).toBe("ok");
    expect(result.residualNorm).toBeLessThan(1e-9);
    state = result.state;

    const theta2 = linkPose(
      system,
      state.q,
      system.links.findIndex((l) => l.name === "crank"),
    ).angle;
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
}

describe("KIN-06: Watt II six-bar cross-check", () => {
  it("every joint matches the independent dyad construction within 1e-6 over a full turn", () => {
    runSixBarCheck(buildWattII());
  });
});

describe("KIN-06: Stephenson III six-bar cross-check", () => {
  it("every joint matches the independent dyad construction within 1e-6 over a full turn", () => {
    runSixBarCheck(buildStephensonIII());
  });
});
