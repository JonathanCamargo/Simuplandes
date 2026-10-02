/**
 * KIN-06: slider-crank position and velocity match the closed form over a
 * full 360-sample input sweep.
 */
import { describe, it, expect } from "vitest";
import { compileSystem, linkPose } from "../system";
import { referenceState } from "../position";
import { advanceDrive } from "../singularity";
import { solveVelocity } from "../velocity";
import * as sliderCrank from "../__fixtures__/sliderCrank";
import { sliderCrankPosition, sliderCrankVelocity } from "../__fixtures__/analytic";

describe("KIN-06: slider-crank cross-check", () => {
  it("slider pin x/y and velocity match the closed form within 1e-6 over a full 360-sample turn", () => {
    const system = compileSystem(sliderCrank.build());
    const { crankLength: r, couplerLength: l, offset: e } = sliderCrank.dims;

    const crankIndex = system.links.findIndex((l2) => l2.name === "crank");
    const sliderIndex = system.links.findIndex((l2) => l2.name === "slider");

    let state = referenceState(system);
    for (let deg = 1; deg <= 360; deg++) {
      const target = new Float64Array([(deg * Math.PI) / 180]);
      const result = advanceDrive(system, state, target);
      expect(result.status).toBe("ok");
      expect(result.residualNorm).toBeLessThan(1e-9);
      state = result.state;

      const theta2 = linkPose(system, state.q, crankIndex).angle;
      const sliderPose = linkPose(system, state.q, sliderIndex);

      const expectedX = sliderCrankPosition(r, l, e, theta2);
      expect(Math.abs(sliderPose.x - expectedX)).toBeLessThanOrEqual(1e-6);
      expect(Math.abs(sliderPose.y - e)).toBeLessThanOrEqual(1e-9);

      const velocity = solveVelocity(system, state.q, new Float64Array([1]));
      expect(velocity.status).toBe("ok");
      const sliderSlot = system.links[sliderIndex];
      const vx = velocity.values[sliderSlot.offset];
      const expectedVx = sliderCrankVelocity(r, l, e, theta2, 1);
      const tol = 1e-6 * Math.max(1, Math.abs(expectedVx));
      expect(Math.abs(vx - expectedVx)).toBeLessThanOrEqual(tol);
    }
  });
});
