import { describe, it, expect } from "vitest";
import { computeDofReport, classifyDof } from "./dof";
import * as fourBarFixture from "../kinematics/__fixtures__/fourBar";
import * as doubleParallelogramFixture from "../kinematics/__fixtures__/doubleParallelogram";
import { defineLink, makeDocument } from "../kinematics/__fixtures__/build";
import { poseFromWorldPoints, createId, type MechanismDocument } from "../model";

describe("classifyDof", () => {
  it("structure: rankDof 0 regardless of gruebler", () => {
    expect(classifyDof(1, 0)).toBe("structure");
    expect(classifyDof(0, 0)).toBe("structure");
  });

  it("ok: rankDof === gruebler === 1", () => {
    expect(classifyDof(1, 1)).toBe("ok");
  });

  it("multi-dof: rankDof === gruebler > 1", () => {
    expect(classifyDof(3, 3)).toBe("multi-dof");
  });

  it("redundant-mobile: rankDof > gruebler, gruebler <= 0", () => {
    expect(classifyDof(0, 1)).toBe("redundant-mobile");
  });

  it("singular: rankDof > gruebler, gruebler >= 1 (a pose-local rank drop, e.g. a collinear four-bar at a fold)", () => {
    // Documented per the plan's own escape hatch: a naturally-authored
    // collinear four-bar fixture did not reliably reproduce a numerical
    // rank of 2 (floating point noise near the fold sometimes reports
    // rank 1 like a regular pose), so the classifier is exercised directly
    // with the numbers this pose-effect case is defined by.
    expect(classifyDof(1, 2)).toBe("singular");
  });

  it("fallback: rankDof < gruebler also singular", () => {
    expect(classifyDof(3, 1)).toBe("singular");
  });
});

describe("computeDofReport: fourBar", () => {
  it("kind ok, severity ok, gruebler 1, rankDof 1, motorNoteKey null with its motor", () => {
    const report = computeDofReport(fourBarFixture.build());
    expect(report.kind).toBe("ok");
    expect(report.severity).toBe("ok");
    expect(report.gruebler).toBe(1);
    expect(report.rankDof).toBe(1);
    expect(report.linkCount).toBe(4);
    expect(report.jointCount).toBe(4);
    expect(report.explanationKey).toBe("sim.dof.explain.ok");
    expect(report.motorNoteKey).toBeNull();
  });

  it("motorNoteKey sim.dof.motors.none once its motor is removed", () => {
    const doc = fourBarFixture.build();
    const report = computeDofReport({ ...doc, motors: [] });
    expect(report.kind).toBe("ok");
    expect(report.motorNoteKey).toBe("sim.dof.motors.none");
  });

  it("motorNoteKey sim.dof.motors.many with 2 motors, values.motorCount === 2", () => {
    const doc = fourBarFixture.build();
    const jointA = doc.joints.find((j) => j.name === "A")!;
    const twoMotorDoc: MechanismDocument = {
      ...doc,
      motors: [
        ...doc.motors,
        {
          id: createId("motor"),
          name: "second-motor",
          jointId: jointA.id,
          kind: "rotary",
          drive: { mode: "constant", speed: 1 },
        },
      ],
    };
    const report = computeDofReport(twoMotorDoc);
    expect(report.motorNoteKey).toBe("sim.dof.motors.many");
    expect(report.values.motorCount).toBe(2);
  });

  it("never mutates doc", () => {
    const doc = fourBarFixture.build();
    const before = structuredClone(doc);
    computeDofReport(doc);
    expect(doc).toEqual(before);
  });
});

describe("computeDofReport: fourBar with a redundant bar pinned A-O4", () => {
  it("gruebler 0, rankDof 0, kind structure, severity error", () => {
    const { O2, O4, A, B } = fourBarFixture.dims;

    const ground = defineLink({
      name: "ground",
      isGround: true,
      origin: [O2.x, O2.y],
      sites: { O2: [O2.x, O2.y], O4: [O4.x, O4.y] },
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
    const extraPose = poseFromWorldPoints(A, O4);
    const extra = defineLink({
      name: "extra",
      origin: extraPose.position,
      angle: extraPose.angle,
      sites: { A: [A.x, A.y], O4: [O4.x, O4.y] },
    });

    const jointO2Id = createId("joint");
    const doc = makeDocument({
      schemaVersion: 1,
      name: "four-bar-redundant-bar",
      links: [ground.link, crank.link, coupler.link, rocker.link, extra.link],
      joints: [
        { id: jointO2Id, name: "O2", type: "R", siteA: ground.siteIds.O2, siteB: crank.siteIds.O2 },
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
          siteB: ground.siteIds.O4,
        },
        {
          id: createId("joint"),
          name: "extra-A",
          type: "R",
          siteA: extra.siteIds.A,
          siteB: crank.siteIds.A,
        },
        {
          id: createId("joint"),
          name: "extra-O4",
          type: "R",
          siteA: extra.siteIds.O4,
          siteB: ground.siteIds.O4,
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

    const report = computeDofReport(doc);
    expect(report.gruebler).toBe(0);
    expect(report.rankDof).toBe(0);
    expect(report.kind).toBe("structure");
    expect(report.severity).toBe("error");
  });
});

describe("computeDofReport: doubleParallelogram", () => {
  it("gruebler 0, rankDof 1, kind redundant-mobile, severity warn, count 1, rank 1", () => {
    const report = computeDofReport(doubleParallelogramFixture.build());
    expect(report.gruebler).toBe(0);
    expect(report.rankDof).toBe(1);
    expect(report.redundantConstraints).toBe(1);
    expect(report.kind).toBe("redundant-mobile");
    expect(report.severity).toBe("warn");
    expect(report.explanationKey).toBe("sim.dof.explain.redundantMobile");
    expect(report.values.count).toBe(1);
    expect(report.values.rank).toBe(1);
  });
});

describe("computeDofReport: fourBar with joint B removed", () => {
  it("rankDof >= 2 and rankDof === gruebler, so kind multi-dof, severity warn", () => {
    const doc = fourBarFixture.build();
    const withoutB: MechanismDocument = {
      ...doc,
      joints: doc.joints.filter((j) => j.name !== "B"),
    };
    const report = computeDofReport(withoutB);
    expect(report.rankDof).not.toBeNull();
    expect(report.rankDof).toBeGreaterThanOrEqual(2);
    expect(report.rankDof).toBe(report.gruebler);
    expect(report.kind).toBe("multi-dof");
    expect(report.severity).toBe("warn");
  });
});

describe("computeDofReport: no moving links", () => {
  it("kind empty, severity neutral, gruebler null, headlineKey sim.dof.badgeEmpty", () => {
    const ground = defineLink({ name: "ground", isGround: true, origin: [0, 0], sites: {} });
    const doc = makeDocument({
      schemaVersion: 1,
      name: "empty",
      links: [ground.link],
      joints: [],
      motors: [],
      markers: [],
    });
    const report = computeDofReport(doc);
    expect(report.kind).toBe("empty");
    expect(report.severity).toBe("neutral");
    expect(report.gruebler).toBeNull();
    expect(report.headlineKey).toBe("sim.dof.badgeEmpty");
  });
});

describe("computeDofReport: uncompilable document", () => {
  it("kind invalid, severity error, does not throw", () => {
    const doc = fourBarFixture.build();
    const broken = {
      ...doc,
      joints: [
        {
          id: "broken-joint",
          name: "broken",
          type: "R" as const,
          siteA: "missing-a",
          siteB: "missing-b",
        },
      ],
    } as unknown as MechanismDocument;

    expect(() => computeDofReport(broken)).not.toThrow();
    const report = computeDofReport(broken);
    expect(report.kind).toBe("invalid");
    expect(report.severity).toBe("error");
  });
});
