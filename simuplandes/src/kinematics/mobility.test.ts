import { describe, it, expect } from "vitest";
import { compileSystem } from "./system";
import { grueblerMobility, analyzeMobility } from "./mobility";
import { analyzeSingularity, advanceDrive } from "./singularity";
import { referenceState } from "./position";
import * as fourBar from "./__fixtures__/fourBar";
import * as sliderCrank from "./__fixtures__/sliderCrank";
import * as doubleParallelogram from "./__fixtures__/doubleParallelogram";
import { defineLink, makeDocument } from "./__fixtures__/build";
import { poseFromWorldPoints, createId } from "../model";

describe("grueblerMobility / analyzeMobility: fourBar", () => {
  it("gruebler 1, rankDof 1, redundantConstraints 0, drivenDof 0 with its motor; drivenDof 1 without", () => {
    const doc = fourBar.build();
    const system = compileSystem(doc);
    const report = analyzeMobility(system);

    expect(report.gruebler).toBe(1);
    expect(report.rankDof).toBe(1);
    expect(report.redundantConstraints).toBe(0);
    expect(report.motorCount).toBe(1);
    expect(report.drivenDof).toBe(0);

    const docNoMotor = { ...doc, motors: [] };
    const systemNoMotor = compileSystem(docNoMotor);
    const reportNoMotor = analyzeMobility(systemNoMotor);
    expect(reportNoMotor.motorCount).toBe(0);
    expect(reportNoMotor.drivenDof).toBe(1);
  });
});

describe("grueblerMobility / analyzeMobility: sliderCrank", () => {
  it("gruebler 1, rankDof 1", () => {
    const system = compileSystem(sliderCrank.build());
    const report = analyzeMobility(system);
    expect(report.gruebler).toBe(1);
    expect(report.rankDof).toBe(1);
  });
});

describe("grueblerMobility / analyzeMobility: doubleParallelogram", () => {
  it("gruebler 0, rankDof 1, redundantConstraints 1, drivenDof 0, and it sweeps 10 to 170 degrees", () => {
    const system = compileSystem(doubleParallelogram.build());
    const report = analyzeMobility(system);

    expect(report.gruebler).toBe(0);
    expect(report.rankDof).toBe(1);
    expect(report.redundantConstraints).toBe(1);
    expect(report.drivenDof).toBe(0);

    const refAngle = doubleParallelogram.dims.referenceAngle;
    const referenceSingularity = analyzeSingularity(system, system.q0);
    expect(referenceSingularity.nearSingular).toBe(false);

    // Down to 10 degrees, avoiding 0/180 (a genuine singularity there).
    let state = referenceState(system);
    for (let deg = 55; deg >= 10; deg -= 5) {
      const target = new Float64Array([(deg * Math.PI) / 180 - refAngle]);
      const result = advanceDrive(system, state, target);
      expect(result.status).toBe("ok");
      expect(result.residualNorm).toBeLessThan(1e-9);
      state = result.state;
    }

    // Up to 170 degrees, from a fresh reference state.
    state = referenceState(system);
    for (let deg = 65; deg <= 170; deg += 5) {
      const target = new Float64Array([(deg * Math.PI) / 180 - refAngle]);
      const result = advanceDrive(system, state, target);
      expect(result.status).toBe("ok");
      expect(result.residualNorm).toBeLessThan(1e-9);
      state = result.state;
    }
  });
});

describe("grueblerMobility: ground links merged into one frame", () => {
  it("a fourBar with its ground split into two ground links still gives gruebler 1", () => {
    const O2 = { x: 0, y: 0 };
    const O4 = { x: 100, y: 0 };
    const A = { x: 20, y: 20 * Math.sqrt(3) };
    const B = { x: 110, y: 80 };

    const ground1 = defineLink({
      name: "ground-1",
      isGround: true,
      origin: [O2.x, O2.y],
      sites: { O2: [O2.x, O2.y] },
    });
    const ground2 = defineLink({
      name: "ground-2",
      isGround: true,
      origin: [O4.x, O4.y],
      sites: { O4: [O4.x, O4.y] },
    });

    const crankPose = poseFromWorldPoints(O2, A);
    const crank = defineLink({
      name: "crank",
      origin: crankPose.position,
      angle: crankPose.angle,
      sites: { O2: [O2.x, O2.y], A: [A.x, A.y] },
    });

    const couplerPose = poseFromWorldPoints(A, B);
    const coupler = defineLink({
      name: "coupler",
      origin: couplerPose.position,
      angle: couplerPose.angle,
      sites: { A: [A.x, A.y], B: [B.x, B.y] },
    });

    const rockerPose = poseFromWorldPoints(O4, B);
    const rocker = defineLink({
      name: "rocker",
      origin: rockerPose.position,
      angle: rockerPose.angle,
      sites: { O4: [O4.x, O4.y], B: [B.x, B.y] },
    });

    const jointO2Id = createId("joint");
    const doc = makeDocument({
      schemaVersion: 1,
      name: "split-ground-four-bar",
      links: [ground1.link, ground2.link, crank.link, coupler.link, rocker.link],
      joints: [
        {
          id: jointO2Id,
          name: "O2",
          type: "R",
          siteA: ground1.siteIds.O2,
          siteB: crank.siteIds.O2,
        },
        {
          id: createId("joint"),
          name: "A",
          type: "R",
          siteA: crank.siteIds.A,
          siteB: coupler.siteIds.A,
        },
        {
          id: createId("joint"),
          name: "B",
          type: "R",
          siteA: coupler.siteIds.B,
          siteB: rocker.siteIds.B,
        },
        {
          id: createId("joint"),
          name: "O4",
          type: "R",
          siteA: rocker.siteIds.O4,
          siteB: ground2.siteIds.O4,
        },
      ],
      motors: [
        {
          id: createId("motor"),
          name: "crank-motor",
          jointId: jointO2Id,
          kind: "rotary",
          drive: { mode: "constant", speed: 1 },
        },
      ],
      markers: [],
    });

    const system = compileSystem(doc);
    const report = grueblerMobility(system);
    expect(report.groundLinkCount).toBe(2);
    expect(report.linkCount).toBe(4);
    expect(report.jointCount).toBe(4);
    expect(report.gruebler).toBe(1);
  });
});
