import { describe, it, expect } from "vitest";
import {
  MechanismDocumentSchema,
  checkDocumentIntegrity,
  type MechanismDocumentInput,
} from "./schema";
import { fourBarFixture } from "./__fixtures__/fourBar";

describe("MechanismDocumentSchema", () => {
  it("parses a minimal valid document with defaults filled in", () => {
    const parsed = MechanismDocumentSchema.parse({ schemaVersion: 2, links: [], joints: [] });
    expect(parsed).toEqual({
      schemaVersion: 2,
      name: "Untitled mechanism",
      units: { length: "mm" },
      links: [],
      joints: [],
      motors: [],
      markers: [],
      loads: [],
      springs: [],
      annotations: [],
      dynamics: { gravity: [0, -9.81], barDensity: 0.5, plateDensity: 10 },
    });
  });

  it("accepts units.length 'm'", () => {
    const parsed = MechanismDocumentSchema.parse({
      schemaVersion: 2,
      links: [],
      joints: [],
      units: { length: "m" },
    });
    expect(parsed.units.length).toBe("m");
  });

  it('rejects units.length \'cm\' with an issue at ["units","length"]', () => {
    const result = MechanismDocumentSchema.safeParse({
      schemaVersion: 2,
      links: [],
      joints: [],
      units: { length: "cm" },
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => i.path.join(".") === "units.length")).toBe(true);
    }
  });

  it("parses the four-bar fixture and round-trips through JSON deep-equal", () => {
    const parsed = MechanismDocumentSchema.parse(fourBarFixture);
    const roundTripped = MechanismDocumentSchema.parse(
      JSON.parse(JSON.stringify(parsed)) as unknown,
    );
    expect(roundTripped).toEqual(parsed);
  });

  it("rejects a P joint without an axis", () => {
    const doc = {
      schemaVersion: 2,
      links: fourBarFixture.links,
      joints: [{ id: "joint-x", type: "P", siteA: "site-1", siteB: "site-3" }],
    };
    const result = MechanismDocumentSchema.safeParse(doc);
    expect(result.success).toBe(false);
  });

  it('rejects a P joint with a zero axis at ["joints",i,"axis"]', () => {
    const doc = {
      schemaVersion: 2,
      links: fourBarFixture.links,
      joints: [{ id: "joint-x", type: "P", siteA: "site-1", siteB: "site-3", axis: [0, 0] }],
    };
    const result = MechanismDocumentSchema.safeParse(doc);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => i.path.join(".") === "joints.0.axis")).toBe(true);
    }
  });

  it("strips an axis field on an R joint (strip mode)", () => {
    const doc = {
      schemaVersion: 2,
      links: fourBarFixture.links,
      joints: [{ id: "joint-x", type: "R", siteA: "site-1", siteB: "site-3", axis: [1, 0] }],
    };
    const parsed = MechanismDocumentSchema.parse(doc);
    expect(parsed.joints[0]).not.toHaveProperty("axis");
  });

  it("rejects a plate outline with only 2 points", () => {
    const result = MechanismDocumentSchema.safeParse({
      schemaVersion: 2,
      joints: [],
      links: [
        {
          id: "link-x",
          name: "x",
          isGround: false,
          pose: { position: [0, 0], angle: 0 },
          shape: {
            kind: "plate",
            outline: [
              [0, 0],
              [1, 1],
            ],
          },
          sites: [],
        },
      ],
    });
    expect(result.success).toBe(false);
  });

  it("rejects an unknown shape kind", () => {
    const result = MechanismDocumentSchema.safeParse({
      schemaVersion: 2,
      joints: [],
      links: [
        {
          id: "link-x",
          name: "x",
          isGround: false,
          pose: { position: [0, 0], angle: 0 },
          shape: { kind: "triangle" },
          sites: [],
        },
      ],
    });
    expect(result.success).toBe(false);
  });

  it("rejects a joint referencing an unknown siteA", () => {
    const doc = {
      schemaVersion: 2,
      links: fourBarFixture.links,
      joints: [{ id: "joint-x", type: "R", siteA: "site-9", siteB: "site-3" }],
    };
    const result = MechanismDocumentSchema.safeParse(doc);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => i.path.join(".") === "joints.0.siteA")).toBe(true);
    }
  });

  it("rejects a joint whose siteA and siteB are on the same link", () => {
    const doc = {
      schemaVersion: 2,
      links: fourBarFixture.links,
      joints: [{ id: "joint-x", type: "R", siteA: "site-1", siteB: "site-2" }],
    };
    const result = MechanismDocumentSchema.safeParse(doc);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => i.path.join(".") === "joints.0.siteB")).toBe(true);
    }
  });

  it("rejects a motor referencing an unknown jointId", () => {
    const doc: MechanismDocumentInput = {
      ...fourBarFixture,
      motors: [
        {
          id: "motor-x",
          jointId: "joint-9",
          kind: "rotary",
          drive: { mode: "constant", speed: 1 },
        },
      ],
    };
    const result = MechanismDocumentSchema.safeParse(doc);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => i.path.join(".") === "motors.0.jointId")).toBe(true);
    }
  });

  it("rejects a rotary motor on a P joint", () => {
    const doc: MechanismDocumentInput = {
      schemaVersion: 2,
      links: fourBarFixture.links,
      joints: [{ id: "joint-1", type: "P", siteA: "site-1", siteB: "site-3", axis: [1, 0] }],
      motors: [
        {
          id: "motor-x",
          jointId: "joint-1",
          kind: "rotary",
          drive: { mode: "constant", speed: 1 },
        },
      ],
    };
    const result = MechanismDocumentSchema.safeParse(doc);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => i.path.join(".") === "motors.0.kind")).toBe(true);
    }
  });

  it('rejects two motors on one joint, the second at ["motors",1,"jointId"]', () => {
    const doc: MechanismDocumentInput = {
      ...fourBarFixture,
      motors: [
        {
          id: "motor-1",
          jointId: "joint-1",
          kind: "rotary",
          drive: { mode: "constant", speed: 1 },
        },
        {
          id: "motor-2",
          jointId: "joint-1",
          kind: "rotary",
          drive: { mode: "constant", speed: 2 },
        },
      ],
    };
    const result = MechanismDocumentSchema.safeParse(doc);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => i.path.join(".") === "motors.1.jointId")).toBe(true);
    }
  });

  it("rejects a marker referencing an unknown linkId", () => {
    const doc: MechanismDocumentInput = {
      ...fourBarFixture,
      markers: [{ id: "marker-x", linkId: "link-9", local: [0, 0] }],
    };
    const result = MechanismDocumentSchema.safeParse(doc);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => i.path.join(".") === "markers.0.linkId")).toBe(true);
    }
  });

  it("rejects a load referencing an unknown siteId", () => {
    const doc: MechanismDocumentInput = {
      ...fourBarFixture,
      loads: [{ id: "load-x", siteId: "site-99", force: [0, 0], torque: 0 }],
    };
    const result = MechanismDocumentSchema.safeParse(doc);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => i.path.join(".") === "loads.0.siteId")).toBe(true);
    }
  });

  it("rejects a duplicate id (a site reusing a link's id) with a message containing 'duplicate id' and the id", () => {
    const doc = {
      schemaVersion: 2,
      links: [
        {
          id: "link-1",
          name: "ground",
          isGround: true,
          pose: { position: [0, 0], angle: 0 },
          shape: { kind: "bar" },
          sites: [{ id: "link-1", local: [0, 0] }],
        },
      ],
      joints: [],
    };
    const result = MechanismDocumentSchema.safeParse(doc);
    expect(result.success).toBe(false);
    if (!result.success) {
      const issue = result.error.issues.find((i) => i.message.includes("duplicate id"));
      expect(issue).toBeDefined();
      expect(issue?.message).toContain("link-1");
    }
  });

  it("rejects schemaVersion 3", () => {
    const result = MechanismDocumentSchema.safeParse({ schemaVersion: 3, links: [], joints: [] });
    expect(result.success).toBe(false);
  });

  it("rejects a missing schemaVersion", () => {
    const result = MechanismDocumentSchema.safeParse({ links: [], joints: [] });
    expect(result.success).toBe(false);
  });

  it("rejects NaN in a site's local coordinate", () => {
    const doc = {
      schemaVersion: 2,
      links: [
        {
          id: "link-1",
          name: "ground",
          isGround: true,
          pose: { position: [0, 0], angle: 0 },
          shape: { kind: "bar" },
          sites: [{ id: "site-1", local: [Number.NaN, 0] }],
        },
      ],
      joints: [],
    };
    const result = MechanismDocumentSchema.safeParse(doc);
    expect(result.success).toBe(false);
  });

  it("rejects Infinity in a site's local coordinate", () => {
    const doc = {
      schemaVersion: 2,
      links: [
        {
          id: "link-1",
          name: "ground",
          isGround: true,
          pose: { position: [0, 0], angle: 0 },
          shape: { kind: "bar" },
          sites: [{ id: "site-1", local: [Number.POSITIVE_INFINITY, 0] }],
        },
      ],
      joints: [],
    };
    const result = MechanismDocumentSchema.safeParse(doc);
    expect(result.success).toBe(false);
  });

  it("preserves a large negative y exactly (no y-flip)", () => {
    const doc = {
      schemaVersion: 2,
      links: [
        {
          id: "link-1",
          name: "ground",
          isGround: true,
          pose: { position: [0, 0], angle: 0 },
          shape: { kind: "bar" },
          sites: [{ id: "site-1", local: [0, -1e6] }],
        },
      ],
      joints: [],
    };
    const parsed = MechanismDocumentSchema.parse(doc);
    expect(parsed.links[0].sites[0].local).toEqual([0, -1e6]);
  });
});

describe("MechanismDocumentSchema: dynamics (v2)", () => {
  function issuePaths(doc: MechanismDocumentInput): string[] {
    const result = MechanismDocumentSchema.safeParse(doc);
    return result.success ? [] : result.error.issues.map((i) => i.path.join("."));
  }

  it("accepts linear and torsional springs, filling damping and freeAngle", () => {
    const parsed = MechanismDocumentSchema.parse({
      ...fourBarFixture,
      springs: [
        {
          id: "spring-1",
          kind: "linear",
          siteA: "site-2",
          siteB: "site-6",
          stiffness: 100,
          freeLength: 50,
        },
        { id: "spring-2", kind: "torsional", jointId: "joint-4", stiffness: 2 },
      ],
    });
    expect(parsed.springs[0]).toMatchObject({ name: "", damping: 0, freeLength: 50 });
    expect(parsed.springs[1]).toMatchObject({ name: "", damping: 0, freeAngle: 0 });
  });

  it("rejects a linear spring with an unknown site or both sites on one link", () => {
    expect(
      issuePaths({
        ...fourBarFixture,
        springs: [
          { id: "s", kind: "linear", siteA: "nope", siteB: "nada", stiffness: 1, freeLength: 1 },
        ],
      }),
    ).toEqual(expect.arrayContaining(["springs.0.siteA", "springs.0.siteB"]));
    expect(
      issuePaths({
        ...fourBarFixture,
        springs: [
          {
            id: "s",
            kind: "linear",
            siteA: "site-3",
            siteB: "site-4",
            stiffness: 1,
            freeLength: 1,
          },
        ],
      }),
    ).toContain("springs.0.siteB");
  });

  it("rejects a torsional spring on an unknown or prismatic joint", () => {
    expect(
      issuePaths({
        ...fourBarFixture,
        springs: [{ id: "s", kind: "torsional", jointId: "joint-9", stiffness: 1 }],
      }),
    ).toContain("springs.0.jointId");
    expect(
      issuePaths({
        schemaVersion: 2,
        links: fourBarFixture.links,
        joints: [{ id: "joint-1", type: "P", siteA: "site-1", siteB: "site-3", axis: [1, 0] }],
        springs: [{ id: "s", kind: "torsional", jointId: "joint-1", stiffness: 1 }],
      }),
    ).toContain("springs.0.jointId");
  });

  it("rejects a spring id that duplicates another entity", () => {
    expect(
      issuePaths({
        ...fourBarFixture,
        springs: [{ id: "joint-1", kind: "torsional", jointId: "joint-1", stiffness: 1 }],
      }),
    ).toContain("springs.0.id");
  });

  it("rejects negative stiffness, mass or inertia", () => {
    expect(
      issuePaths({
        ...fourBarFixture,
        springs: [{ id: "s", kind: "torsional", jointId: "joint-1", stiffness: -1 }],
      }),
    ).toContain("springs.0.stiffness");
    const links = structuredClone(fourBarFixture.links)!;
    links[1].massProperties = { mass: -1, com: [0, 0], inertia: -2 };
    expect(issuePaths({ ...fourBarFixture, links })).toEqual(
      expect.arrayContaining(["links.1.massProperties.mass", "links.1.massProperties.inertia"]),
    );
  });

  it("defaults motor dynamics to motion and accepts an effort expression", () => {
    const parsed = MechanismDocumentSchema.parse(fourBarFixture);
    expect(parsed.motors[0].dynamics).toEqual({ mode: "motion" });
    const effort = MechanismDocumentSchema.parse({
      ...fourBarFixture,
      motors: [{ ...fourBarFixture.motors![0], dynamics: { mode: "effort", expression: "2" } }],
    });
    expect(effort.motors[0].dynamics).toEqual({ mode: "effort", expression: "2" });
  });

  it("rejects non-positive densities", () => {
    expect(
      issuePaths({ ...fourBarFixture, dynamics: { barDensity: 0, plateDensity: -1 } }),
    ).toEqual(expect.arrayContaining(["dynamics.barDensity", "dynamics.plateDensity"]));
  });
});

describe("checkDocumentIntegrity", () => {
  it("is exported and callable directly for unit testing", () => {
    const doc = { links: [], joints: [], motors: [], markers: [], loads: [], springs: [] };
    const issues: unknown[] = [];
    checkDocumentIntegrity(doc, {
      addIssue: (issue: unknown) => issues.push(issue),
    } as unknown as Parameters<typeof checkDocumentIntegrity>[1]);
    expect(issues).toHaveLength(0);
  });
});

describe("MechanismDocumentSchema: bar path", () => {
  const withCrankShape = (shape: unknown): MechanismDocumentInput =>
    ({
      ...fourBarFixture,
      links: fourBarFixture.links!.map((l) => (l.id === "link-2" ? { ...l, shape } : l)),
    }) as MechanismDocumentInput;

  it("gives a bar without a path every site, in order", () => {
    const parsed = MechanismDocumentSchema.parse(fourBarFixture);
    expect(parsed.links.find((l) => l.id === "link-2")!.shape).toEqual({
      kind: "bar",
      path: ["site-3", "site-4"],
    });
  });

  it("keeps an explicit path, even one that skips sites", () => {
    const parsed = MechanismDocumentSchema.parse(withCrankShape({ kind: "bar", path: ["site-4"] }));
    expect(parsed.links.find((l) => l.id === "link-2")!.shape).toEqual({
      kind: "bar",
      path: ["site-4"],
    });
  });

  it("rejects a path naming another link's site, or a site twice", () => {
    for (const path of [
      ["site-3", "site-1"],
      ["site-3", "site-3"],
    ]) {
      const result = MechanismDocumentSchema.safeParse(withCrankShape({ kind: "bar", path }));
      expect(result.success).toBe(false);
    }
  });
});

describe("MechanismDocumentSchema: curved edges", () => {
  const withCrankShape = (shape: unknown): MechanismDocumentInput =>
    ({
      ...fourBarFixture,
      links: fourBarFixture.links!.map((l) => (l.id === "link-2" ? { ...l, shape } : l)),
    }) as MechanismDocumentInput;

  it("accepts a bar with one edge per segment, of every kind", () => {
    for (const edge of [
      { kind: "line" },
      { kind: "arc", bulge: -1.5 },
      { kind: "bezier", out: [10, 5], in: [-10, 5] },
    ]) {
      expect(
        MechanismDocumentSchema.safeParse(withCrankShape({ kind: "bar", edges: [edge] })).success,
      ).toBe(true);
    }
  });

  it("rejects the wrong number of edges, or a bulge past MAX_BULGE", () => {
    const arc = { kind: "arc", bulge: 0.5 };
    expect(
      MechanismDocumentSchema.safeParse(withCrankShape({ kind: "bar", edges: [arc, arc] })).success,
    ).toBe(false);
    expect(
      MechanismDocumentSchema.safeParse(
        withCrankShape({ kind: "bar", edges: [{ kind: "arc", bulge: 5 }] }),
      ).success,
    ).toBe(false);
  });
});

describe("MechanismDocumentSchema: annotations", () => {
  const note = {
    id: "note",
    kind: "stroke",
    points: [
      [0, 0],
      [5, 5],
    ],
    color: "green",
    width: 1,
  };

  it("accepts strokes and rejects an unknown color, no points or a duplicate id", () => {
    const parse = (annotations: unknown[]) =>
      MechanismDocumentSchema.safeParse({ ...fourBarFixture, annotations }).success;
    expect(parse([note])).toBe(true);
    expect(parse([{ ...note, color: "#ff0000" }])).toBe(false);
    expect(parse([{ ...note, points: [] }])).toBe(false);
    expect(parse([{ ...note, id: "link-1" }])).toBe(false);
  });
});
