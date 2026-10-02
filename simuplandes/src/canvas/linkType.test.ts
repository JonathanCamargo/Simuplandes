import { describe, it, expect } from "vitest";
import { linkTypeOf, linkTypes } from "./linkType";
import {
  indexDocument,
  MechanismDocumentSchema,
  type MechanismDocument,
  type MechanismDocumentInput,
} from "../model";

function doc(input: Partial<MechanismDocumentInput> = {}): MechanismDocument {
  return MechanismDocumentSchema.parse({
    schemaVersion: 1,
    name: "test",
    units: { length: "mm" },
    links: [],
    joints: [],
    motors: [],
    markers: [],
    loads: [],
    ...input,
  });
}

/** Builds a link with `n` sites, each carrying its own R joint to a fresh ground site. */
function buildDocWithJointCount(n: number): MechanismDocument {
  const groundSites = Array.from({ length: n }, (_, i) => ({
    id: `g${i}`,
    local: [i, 10] as [number, number],
  }));
  const linkSites = Array.from({ length: n }, (_, i) => ({
    id: `s${i}`,
    local: [i, 0] as [number, number],
  }));
  return doc({
    links: [
      {
        id: "ground",
        name: "ground",
        isGround: true,
        pose: { position: [0, 0], angle: 0 },
        shape: { kind: "bar" },
        sites: groundSites,
      },
      {
        id: "link1",
        name: "link1",
        isGround: false,
        pose: { position: [0, 0], angle: 0 },
        shape: { kind: "bar" },
        sites: linkSites,
      },
    ],
    joints: Array.from({ length: n }, (_, i) => ({
      id: `j${i}`,
      type: "R" as const,
      siteA: `s${i}`,
      siteB: `g${i}`,
    })),
  });
}

describe("linkTypeOf", () => {
  it("classifies a ground link as ground regardless of joint count", () => {
    const d = doc({
      links: [
        {
          id: "ground",
          name: "ground",
          isGround: true,
          pose: { position: [0, 0], angle: 0 },
          shape: { kind: "bar" },
          sites: [{ id: "g0", local: [0, 0] }],
        },
      ],
    });
    expect(linkTypeOf(d, d.links[0])).toBe("ground");
  });

  it("classifies 0 or 1 or 2 distinct joints as binary", () => {
    for (const n of [0, 1, 2]) {
      const d = buildDocWithJointCount(n);
      const link = d.links.find((l) => l.id === "link1")!;
      expect(linkTypeOf(d, link)).toBe("binary");
    }
  });

  it("classifies 3 distinct joints as ternary", () => {
    const d = buildDocWithJointCount(3);
    const link = d.links.find((l) => l.id === "link1")!;
    expect(linkTypeOf(d, link)).toBe("ternary");
  });

  it("classifies 4 distinct joints as quaternary", () => {
    const d = buildDocWithJointCount(4);
    const link = d.links.find((l) => l.id === "link1")!;
    expect(linkTypeOf(d, link)).toBe("quaternary");
  });

  it("classifies 5+ distinct joints as pentary", () => {
    const d = buildDocWithJointCount(5);
    const link = d.links.find((l) => l.id === "link1")!;
    expect(linkTypeOf(d, link)).toBe("pentary");

    const d6 = buildDocWithJointCount(6);
    const link6 = d6.links.find((l) => l.id === "link1")!;
    expect(linkTypeOf(d6, link6)).toBe("pentary");
  });

  it("counts DISTINCT joints, not joint-site pairs", () => {
    // A single joint touching two of the link's own sites would be invalid
    // (schema forbids a joint connecting two sites on the same link), so
    // instead prove distinctness via two sites sharing NO joint duplication:
    // one site with 2 joints to two different ground sites still counts as 2.
    const d = doc({
      links: [
        {
          id: "ground",
          name: "ground",
          isGround: true,
          pose: { position: [0, 0], angle: 0 },
          shape: { kind: "bar" },
          sites: [
            { id: "g0", local: [0, 10] },
            { id: "g1", local: [1, 10] },
          ],
        },
        {
          id: "link1",
          name: "link1",
          isGround: false,
          pose: { position: [0, 0], angle: 0 },
          shape: { kind: "bar" },
          sites: [{ id: "s0", local: [0, 0] }],
        },
      ],
      joints: [
        { id: "jA", type: "R", siteA: "s0", siteB: "g0" },
        { id: "jB", type: "R", siteA: "s0", siteB: "g1" },
      ],
    });
    const link = d.links.find((l) => l.id === "link1")!;
    expect(linkTypeOf(d, link)).toBe("binary"); // 2 distinct joints -> binary
  });

  it("accepts a pre-built index to avoid re-indexing", () => {
    const d = buildDocWithJointCount(3);
    const link = d.links.find((l) => l.id === "link1")!;
    const index = indexDocument(d);
    expect(linkTypeOf(d, link, index)).toBe("ternary");
  });
});

describe("linkTypes", () => {
  it("maps every link id to its type in one indexed pass", () => {
    const d = buildDocWithJointCount(3);
    const map = linkTypes(d);
    expect(map.get("ground")).toBe("ground");
    expect(map.get("link1")).toBe("ternary");
    expect(map.size).toBe(2);
  });
});
