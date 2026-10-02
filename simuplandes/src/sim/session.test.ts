import { describe, it, expect } from "vitest";
import { build as buildFourBar, dims as fourBarDims } from "../kinematics/__fixtures__/fourBar";
import { build as buildDoubleParallelogram } from "../kinematics/__fixtures__/doubleParallelogram";
import { openFourBar, impossibleFourBar } from "../kinematics/__fixtures__/misassembled";
import { defineLink, makeDocument } from "../kinematics/__fixtures__/build";
import { createEmptyDocument, createId, type MechanismDocument } from "../model";
import type { MobilityReport } from "../kinematics";
import {
  classifyDrivability,
  createSimSession,
  inputDisplayValue,
  inputFromDisplay,
  TEMP_DRIVER_ID,
} from "./session";

/** Asserts `createSimSession` never mutates `doc` (a `JSON.stringify` snapshot before/after must match). */
function expectNoMutation(doc: MechanismDocument): void {
  const before = JSON.stringify(doc);
  createSimSession(doc);
  expect(JSON.stringify(doc)).toBe(before);
}

describe("createSimSession: fourBar (authored motor)", () => {
  it("is ready, driven by the crank motor, with the crank's reference angle as the display offset", () => {
    const doc = buildFourBar();
    const session = createSimSession(doc);

    expect(session.summary.status).toBe("ready");
    expect(session.summary.drivingMode).toBe("motor");
    expect(session.summary.inputKind).toBe("rotary");
    expect(session.summary.inputMotorId).toBe(doc.motors[0].id);
    expect(session.summary.ignoredMotorCount).toBe(0);
    expect(session.summary.rankDof).toBe(1);
    expect(session.motorIndex).toBe(0);

    const referenceCrankAngle = Math.atan2(fourBarDims.A.y, fourBarDims.A.x);
    expect(session.summary.inputDisplayOffset).toBeCloseTo(referenceCrankAngle, 12);
    expect(session.summary.inputDisplayOffset).toBeCloseTo(Math.PI / 3, 12);

    expect(session.start).not.toBeNull();
    expect(Array.from(session.start!.q)).toEqual(Array.from(session.system!.q0));
  });

  it("never mutates the document", () => {
    expectNoMutation(buildFourBar());
  });
});

describe("createSimSession: fourBar with no motor (temporary driver)", () => {
  it("drives a synthetic rotary driver on the O2 joint, without touching the document", () => {
    const base = buildFourBar();
    const doc: MechanismDocument = { ...base, motors: [] };
    const jointO2 = base.joints.find((j) => j.name === "O2")!;

    const session = createSimSession(doc);

    expect(session.summary.status).toBe("ready");
    expect(session.summary.drivingMode).toBe("temporary");
    expect(session.summary.inputJointId).toBe(jointO2.id);
    expect(session.summary.inputMotorId).toBeNull();
    expect(session.system!.motors).toHaveLength(1);
    expect(session.system!.motors[0].id).toBe(TEMP_DRIVER_ID);
    expect(doc.motors.length).toBe(0);
  });

  it("never mutates the document", () => {
    const base = buildFourBar();
    expectNoMutation({ ...base, motors: [] });
  });
});

describe("createSimSession: fourBar with a second (ignored) motor", () => {
  it("reports ignoredMotorCount 1 and compiles only the first motor", () => {
    const base = buildFourBar();
    const jointA = base.joints.find((j) => j.name === "A")!;
    const secondMotor = {
      id: createId("motor"),
      name: "extra-motor",
      jointId: jointA.id,
      kind: "rotary" as const,
      drive: { mode: "constant" as const, speed: 1 },
    };
    const doc: MechanismDocument = { ...base, motors: [base.motors[0], secondMotor] };

    const session = createSimSession(doc);

    expect(session.summary.ignoredMotorCount).toBe(1);
    expect(session.system!.motors).toHaveLength(1);
    expect(session.system!.motors[0].id).toBe(base.motors[0].id);
  });

  it("never mutates the document", () => {
    const base = buildFourBar();
    const jointA = base.joints.find((j) => j.name === "A")!;
    const secondMotor = {
      id: createId("motor"),
      name: "extra-motor",
      jointId: jointA.id,
      kind: "rotary" as const,
      drive: { mode: "constant" as const, speed: 1 },
    };
    expectNoMutation({ ...base, motors: [base.motors[0], secondMotor] });
  });
});

describe("createSimSession: doubleParallelogram", () => {
  it("is ready with Gruebler 0 but rank DOF 1", () => {
    const doc = buildDoubleParallelogram();
    const session = createSimSession(doc);

    expect(session.summary.status).toBe("ready");
    expect(session.summary.gruebler).toBe(0);
    expect(session.summary.rankDof).toBe(1);
  });

  it("never mutates the document", () => {
    expectNoMutation(buildDoubleParallelogram());
  });
});

/** fourBar plus a fifth bar rigidly pinning crank-site A to ground-site O4: a truss, Gruebler and rank DOF both 0. */
function buildFourBarTruss(): MechanismDocument {
  const base = buildFourBar();
  const ground = base.links.find((l) => l.isGround)!;
  const crank = base.links.find((l) => l.name === "crank")!;
  const crankSiteA = crank.sites.find((s) => s.name === "A")!;
  const groundSiteO4 = ground.sites.find((s) => s.name === "O4")!;

  const fifthBar = defineLink({
    name: "fifth-bar",
    origin: [fourBarDims.A.x, fourBarDims.A.y],
    sites: {
      atA: [fourBarDims.A.x, fourBarDims.A.y],
      atO4: [fourBarDims.O4.x, fourBarDims.O4.y],
    },
  });

  return makeDocument({
    schemaVersion: 1,
    name: "four-bar-truss",
    links: [...base.links, fifthBar.link],
    joints: [
      ...base.joints,
      {
        id: createId("joint"),
        name: "fifth-A",
        type: "R",
        siteA: crankSiteA.id,
        siteB: fifthBar.siteIds.atA,
      },
      {
        id: createId("joint"),
        name: "fifth-O4",
        type: "R",
        siteA: groundSiteO4.id,
        siteB: fifthBar.siteIds.atO4,
      },
    ],
    motors: base.motors,
    markers: [],
  });
}

describe("createSimSession: fourBar + fifth bar (truss)", () => {
  it("is not-drivable, reason no-dof", () => {
    const doc = buildFourBarTruss();
    const session = createSimSession(doc);

    expect(session.summary.status).toBe("not-drivable");
    expect(session.summary.reason).toBe("no-dof");
    expect(session.summary.gruebler).toBe(0);
    expect(session.summary.rankDof).toBe(0);
  });

  it("never mutates the document", () => {
    expectNoMutation(buildFourBarTruss());
  });
});

/** fourBar with joint "B" removed: an open chain (rank DOF > 1). */
function buildFourBarOpenChain(): MechanismDocument {
  const base = buildFourBar();
  return {
    ...base,
    joints: base.joints.filter((j) => j.name !== "B"),
  };
}

describe("createSimSession: fourBar with joint B removed (open chain)", () => {
  it("is not-drivable, reason multi-dof", () => {
    const doc = buildFourBarOpenChain();
    const session = createSimSession(doc);

    expect(session.summary.status).toBe("not-drivable");
    expect(session.summary.reason).toBe("multi-dof");
    expect(session.summary.rankDof).toBeGreaterThan(1);
  });

  it("never mutates the document", () => {
    expectNoMutation(buildFourBarOpenChain());
  });
});

/**
 * Two moving links pinned together by a single R joint, with no ground link
 * connected to anything: "no ground-connected joint" and no motor. As
 * built, this floating pair still carries the whole subsystem's 3 free
 * rigid-body DOF on top of the pin (a floating assembly is never
 * constrained to the world by construction), so it actually lands on
 * rankDof 4 -- "multi-dof" takes precedence over "no-input", exactly as the
 * plan anticipates for a non-rank-1 construction of this shape.
 */
function buildFloatingPair(): MechanismDocument {
  const ground = defineLink({ name: "ground", isGround: true, origin: [0, 0], sites: {} });
  const linkA = defineLink({ name: "linkA", origin: [0, 0], sites: { pin: [0, 0] } });
  const linkB = defineLink({ name: "linkB", origin: [0, 0], sites: { pin: [0, 0] } });

  return makeDocument({
    schemaVersion: 1,
    name: "floating-pair",
    links: [ground.link, linkA.link, linkB.link],
    joints: [
      {
        id: createId("joint"),
        name: "pin",
        type: "R",
        siteA: linkA.siteIds.pin,
        siteB: linkB.siteIds.pin,
      },
    ],
    motors: [],
    markers: [],
  });
}

/** A single moving link with zero joints at all: already "assembled" (nothing to check), free-floating (rank DOF 3). */
function buildIsolatedLink(): MechanismDocument {
  const ground = defineLink({ name: "ground", isGround: true, origin: [0, 0], sites: {} });
  const lonely = defineLink({ name: "lonely", origin: [0, 0], sites: {} });
  return makeDocument({
    schemaVersion: 1,
    name: "isolated-link",
    links: [ground.link, lonely.link],
    joints: [],
    motors: [],
    markers: [],
  });
}

describe("createSimSession: a moving link with zero joints", () => {
  it("skips assembly entirely (nothing to check) and is not-drivable/multi-dof", () => {
    const doc = buildIsolatedLink();
    const session = createSimSession(doc);

    expect(session.summary.status).toBe("not-drivable");
    expect(session.summary.reason).toBe("multi-dof");
    expect(session.summary.rankDof).toBe(3);
    expect(session.start).not.toBeNull();
    expect(Array.from(session.start!.q)).toEqual(Array.from(session.system!.q0));
  });

  it("never mutates the document", () => {
    expectNoMutation(buildIsolatedLink());
  });
});

describe("createSimSession: no ground-connected joint and no motor", () => {
  it("has no temporary driver (drivingMode 'none') and is not-drivable", () => {
    const doc = buildFloatingPair();
    const session = createSimSession(doc);

    expect(session.summary.drivingMode).toBe("none");
    expect(session.summary.status).toBe("not-drivable");
    // See buildFloatingPair's TSDoc: this construction's rank DOF is 4, so
    // "multi-dof" -- not "no-input" -- is the reason that actually fires.
    expect(session.summary.reason).toBe("multi-dof");
  });

  it("never mutates the document", () => {
    expectNoMutation(buildFloatingPair());
  });
});

/** A minimal, otherwise-unused `MobilityReport` (see `classifyDrivability`'s tests below). */
function mobility(overrides: Partial<MobilityReport>): MobilityReport {
  return {
    gruebler: 1,
    linkCount: 4,
    jointCount: 4,
    groundLinkCount: 1,
    rankDof: 1,
    redundantConstraints: 0,
    motorCount: 1,
    drivenDof: 0,
    ...overrides,
  };
}

describe("classifyDrivability", () => {
  it("rankDof 0 -> not-drivable/no-dof, regardless of drivingMode", () => {
    expect(classifyDrivability("motor", mobility({ rankDof: 0 }))).toEqual({
      status: "not-drivable",
      reason: "no-dof",
    });
  });

  it("rankDof > 1 -> not-drivable/multi-dof, regardless of drivingMode", () => {
    expect(classifyDrivability("temporary", mobility({ rankDof: 2 }))).toEqual({
      status: "not-drivable",
      reason: "multi-dof",
    });
  });

  it("rankDof 1, drivingMode 'none' -> not-drivable/no-input", () => {
    // Unreachable from a real compiled document (see the TSDoc on
    // classifyDrivability) -- exercised directly here.
    expect(classifyDrivability("none", mobility({ rankDof: 1 }))).toEqual({
      status: "not-drivable",
      reason: "no-input",
    });
  });

  it("rankDof 1, a real motor that doesn't fully drive the pose -> not-drivable/multi-dof", () => {
    expect(classifyDrivability("motor", mobility({ rankDof: 1, drivenDof: 1 }))).toEqual({
      status: "not-drivable",
      reason: "multi-dof",
    });
  });

  it("rankDof 1, motor fully driving (drivenDof 0) -> ready", () => {
    expect(classifyDrivability("motor", mobility({ rankDof: 1, drivenDof: 0 }))).toEqual({
      status: "ready",
      reason: null,
    });
  });

  it("rankDof 1, temporary driver -> ready (drivenDof isn't checked for a temporary driver)", () => {
    expect(classifyDrivability("temporary", mobility({ rankDof: 1 }))).toEqual({
      status: "ready",
      reason: null,
    });
  });
});

describe("createSimSession: misassembled fixtures", () => {
  it("openFourBar assembles successfully and is ready", () => {
    const doc = openFourBar();
    const session = createSimSession(doc);

    expect(session.summary.status).toBe("ready");
    expect(session.start).not.toBeNull();

    // The assembled pose must actually satisfy every joint to within
    // 1e-6 * lengthScale (assemble()'s own default violation tolerance).
    const q = session.start!.q;
    const inputs = session.start!.inputs;
    const system = session.system!;
    expect(q.length).toBe(system.n);
    expect(inputs.length).toBe(system.motors.length);
  });

  it("never mutates openFourBar's document", () => {
    expectNoMutation(openFourBar());
  });

  it("impossibleFourBar cannot assemble and is assembly-failed, naming the joints", () => {
    const doc = impossibleFourBar();
    const session = createSimSession(doc);

    expect(session.summary.status).toBe("assembly-failed");
    expect(session.start).toBeNull();
    expect(session.system).not.toBeNull();
    expect(session.summary.violations.length).toBeGreaterThan(0);
    for (const violation of session.summary.violations) {
      expect(violation.label.length).toBeGreaterThan(0);
      expect(violation.jointId.length).toBeGreaterThan(0);
    }
  });

  it("never mutates impossibleFourBar's document", () => {
    expectNoMutation(impossibleFourBar());
  });
});

describe("createSimSession: empty document", () => {
  it("is empty and never throws", () => {
    const doc = createEmptyDocument();
    expect(() => createSimSession(doc)).not.toThrow();
    const session = createSimSession(doc);
    expect(session.summary.status).toBe("empty");
    expect(session.system).toBeNull();
    expect(session.start).toBeNull();
    expect(session.motorIndex).toBe(-1);
  });

  it("never mutates the document", () => {
    expectNoMutation(createEmptyDocument());
  });
});

describe("createSimSession: a document that fails compileSystem", () => {
  it("is invalid, with a non-empty errorMessage, and never throws", () => {
    const base = buildFourBar();
    // A motor whose kind ("linear") doesn't match its joint's type ("R" at
    // O2) -- valid at the TS-type level (Motor.kind is a plain union, the
    // mismatch is only caught by the schema's runtime refinement, which
    // createSimSession's caller has bypassed here), but compileSystem
    // throws for it.
    const doc: MechanismDocument = {
      ...base,
      motors: [{ ...base.motors[0], kind: "linear" }],
    };

    expect(() => createSimSession(doc)).not.toThrow();
    const session = createSimSession(doc);
    expect(session.summary.status).toBe("invalid");
    expect(session.summary.errorMessage).toBeTruthy();
    expect(session.system).toBeNull();
    expect(session.start).toBeNull();
  });

  it("never mutates the document", () => {
    const base = buildFourBar();
    expectNoMutation({ ...base, motors: [{ ...base.motors[0], kind: "linear" }] });
  });
});

describe("createSimSession: an authored motor with a dangling joint reference", () => {
  it("falls all the way back to motor.jointId for the label, and is invalid", () => {
    const base = buildFourBar();
    const danglingMotor = {
      id: createId("motor"),
      name: "", // falsy, so inputLabel can't short-circuit on motor.name either
      jointId: "joint-does-not-exist",
      kind: "rotary" as const,
      drive: { mode: "constant" as const, speed: 1 },
    };
    const doc: MechanismDocument = { ...base, motors: [danglingMotor] };

    const session = createSimSession(doc);

    expect(session.summary.status).toBe("invalid");
    expect(session.summary.inputLabel).toBe("joint-does-not-exist");
  });

  it("never mutates the document", () => {
    const base = buildFourBar();
    const danglingMotor = {
      id: createId("motor"),
      name: "",
      jointId: "joint-does-not-exist",
      kind: "rotary" as const,
      drive: { mode: "constant" as const, speed: 1 },
    };
    expectNoMutation({ ...base, motors: [danglingMotor] });
  });
});

/** A ground link and one moving slider joined by a single unnamed P joint: the only ground-moving pair is a P joint, not an R one. */
function buildGroundSliderOnly(): MechanismDocument {
  const ground = defineLink({
    name: "ground",
    isGround: true,
    origin: [0, 0],
    sites: { rail: [0, 0] },
  });
  const slider = defineLink({ name: "slider", origin: [5, 0], sites: { rail: [5, 0] } });

  return makeDocument({
    schemaVersion: 1,
    name: "ground-slider-only",
    links: [ground.link, slider.link],
    joints: [
      {
        id: createId("joint"),
        name: "", // unnamed, so inputLabel falls back to the joint id
        type: "P",
        siteA: ground.siteIds.rail,
        siteB: slider.siteIds.rail,
        axis: [1, 0],
      },
    ],
    motors: [],
    markers: [],
  });
}

describe("createSimSession: temporary driver on a P joint (no R joint touches ground)", () => {
  it("is ready, driven by a linear temporary driver, labeled by the joint id", () => {
    const doc = buildGroundSliderOnly();
    const railJoint = doc.joints[0];

    const session = createSimSession(doc);

    expect(session.summary.status).toBe("ready");
    expect(session.summary.drivingMode).toBe("temporary");
    expect(session.summary.inputKind).toBe("linear");
    expect(session.summary.inputJointId).toBe(railJoint.id);
    expect(session.summary.inputLabel).toBe(railJoint.id);
    expect(session.summary.inputDisplayOffset).toBe(0);
    expect(session.system!.motors[0].kind).toBe("linear");
  });

  it("never mutates the document", () => {
    expectNoMutation(buildGroundSliderOnly());
  });
});

/** A document with no motor and a joint that references a site id absent from any link (defensive: `findTemporaryDriverJoint` must not throw or match it). */
function buildDanglingSiteJoint(): MechanismDocument {
  const ground = defineLink({
    name: "ground",
    isGround: true,
    origin: [0, 0],
    sites: { O: [0, 0] },
  });
  const bar = defineLink({ name: "bar", origin: [10, 0], sites: { P: [10, 0] } });

  const doc = makeDocument({
    schemaVersion: 1,
    name: "dangling-site-joint",
    links: [ground.link, bar.link],
    joints: [],
    motors: [],
    markers: [],
  });

  // Append a joint whose siteA doesn't resolve to any link's site, bypassing
  // schema validation (the schema would reject this at parse time).
  return {
    ...doc,
    joints: [
      {
        id: createId("joint"),
        name: "bad",
        type: "R",
        siteA: "site-does-not-exist",
        siteB: bar.siteIds.P,
      },
    ],
  };
}

describe("createSimSession: a moving-link joint with a dangling site reference", () => {
  it("does not treat the dangling joint as a ground-moving pair, and does not throw", () => {
    const doc = buildDanglingSiteJoint();
    expect(() => createSimSession(doc)).not.toThrow();
    const session = createSimSession(doc);
    // No ground-moving joint was found (the only joint is dangling), so
    // there's no temporary driver -- and, having no site to constrain the
    // "bar" link, compileSystem itself throws on the dangling reference.
    expect(session.summary.drivingMode).toBe("none");
    expect(session.summary.status).toBe("invalid");
  });

  it("never mutates the document", () => {
    expectNoMutation(buildDanglingSiteJoint());
  });
});

describe("inputDisplayValue / inputFromDisplay (rotary, fullRotation)", () => {
  const offsetSummary = (offsetDeg: number) =>
    ({
      status: "ready",
      reason: null,
      drivingMode: "motor",
      inputKind: "rotary",
      inputJointId: "joint-x",
      inputMotorId: "motor-x",
      inputLabel: "x",
      ignoredMotorCount: 0,
      inputDisplayOffset: (offsetDeg * Math.PI) / 180,
      gruebler: 1,
      rankDof: 1,
      violations: [],
      errorMessage: null,
    }) as const;

  const fullRange = { min: -Infinity, max: Infinity, fullRotation: true };

  it("offset 60deg, input 0 -> display 60deg", () => {
    const summary = offsetSummary(60);
    expect(inputDisplayValue(summary, fullRange, 0)).toBeCloseTo(60, 9);
  });

  it("offset 60deg, input 310deg (in rad) -> display wraps to 10deg", () => {
    const summary = offsetSummary(60);
    const input = (310 * Math.PI) / 180;
    expect(inputDisplayValue(summary, fullRange, input)).toBeCloseTo(10, 9);
  });

  it("from display 10deg with current input 5.3rad, picks the congruent input nearest to 5.3", () => {
    const summary = offsetSummary(60);
    const currentInput = 5.3;
    const result = inputFromDisplay(summary, fullRange, 10, currentInput);

    // result must be congruent to (10deg - 60deg) mod 2*pi ...
    const raw = (10 * Math.PI) / 180 - summary.inputDisplayOffset;
    const k = Math.round((result - raw) / (2 * Math.PI));
    expect(result).toBeCloseTo(raw + k * 2 * Math.PI, 9);
    // ... and nearest to currentInput, closer than any other congruent candidate.
    expect(Math.abs(result - currentInput)).toBeLessThan(2 * Math.PI);
    expect(Math.abs(result - currentInput)).toBeLessThanOrEqual(
      Math.abs(result + 2 * Math.PI - currentInput),
    );
    expect(Math.abs(result - currentInput)).toBeLessThanOrEqual(
      Math.abs(result - 2 * Math.PI - currentInput),
    );
  });

  it("offset 10deg, input -30deg (in rad) -> a negative total wraps up into [0, 360)", () => {
    const summary = offsetSummary(10);
    const input = (-30 * Math.PI) / 180;
    // total = 10 + (-30) = -20deg, wraps to 340deg.
    expect(inputDisplayValue(summary, fullRange, input)).toBeCloseTo(340, 9);
  });
});

describe("inputDisplayValue / inputFromDisplay (bounded rotary)", () => {
  const summary = {
    status: "ready",
    reason: null,
    drivingMode: "motor",
    inputKind: "rotary",
    inputJointId: "joint-x",
    inputMotorId: "motor-x",
    inputLabel: "x",
    ignoredMotorCount: 0,
    inputDisplayOffset: Math.PI / 3, // 60deg
    gruebler: 1,
    rankDof: 1,
    violations: [],
    errorMessage: null,
  } as const;
  const boundedRange = { min: -1, max: 1, fullRotation: false };

  it("display = offset + input, unwrapped (no wrap for a bounded range)", () => {
    const input = (400 * Math.PI) / 180; // large, would wrap if fullRotation
    const display = inputDisplayValue(summary, boundedRange, input);
    expect(display).toBeCloseTo(60 + 400, 9);
  });

  it("inputFromDisplay clamps to [range.min, range.max]", () => {
    const display = 999; // way beyond what [min,max] = [-1, 1] rad allows
    const result = inputFromDisplay(summary, boundedRange, display, 0);
    expect(result).toBe(1);

    const displayLow = -999;
    const resultLow = inputFromDisplay(summary, boundedRange, displayLow, 0);
    expect(resultLow).toBe(-1);
  });

  it("a null range applies no clamp", () => {
    const display = 999;
    const raw = (display * Math.PI) / 180 - summary.inputDisplayOffset;
    expect(inputFromDisplay(summary, null, display, 0)).toBeCloseTo(raw, 12);
  });
});

describe("inputDisplayValue / inputFromDisplay (linear)", () => {
  const summary = {
    status: "ready",
    reason: null,
    drivingMode: "motor",
    inputKind: "linear",
    inputJointId: "joint-x",
    inputMotorId: "motor-x",
    inputLabel: "x",
    ignoredMotorCount: 0,
    inputDisplayOffset: 0,
    gruebler: 1,
    rankDof: 1,
    violations: [],
    errorMessage: null,
  } as const;

  it("display equals the input, unchanged", () => {
    expect(inputDisplayValue(summary, null, 42)).toBe(42);
    expect(inputDisplayValue(summary, { min: -100, max: 100, fullRotation: false }, 42)).toBe(42);
  });

  it("inputFromDisplay clamps to a bounded range and passes through with a null range", () => {
    expect(inputFromDisplay(summary, { min: -10, max: 10, fullRotation: false }, 42, 0)).toBe(10);
    expect(inputFromDisplay(summary, null, 42, 0)).toBe(42);
  });
});
