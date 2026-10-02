import { describe, it, expect } from "vitest";
import {
  MechanismDocumentSchema,
  checkDocumentIntegrity,
  type MechanismDocumentInput,
} from "./schema";
import { fourBarFixture } from "./__fixtures__/fourBar";

describe("MechanismDocumentSchema", () => {
  it("parses a minimal valid document with defaults filled in", () => {
    const parsed = MechanismDocumentSchema.parse({ schemaVersion: 1, links: [], joints: [] });
    expect(parsed).toEqual({
      schemaVersion: 1,
      name: "Untitled mechanism",
      units: { length: "mm" },
      links: [],
      joints: [],
      motors: [],
      markers: [],
      loads: [],
    });
  });

  it("accepts units.length 'm'", () => {
    const parsed = MechanismDocumentSchema.parse({
      schemaVersion: 1,
      links: [],
      joints: [],
      units: { length: "m" },
    });
    expect(parsed.units.length).toBe("m");
  });

  it('rejects units.length \'cm\' with an issue at ["units","length"]', () => {
    const result = MechanismDocumentSchema.safeParse({
      schemaVersion: 1,
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
      schemaVersion: 1,
      links: fourBarFixture.links,
      joints: [{ id: "joint-x", type: "P", siteA: "site-1", siteB: "site-3" }],
    };
    const result = MechanismDocumentSchema.safeParse(doc);
    expect(result.success).toBe(false);
  });

  it('rejects a P joint with a zero axis at ["joints",i,"axis"]', () => {
    const doc = {
      schemaVersion: 1,
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
      schemaVersion: 1,
      links: fourBarFixture.links,
      joints: [{ id: "joint-x", type: "R", siteA: "site-1", siteB: "site-3", axis: [1, 0] }],
    };
    const parsed = MechanismDocumentSchema.parse(doc);
    expect(parsed.joints[0]).not.toHaveProperty("axis");
  });

  it("rejects a plate outline with only 2 points", () => {
    const result = MechanismDocumentSchema.safeParse({
      schemaVersion: 1,
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
      schemaVersion: 1,
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
      schemaVersion: 1,
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
      schemaVersion: 1,
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
      schemaVersion: 1,
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
      schemaVersion: 1,
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

  it("rejects schemaVersion 2", () => {
    const result = MechanismDocumentSchema.safeParse({ schemaVersion: 2, links: [], joints: [] });
    expect(result.success).toBe(false);
  });

  it("rejects a missing schemaVersion", () => {
    const result = MechanismDocumentSchema.safeParse({ links: [], joints: [] });
    expect(result.success).toBe(false);
  });

  it("rejects NaN in a site's local coordinate", () => {
    const doc = {
      schemaVersion: 1,
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
      schemaVersion: 1,
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
      schemaVersion: 1,
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

describe("checkDocumentIntegrity", () => {
  it("is exported and callable directly for unit testing", () => {
    const doc = { links: [], joints: [], motors: [], markers: [], loads: [] };
    const issues: unknown[] = [];
    checkDocumentIntegrity(doc, {
      addIssue: (issue: unknown) => issues.push(issue),
    } as unknown as Parameters<typeof checkDocumentIntegrity>[1]);
    expect(issues).toHaveLength(0);
  });
});
