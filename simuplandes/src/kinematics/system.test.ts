import { describe, it, expect } from "vitest";
import { compileSystem, linkPose } from "./system";
import { evalResidual } from "./constraints";
import { KinematicsError } from "./errors";
import * as fourBar from "./__fixtures__/fourBar";
import * as sliderCrank from "./__fixtures__/sliderCrank";
import * as invertedSliderCrank from "./__fixtures__/invertedSliderCrank";
import * as actuatorArm from "./__fixtures__/actuatorArm";
import type { MechanismDocument } from "../model";

const fixtures: { name: string; build: () => MechanismDocument }[] = [
  { name: "fourBar", build: fourBar.build },
  { name: "sliderCrank", build: sliderCrank.build },
  { name: "invertedSliderCrank", build: invertedSliderCrank.build },
  { name: "actuatorArm", build: actuatorArm.build },
];

describe.each(fixtures)("compileSystem($name)", ({ build }) => {
  it("n=9, jointRows=8, m=9, ground offset=-1, q0 equals authored poses, residual@q0 < 1e-9", () => {
    const doc = build();
    const system = compileSystem(doc);

    expect(system.n).toBe(9);
    expect(system.jointRows).toBe(8);
    expect(system.m).toBe(9);

    const groundSlot = system.links.find((l) => l.isGround);
    expect(groundSlot?.offset).toBe(-1);

    for (const link of doc.links) {
      if (link.isGround) continue;
      const idx = system.linkIndexById.get(link.id)!;
      const pose = linkPose(system, system.q0, idx);
      expect(pose.x).toBeCloseTo(link.pose.position[0], 9);
      expect(pose.y).toBeCloseTo(link.pose.position[1], 9);
      expect(pose.angle).toBeCloseTo(link.pose.angle, 9);
    }

    const inputs = new Float64Array(system.motors.length);
    const r = new Float64Array(system.m);
    evalResidual(system, system.q0, inputs, r, system.m);
    let normSq = 0;
    for (let i = 0; i < r.length; i++) normSq += r[i] * r[i];
    expect(Math.sqrt(normSq)).toBeLessThan(1e-9);
  });
});

describe("compileSystem — prismatic dThetaRef is read from the document, never assumed 0", () => {
  it("invertedSliderCrank's slot dThetaRef equals the authored 0.4 rad offset", () => {
    const system = compileSystem(invertedSliderCrank.build());
    const slot = system.constraints.find((c) => c.kind === "prismatic" && c.label === "slot");
    expect(slot).toBeDefined();
    if (slot?.kind === "prismatic") {
      expect(slot.dThetaRef).toBeCloseTo(invertedSliderCrank.dims.blockAngleOffset, 12);
    }
  });

  it("actuatorArm's stroke dThetaRef equals the authored 0.4 rad offset", () => {
    const system = compileSystem(actuatorArm.build());
    const slot = system.constraints.find((c) => c.kind === "prismatic" && c.label === "stroke");
    expect(slot).toBeDefined();
    if (slot?.kind === "prismatic") {
      expect(slot.dThetaRef).toBeCloseTo(actuatorArm.dims.rodAngleOffset, 12);
    }
  });
});

describe("compileSystem — invalid motor expression", () => {
  it("does not throw; records an issue and leaves the motor's drive null", () => {
    const doc = fourBar.build();
    const badDoc: MechanismDocument = {
      ...doc,
      motors: doc.motors.map((m) => ({
        ...m,
        drive: { mode: "expression" as const, expression: "sin(" },
      })),
    };

    let system: ReturnType<typeof compileSystem> | undefined;
    expect(() => {
      system = compileSystem(badDoc);
    }).not.toThrow();

    expect(system!.issues).toEqual([
      expect.objectContaining({ code: "invalid-expression", motorId: doc.motors[0].id }),
    ]);
    expect(system!.motors[0].drive).toBeNull();
  });
});

describe("compileSystem — linear motor requires a prismatic joint", () => {
  it("throws KinematicsError('unknown-joint') for a hand-built doc bypassing the schema", () => {
    const doc = fourBar.build();
    // Point the (rotary) motor's jointId at a revolute joint but claim kind "linear".
    const badDoc = {
      ...doc,
      motors: [{ ...doc.motors[0], kind: "linear" as const }],
    } as MechanismDocument;

    let caught: unknown;
    try {
      compileSystem(badDoc);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(KinematicsError);
    expect((caught as KinematicsError).code).toBe("unknown-joint");
  });
});

describe("compileSystem — unknown marker link", () => {
  it("throws KinematicsError('unknown-site') for a hand-built doc bypassing the schema", () => {
    const doc = fourBar.build();
    const badDoc = {
      ...doc,
      markers: [
        {
          id: "marker-bad",
          name: "bad",
          linkId: "does-not-exist",
          local: [0, 0] as [number, number],
        },
      ],
    } as MechanismDocument;

    let caught: unknown;
    try {
      compileSystem(badDoc);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(KinematicsError);
    expect((caught as KinematicsError).code).toBe("unknown-site");
  });
});

describe("compileSystem — unknown site", () => {
  it("throws KinematicsError('unknown-site') for a hand-built doc bypassing the schema", () => {
    const doc = fourBar.build();
    const badDoc = {
      ...doc,
      joints: [{ ...doc.joints[0], siteA: "does-not-exist" }, ...doc.joints.slice(1)],
    } as MechanismDocument;

    let caught: unknown;
    try {
      compileSystem(badDoc);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(KinematicsError);
    expect((caught as KinematicsError).code).toBe("unknown-site");
  });
});
