import { describe, it, expect } from "vitest";
import { compileSystem, linkPose, type KinematicSystem } from "./system";
import { assemble, jointResiduals } from "./assembly";
import * as fourBar from "./__fixtures__/fourBar";
import * as misassembled from "./__fixtures__/misassembled";
import { rotate, add, distance, type Vec2 } from "../geom";

/** World position of `local` (a link-local point) at a solved `q`. */
function worldPoint(system: KinematicSystem, q: Float64Array, linkName: string, local: Vec2): Vec2 {
  const linkIndex = system.links.findIndex((l) => l.name === linkName);
  if (linkIndex < 0) throw new Error(`no such link "${linkName}"`);
  const pose = linkPose(system, q, linkIndex);
  return add({ x: pose.x, y: pose.y }, rotate(local, pose.angle));
}

describe("jointResiduals", () => {
  it("closed fourBar at q0: every joint residual < 1e-9", () => {
    const system = compileSystem(fourBar.build());
    const inputs = new Float64Array(system.motors.length);
    const residuals = jointResiduals(system, system.q0, inputs);
    expect(residuals).toHaveLength(4);
    for (const v of residuals) {
      expect(v.residual).toBeLessThan(1e-9);
    }
  });

  it("openFourBar at q0: joint 'B' has the largest residual", () => {
    const system = compileSystem(misassembled.openFourBar());
    const inputs = new Float64Array(system.motors.length);
    const residuals = jointResiduals(system, system.q0, inputs);
    expect(residuals[0].label).toBe("B");
    expect(residuals[0].residual).toBeGreaterThan(10);
  });
});

describe("assemble", () => {
  it("pulls openFourBar closed, honors the motor, keeps link lengths, never mutates the doc", () => {
    const doc = misassembled.openFourBar();
    const docSnapshot = JSON.stringify(doc);

    const system = compileSystem(doc);
    const result = assemble(system);

    expect(result.ok).toBe(true);
    expect(result.residualNorm).toBeLessThan(1e-9);
    expect(result.violations).toEqual([]);
    expect(Array.from(result.q).every((v) => Number.isFinite(v))).toBe(true);

    // The motor row is honored: with the default (zero) input, the crank
    // returns to exactly its authored reference angle.
    const crankIndex = system.links.findIndex((l) => l.name === "crank");
    const crankSlot = system.links[crankIndex];
    expect(Math.abs(result.q[crankSlot.offset + 2] - system.q0[crankSlot.offset + 2])).toBeLessThan(
      1e-9,
    );

    // Each link's own inter-site distance (its length) is invariant --
    // see misassembled.ts's derivation of each link's known local sites.
    const crankO2 = worldPoint(system, result.q, "crank", { x: 0, y: 0 });
    const crankA = worldPoint(system, result.q, "crank", { x: fourBar.dims.crankLength, y: 0 });
    expect(distance(crankO2, crankA)).toBeCloseTo(fourBar.dims.crankLength, 6);

    const couplerA = worldPoint(system, result.q, "coupler", { x: 0, y: 0 });
    const couplerB = worldPoint(system, result.q, "coupler", {
      x: fourBar.dims.couplerLength,
      y: 0,
    });
    expect(distance(couplerA, couplerB)).toBeCloseTo(fourBar.dims.couplerLength, 6);

    const rockerO4 = worldPoint(system, result.q, "rocker", { x: 0, y: 0 });
    const rockerB = worldPoint(system, result.q, "rocker", { x: fourBar.dims.rockerLength, y: 0 });
    expect(distance(rockerO4, rockerB)).toBeCloseTo(fourBar.dims.rockerLength, 6);

    // Joints actually closed: crank's A coincides with coupler's A, and
    // coupler's B coincides with rocker's B.
    expect(distance(crankA, couplerA)).toBeLessThan(1e-6);
    expect(distance(couplerB, rockerB)).toBeLessThan(1e-6);

    expect(JSON.stringify(doc)).toBe(docSnapshot);
  });

  it("impossibleFourBar: ok:false, finite q, named violations sorted descending", () => {
    const system = compileSystem(misassembled.impossibleFourBar());
    const result = assemble(system);

    expect(result.ok).toBe(false);
    expect(Array.from(result.q).every((v) => Number.isFinite(v))).toBe(true);
    expect(result.residualNorm).toBeGreaterThan(1e-3);
    expect(result.violations.length).toBeGreaterThan(0);

    for (let i = 1; i < result.violations.length; i++) {
      expect(result.violations[i - 1].residual).toBeGreaterThanOrEqual(
        result.violations[i].residual,
      );
    }
    for (const v of result.violations) {
      expect(["A", "B", "O2", "O4"]).toContain(v.label);
    }
    expect(result.violations.map((v) => v.label)).toContain("B");
  });

  it("unnamedImpossibleFourBar: violations report ids (name is empty)", () => {
    const doc = misassembled.unnamedImpossibleFourBar();
    const system = compileSystem(doc);
    const result = assemble(system);

    expect(result.ok).toBe(false);
    expect(result.violations.length).toBeGreaterThan(0);
    for (const v of result.violations) {
      expect(v.label).toBe(v.jointId);
      expect(v.label.length).toBeGreaterThan(0);
    }
  });

  it("groundPairViolation: reported and cannot be fixed", () => {
    const system = compileSystem(misassembled.groundPairViolation());
    const result = assemble(system);

    expect(result.ok).toBe(false);
    expect(result.violations).toHaveLength(1);
    expect(result.violations[0].label).toBe("bad");
    expect(result.violations[0].residual).toBeCloseTo(misassembled.groundPairDistance, 6);

    // Retrying cannot help: n === 0 (both links are ground), so there is
    // nothing for least squares to move.
    const retry = assemble(system, system.q0, new Float64Array(0), { maxIterations: 500 });
    expect(retry.ok).toBe(false);
    expect(retry.violations).toHaveLength(1);
  });
});
