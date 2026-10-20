import { describe, it, expect } from "vitest";
import { compileSystem } from "../kinematics";
import { build as buildSliderCrank } from "../kinematics/__fixtures__/sliderCrank";
import { build as buildFourBar } from "../kinematics/__fixtures__/fourBar";
import { evalCoordinate, jointCoordinateOf } from "./coordinates";

function perturbed(q0: Float64Array, seed: number): Float64Array {
  const q = Float64Array.from(q0);
  for (let i = 0; i < q.length; i++) q[i] += 0.3 * Math.sin(seed * 7.1 + i * 1.3);
  return q;
}

function expectGradientMatchesFiniteDifference(
  kin: ReturnType<typeof compileSystem>,
  coord: ReturnType<typeof jointCoordinateOf>,
  q: Float64Array,
): void {
  const grad = new Float64Array(kin.n);
  evalCoordinate(kin, q, coord, grad);
  const h = 1e-6;
  for (let i = 0; i < kin.n; i++) {
    const qp = Float64Array.from(q);
    const qm = Float64Array.from(q);
    qp[i] += h;
    qm[i] -= h;
    const fd =
      (evalCoordinate(kin, qp, coord, null) - evalCoordinate(kin, qm, coord, null)) / (2 * h);
    expect(grad[i]).toBeCloseTo(fd, 6);
  }
}

describe("joint coordinates", () => {
  it("are zero at the reference pose", () => {
    for (const doc of [buildFourBar(), buildSliderCrank()]) {
      const kin = compileSystem(doc);
      for (const joint of doc.joints) {
        const coord = jointCoordinateOf(kin, joint);
        expect(evalCoordinate(kin, kin.q0, coord, null)).toBeCloseTo(0, 12);
      }
    }
  });

  it("measure a revolute joint's relative rotation", () => {
    const doc = buildFourBar();
    const kin = compileSystem(doc);
    const coord = jointCoordinateOf(kin, doc.joints[0]);
    expect(coord.kind).toBe("angle");
    const q = Float64Array.from(kin.q0);
    q[2] += 0.25; // the crank's angle; joint O2 is ground -> crank
    expect(evalCoordinate(kin, q, coord, null)).toBeCloseTo(0.25, 12);
  });

  it("measure a prismatic joint's slide along its axis", () => {
    const doc = buildSliderCrank();
    const kin = compileSystem(doc);
    const rail = doc.joints.find((joint) => joint.type === "P")!;
    const coord = jointCoordinateOf(kin, rail);
    expect(coord.kind).toBe("slide");
    const slider = kin.links[kin.linkIndexById.get(doc.links[3].id)!];
    const q = Float64Array.from(kin.q0);
    q[slider.offset] += 7;
    q[slider.offset + 1] += 3; // off-axis motion does not count
    expect(evalCoordinate(kin, q, coord, null)).toBeCloseTo(7, 12);
  });

  it("have analytic gradients that match finite differences", () => {
    for (const doc of [buildFourBar(), buildSliderCrank()]) {
      const kin = compileSystem(doc);
      for (const joint of doc.joints) {
        const coord = jointCoordinateOf(kin, joint);
        for (const seed of [1, 2, 3]) {
          expectGradientMatchesFiniteDifference(kin, coord, perturbed(kin.q0, seed));
        }
      }
    }
  });

  it("handle a prismatic joint whose owner link moves", () => {
    const doc = buildSliderCrank();
    const kin = compileSystem(doc);
    const rail = doc.joints.find((joint) => joint.type === "P")!;
    // Swap the sides so the moving slider owns the axis.
    const swapped = jointCoordinateOf(kin, { ...rail, siteA: rail.siteB, siteB: rail.siteA });
    expectGradientMatchesFiniteDifference(kin, swapped, perturbed(kin.q0, 4));
  });
});
