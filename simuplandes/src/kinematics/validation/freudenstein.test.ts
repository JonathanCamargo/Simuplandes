/**
 * KIN-06 / Phase 3 success criterion 1: the solver's four-bar output angle
 * matches Freudenstein's closed form over a full 360-sample input sweep, on
 * the continuation-preserved branch (never "whichever root is closer").
 */
import { describe, it, expect } from "vitest";
import { compileSystem, linkPose } from "../system";
import { referenceState } from "../position";
import { advanceDrive } from "../singularity";
import * as fourBar from "../__fixtures__/fourBar";
import { freudensteinTheta4, freudensteinBranchOf } from "../__fixtures__/analytic";

function angleDiff(x: number, y: number): number {
  let diff = (x - y) % (2 * Math.PI);
  if (diff > Math.PI) diff -= 2 * Math.PI;
  if (diff < -Math.PI) diff += 2 * Math.PI;
  return Math.abs(diff);
}

describe("KIN-06: Freudenstein four-bar cross-check", () => {
  it("theta4/theta3 match the closed forms within 1e-6 rad over a full 360-sample turn", () => {
    const system = compileSystem(fourBar.build());
    const a = fourBar.dims.crankLength;
    const b = fourBar.dims.couplerLength;
    const c = fourBar.dims.rockerLength;
    const d = fourBar.dims.groundLength;

    const crankIndex = system.links.findIndex((l) => l.name === "crank");
    const rockerIndex = system.links.findIndex((l) => l.name === "rocker");
    const couplerIndex = system.links.findIndex((l) => l.name === "coupler");

    const theta2Ref = linkPose(system, system.q0, crankIndex).angle;
    const theta4Ref = linkPose(system, system.q0, rockerIndex).angle;
    // The branch is fixed ONCE from the reference pose and never re-chosen.
    const branch = freudensteinBranchOf(a, b, c, d, theta2Ref, theta4Ref);

    let state = referenceState(system);
    for (let deg = 1; deg <= 360; deg++) {
      const target = new Float64Array([(deg * Math.PI) / 180]);
      const result = advanceDrive(system, state, target);
      expect(result.status).toBe("ok");
      expect(result.residualNorm).toBeLessThan(1e-9);
      state = result.state;

      const theta2 = linkPose(system, state.q, crankIndex).angle;
      const theta4 = linkPose(system, state.q, rockerIndex).angle;
      const theta3 = linkPose(system, state.q, couplerIndex).angle;

      const expectedTheta4 = freudensteinTheta4(a, b, c, d, theta2, branch);
      expect(angleDiff(theta4, expectedTheta4)).toBeLessThanOrEqual(1e-6);

      const K1 = d / a;
      const K2 = d / c;
      const K3 = (a * a - b * b + c * c + d * d) / (2 * a * c);
      const freudensteinResidual =
        K1 * Math.cos(theta4) - K2 * Math.cos(theta2) + K3 - Math.cos(theta2 - theta4);
      expect(Math.abs(freudensteinResidual)).toBeLessThan(1e-9);

      // The coupler angle from the solved A/B sites, independent of the
      // solver's own theta3 bookkeeping.
      const crankPose = linkPose(system, state.q, crankIndex);
      const worldA = {
        x: crankPose.x + a * Math.cos(crankPose.angle),
        y: crankPose.y + a * Math.sin(crankPose.angle),
      };
      const rockerPose = linkPose(system, state.q, rockerIndex);
      const worldB = {
        x: rockerPose.x + c * Math.cos(rockerPose.angle),
        y: rockerPose.y + c * Math.sin(rockerPose.angle),
      };
      const expectedTheta3 = Math.atan2(worldB.y - worldA.y, worldB.x - worldA.x);
      expect(angleDiff(theta3, expectedTheta3)).toBeLessThanOrEqual(1e-6);
    }
  });
});
