import { describe, it, expect } from "vitest";
import {
  GtmFixtureSchema,
  parseGtmFixture,
  validateGtmFixture,
  gtmToDocument,
  thetaRefOf,
  sizeOf,
  fixtureHash,
  type GtmFixture,
} from "./fixture";
import { compileSystem, evalResidual, referenceState } from "../../src/kinematics";
import { vec2, add, sub, rotate, direction, distance, fromPolar, normalize } from "../../src/geom";

const O2 = vec2(0, 0);
const O4 = vec2(100, 0);
const CRANK_LENGTH = 40;
const REFERENCE_ANGLE = Math.PI / 3;
const A = add(O2, fromPolar(CRANK_LENGTH, REFERENCE_ANGLE));
const B = vec2(110, 80);
const COUPLER_LENGTH = distance(A, B);

// --- Slider-crank-shaped fixture (prismatic edge owned by GROUND, node 0) ---
const SC_CRANK_LENGTH = 40;
const SC_COUPLER_LENGTH = 120;
const SC_OFFSET = 10;
const SC_REF_ANGLE = Math.PI / 6;
const scA = vec2(
  SC_CRANK_LENGTH * Math.cos(SC_REF_ANGLE),
  SC_CRANK_LENGTH * Math.sin(SC_REF_ANGLE),
);
const scSlide =
  SC_CRANK_LENGTH * Math.cos(SC_REF_ANGLE) +
  Math.sqrt(SC_COUPLER_LENGTH * SC_COUPLER_LENGTH - Math.pow(scA.y - SC_OFFSET, 2));
const scP = vec2(scSlide, SC_OFFSET);

/** A slider-crank-shaped `.gtm.json`: ground (0) owns the prismatic edge to the slider (3). */
function sliderCrankShapedFixture(): GtmFixture {
  return GtmFixtureSchema.parse({
    format: "simuplandes-parity-fixture",
    version: 0,
    name: "test-slider-crank",
    graph: {
      nodes: [
        { id: 0, link_type: "ground" },
        { id: 1, link_type: "binary" },
        { id: 2, link_type: "binary" },
        { id: 3, link_type: "binary" },
      ],
      edges: [
        { source: 0, target: 1, pos: [O2.x, O2.y], input: true },
        { source: 1, target: 2, pos: [scA.x, scA.y] },
        { source: 2, target: 3, pos: [scP.x, scP.y] },
        { source: 0, target: 3, pos: [scP.x, scP.y], type: "prismatic", axis: [1, 0] },
      ],
    },
    markers: [],
  });
}

// --- Inverted-slider-crank-shaped fixture (prismatic edge owned by a ROTATED
// moving link, the rocker, node 2 -- exercises axis rotation into a
// non-zero-angle link-local frame). ---
const iscO2 = vec2(0, 0);
const iscO4 = vec2(0, -100);
const iscCrankLength = 40;
const iscRefAngle = Math.PI / 6;
const iscA = vec2(iscCrankLength * Math.cos(iscRefAngle), iscCrankLength * Math.sin(iscRefAngle));
const iscAxis = normalize(sub(iscA, iscO4));
const iscRockerAngle = direction(sub(iscA, iscO4));

function invertedSliderCrankShapedFixture(): GtmFixture {
  return GtmFixtureSchema.parse({
    format: "simuplandes-parity-fixture",
    version: 0,
    name: "test-inverted-slider-crank",
    graph: {
      nodes: [
        { id: 0, link_type: "ground" },
        { id: 1, link_type: "binary" },
        { id: 2, link_type: "binary" },
        { id: 3, link_type: "binary" },
      ],
      edges: [
        { source: 0, target: 1, pos: [iscO2.x, iscO2.y], input: true },
        { source: 0, target: 2, pos: [iscO4.x, iscO4.y] },
        { source: 1, target: 3, pos: [iscA.x, iscA.y] },
        {
          source: 2,
          target: 3,
          pos: [iscA.x, iscA.y],
          type: "prismatic",
          axis: [iscAxis.x, iscAxis.y],
        },
      ],
    },
    markers: [],
  });
}

function fourBarFixture(name = "test-four-bar"): GtmFixture {
  const couplerAngle = direction(sub(B, A));
  const markerLocal = vec2(COUPLER_LENGTH / 2, 30);
  const markerWorld = add(A, rotate(markerLocal, couplerAngle));

  return GtmFixtureSchema.parse({
    format: "simuplandes-parity-fixture",
    version: 0,
    name,
    graph: {
      nodes: [
        { id: 0, link_type: "ground" },
        { id: 1, link_type: "binary" },
        { id: 2, link_type: "binary" },
        { id: 3, link_type: "binary" },
      ],
      edges: [
        { source: 0, target: 1, pos: [O2.x, O2.y], input: true },
        { source: 1, target: 2, pos: [A.x, A.y] },
        { source: 2, target: 3, pos: [B.x, B.y] },
        { source: 3, target: 0, pos: [O4.x, O4.y] },
      ],
    },
    markers: [{ link: 2, pos: [markerWorld.x, markerWorld.y] }],
  });
}

describe("parseGtmFixture", () => {
  it("accepts a valid fixture", () => {
    const fx = parseGtmFixture(JSON.stringify(fourBarFixture()));
    expect(fx.name).toBe("test-four-bar");
    expect(fx.graph.edges).toHaveLength(4);
  });

  it("rejects an edge missing pos", () => {
    const raw = JSON.parse(JSON.stringify(fourBarFixture())) as {
      graph: { edges: { pos?: unknown }[] };
    };
    delete raw.graph.edges[0].pos;
    expect(() => parseGtmFixture(JSON.stringify(raw))).toThrow();
  });

  it("rejects zero input edges", () => {
    const raw = JSON.parse(JSON.stringify(fourBarFixture())) as {
      graph: { edges: { input?: boolean }[] };
    };
    delete raw.graph.edges[0].input;
    expect(() => parseGtmFixture(JSON.stringify(raw))).toThrow(/exactly one input edge/);
  });

  it("rejects two input edges", () => {
    const raw = JSON.parse(JSON.stringify(fourBarFixture())) as {
      graph: { edges: { input?: boolean }[] };
    };
    raw.graph.edges[1].input = true;
    expect(() => parseGtmFixture(JSON.stringify(raw))).toThrow(/exactly one input edge/);
  });

  it("rejects an input edge that does not touch node 0", () => {
    const raw = JSON.parse(JSON.stringify(fourBarFixture())) as {
      graph: { edges: { input?: boolean }[] };
    };
    delete raw.graph.edges[0].input;
    raw.graph.edges[1].input = true;
    expect(() => parseGtmFixture(JSON.stringify(raw))).toThrow(/must touch ground/);
  });

  it("rejects a duplicate edge", () => {
    const raw = JSON.parse(JSON.stringify(fourBarFixture())) as {
      graph: { edges: { source: number; target: number; pos: [number, number] }[] };
    };
    raw.graph.edges.push({ source: 1, target: 0, pos: [0, 0] });
    expect(() => parseGtmFixture(JSON.stringify(raw))).toThrow(/duplicate edge/);
  });

  it("rejects a marker referencing an unknown link", () => {
    const raw = JSON.parse(JSON.stringify(fourBarFixture())) as {
      markers: { link: number }[];
    };
    raw.markers[0].link = 99;
    expect(() => parseGtmFixture(JSON.stringify(raw))).toThrow(/unknown link/);
  });
});

describe("validateGtmFixture", () => {
  it("reports no issues for a well-formed four-bar", () => {
    const fx = fourBarFixture();
    expect(validateGtmFixture(fx)).toEqual([]);
  });

  it("reports a Gruebler issue when F != 1", () => {
    const fx = fourBarFixture();
    const withExtraEdge: GtmFixture = {
      ...fx,
      graph: {
        ...fx.graph,
        edges: [...fx.graph.edges, { source: 1, target: 3, pos: [50, 50] }],
      },
    };
    const issues = validateGtmFixture(withExtraEdge);
    expect(issues.some((i) => i.code === "gruebler")).toBe(true);
  });

  it("reports coincident joints when two joints of one link are too close", () => {
    const fx = fourBarFixture();
    const size = sizeOf(fx);
    const tooClose: GtmFixture = {
      ...fx,
      graph: {
        ...fx.graph,
        edges: fx.graph.edges.map((e, i) =>
          i === 1 ? { ...e, pos: [O2.x + 1e-4 * size, O2.y] as [number, number] } : e,
        ),
      },
    };
    const issues = validateGtmFixture(tooClose);
    expect(issues.some((i) => i.code === "coincident-joints")).toBe(true);
  });

  it("reports a collinear-plate issue for a ternary link whose 3 joints lie on a line", () => {
    const fx = fourBarFixture();
    const collinearGround: GtmFixture = {
      ...fx,
      graph: {
        ...fx.graph,
        nodes: [...fx.graph.nodes, { id: 4, link_type: "binary" }],
        edges: [...fx.graph.edges, { source: 0, target: 4, pos: [200, 0] }],
      },
    };
    const issues = validateGtmFixture(collinearGround);
    expect(issues.some((i) => i.code === "collinear-plate")).toBe(true);
  });
});

describe("gtmToDocument", () => {
  it("builds a document that assembles at the reference pose (residual < 1e-9)", () => {
    const fx = fourBarFixture();
    const doc = gtmToDocument(fx);
    const system = compileSystem(doc);
    const ref = referenceState(system);
    const r = new Float64Array(system.jointRows);
    evalResidual(system, ref.q, new Float64Array(system.motors.length), r, system.jointRows);
    let normSq = 0;
    for (let i = 0; i < r.length; i++) normSq += r[i] * r[i];
    expect(Math.sqrt(normSq)).toBeLessThan(1e-9);
    expect(system.motors).toHaveLength(1);
    expect(system.motors[0].kind).toBe("rotary");
    expect(doc.markers).toHaveLength(1);
  });
});

describe("prismatic edges — parsing", () => {
  it("accepts a prismatic edge with a non-zero axis, and an explicit type: revolute", () => {
    const fx = parseGtmFixture(JSON.stringify(sliderCrankShapedFixture()));
    const prismaticEdge = fx.graph.edges.find((e) => e.type === "prismatic");
    expect(prismaticEdge).toBeDefined();
    expect(prismaticEdge?.axis).toEqual([1, 0]);

    const raw = JSON.parse(JSON.stringify(sliderCrankShapedFixture())) as {
      graph: { edges: { type?: string }[] };
    };
    raw.graph.edges[0].type = "revolute";
    expect(() => parseGtmFixture(JSON.stringify(raw))).not.toThrow();
  });

  it("rejects a prismatic edge without an axis", () => {
    const raw = JSON.parse(JSON.stringify(sliderCrankShapedFixture())) as {
      graph: { edges: { axis?: [number, number] }[] };
    };
    delete raw.graph.edges[3].axis;
    expect(() => parseGtmFixture(JSON.stringify(raw))).toThrow(/requires an axis/);
  });

  it("rejects a prismatic edge with a zero axis", () => {
    const raw = JSON.parse(JSON.stringify(sliderCrankShapedFixture())) as {
      graph: { edges: { axis?: [number, number] }[] };
    };
    raw.graph.edges[3].axis = [0, 0];
    expect(() => parseGtmFixture(JSON.stringify(raw))).toThrow(/non-zero and finite/);
  });

  it("rejects an axis on a revolute edge", () => {
    const raw = JSON.parse(JSON.stringify(sliderCrankShapedFixture())) as {
      graph: { edges: { axis?: [number, number] }[] };
    };
    raw.graph.edges[1].axis = [1, 0];
    expect(() => parseGtmFixture(JSON.stringify(raw))).toThrow(/must not carry an axis/);
  });

  it("rejects an unknown edge type (Zod)", () => {
    const raw = JSON.parse(JSON.stringify(sliderCrankShapedFixture())) as {
      graph: { edges: { type?: string }[] };
    };
    raw.graph.edges[3].type = "helical";
    expect(() => parseGtmFixture(JSON.stringify(raw))).toThrow();
  });

  it("rejects an input edge that is prismatic (linear input out of scope)", () => {
    const raw = JSON.parse(JSON.stringify(sliderCrankShapedFixture())) as {
      graph: {
        edges: { input?: boolean; type?: string; axis?: [number, number] }[];
      };
    };
    delete raw.graph.edges[0].input;
    raw.graph.edges[3].input = true;
    expect(() => parseGtmFixture(JSON.stringify(raw))).toThrow(/must not be prismatic/);
  });
});

describe("prismatic edges — validateGtmFixture", () => {
  it("reports no coincident-joints for the slider-crank fixture shape", () => {
    const fx = sliderCrankShapedFixture();
    expect(validateGtmFixture(fx)).toEqual([]);
  });

  it("still reports coincident-joints for two revolute joints of one link at the same point", () => {
    const fx = sliderCrankShapedFixture();
    const size = sizeOf(fx);
    const tooClose: GtmFixture = {
      ...fx,
      graph: {
        ...fx.graph,
        // Move the (1,2) revolute joint's position onto the (0,1) revolute
        // joint's position (both on link 1, both revolute) -> flagged.
        edges: fx.graph.edges.map((e, i) =>
          i === 1 ? { ...e, pos: [O2.x + 1e-4 * size, O2.y] as [number, number] } : e,
        ),
      },
    };
    const issues = validateGtmFixture(tooClose);
    expect(issues.some((i) => i.code === "coincident-joints")).toBe(true);
  });
});

describe("prismatic edges — gtmToDocument", () => {
  it("emits exactly one P joint owned by ground (unrotated axis) for the slider-crank shape", () => {
    const fx = sliderCrankShapedFixture();
    const doc = gtmToDocument(fx);
    const pJoints = doc.joints.filter((j) => j.type === "P");
    expect(pJoints).toHaveLength(1);
    const pJoint = pJoints[0];
    expect(pJoint.type).toBe("P");
    if (pJoint.type !== "P") throw new Error("unreachable");
    expect(pJoint.axis[0]).toBeCloseTo(1, 12);
    expect(pJoint.axis[1]).toBeCloseTo(0, 12);

    const groundLink = doc.links.find((l) => l.isGround);
    if (!groundLink) throw new Error("no ground link");
    expect(groundLink.sites.some((s) => s.id === pJoint.siteA)).toBe(true);

    const system = compileSystem(doc);
    const ref = referenceState(system);
    const r = new Float64Array(system.jointRows);
    evalResidual(system, ref.q, new Float64Array(system.motors.length), r, system.jointRows);
    let normSq = 0;
    for (let i = 0; i < r.length; i++) normSq += r[i] * r[i];
    expect(Math.sqrt(normSq)).toBeLessThan(1e-9);
    expect(system.motors).toHaveLength(1);
    expect(system.motors[0].kind).toBe("rotary");
  });

  it("gives the slider link (all sites coincide) pose {origin: that point, angle: 0}", () => {
    const fx = sliderCrankShapedFixture();
    const doc = gtmToDocument(fx);
    const sliderLink = doc.links.find((l) => l.name === "link-3");
    if (!sliderLink) throw new Error("no slider link");
    expect(sliderLink.pose.angle).toBe(0);
    expect(sliderLink.pose.position[0]).toBeCloseTo(scP.x, 12);
    expect(sliderLink.pose.position[1]).toBeCloseTo(scP.y, 12);
  });

  it("rotates a moving owner link's world axis into its local frame (inverted-slider-crank shape)", () => {
    const fx = invertedSliderCrankShapedFixture();
    const doc = gtmToDocument(fx);
    const pJoints = doc.joints.filter((j) => j.type === "P");
    expect(pJoints).toHaveLength(1);
    const pJoint = pJoints[0];
    if (pJoint.type !== "P") throw new Error("unreachable");

    const rockerLink = doc.links.find((l) => l.name === "link-2");
    if (!rockerLink) throw new Error("no rocker link");
    expect(rockerLink.pose.angle).toBeCloseTo(iscRockerAngle, 12);
    expect(rockerLink.pose.angle).not.toBeCloseTo(0, 3);
    // The fixture's world axis is the rocker's own local +x direction by
    // construction (both derived from O4 -> A) -> local axis is [1, 0].
    expect(pJoint.axis[0]).toBeCloseTo(1, 9);
    expect(pJoint.axis[1]).toBeCloseTo(0, 9);

    const system = compileSystem(doc);
    const ref = referenceState(system);
    const r = new Float64Array(system.jointRows);
    evalResidual(system, ref.q, new Float64Array(system.motors.length), r, system.jointRows);
    let normSq = 0;
    for (let i = 0; i < r.length; i++) normSq += r[i] * r[i];
    expect(Math.sqrt(normSq)).toBeLessThan(1e-9);
    expect(system.motors).toHaveLength(1);
    expect(system.motors[0].kind).toBe("rotary");
  });
});

describe("thetaRefOf / sizeOf", () => {
  it("computes theta_ref as the ground-pivot -> next-joint angle", () => {
    const fx = fourBarFixture();
    const thetaRef = thetaRefOf(fx);
    expect(thetaRef).toBeCloseTo(REFERENCE_ANGLE, 12);
  });

  it("computes size as the max bbox dimension over all joint positions", () => {
    const fx = fourBarFixture();
    const size = sizeOf(fx);
    expect(size).toBeGreaterThan(0);
    expect(size).toBeCloseTo(110, 6); // bbox x in [0,110], y in [0,80] -> width 110
  });
});

describe("fixtureHash", () => {
  it("is stable across CRLF/LF line endings", () => {
    const text = '{"a":1}\n{"b":2}\n';
    const crlf = text.replace(/\n/g, "\r\n");
    expect(fixtureHash(text)).toBe(fixtureHash(crlf));
  });

  it("is a 64-char hex sha256 digest", () => {
    expect(fixtureHash("hello")).toMatch(/^[0-9a-f]{64}$/);
  });
});
