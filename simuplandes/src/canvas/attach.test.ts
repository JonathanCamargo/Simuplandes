import { describe, expect, it } from "vitest";
import { MechanismDocumentSchema, type MechanismDocument } from "../model";
import { attachmentsAt, jointPoint, linkPointNear, segmentIntersection } from "./attach";

/** A bar `h` (0,0)-(100,0), a bar `v` (50,-50)-(50,50), a square plate `p` around (200,0) and ground `g`. */
function doc(): MechanismDocument {
  return MechanismDocumentSchema.parse({
    schemaVersion: 2,
    links: [
      {
        id: "h",
        name: "H",
        isGround: false,
        pose: { position: [0, 0], angle: 0 },
        shape: { kind: "bar" },
        sites: [
          { id: "h1", local: [0, 0] },
          { id: "h2", local: [100, 0] },
        ],
      },
      {
        id: "v",
        name: "V",
        isGround: false,
        pose: { position: [50, -50], angle: Math.PI / 2 },
        shape: { kind: "bar" },
        sites: [
          { id: "v1", local: [0, 0] },
          { id: "v2", local: [100, 0] },
        ],
      },
      {
        id: "p",
        name: "P",
        isGround: false,
        pose: { position: [200, 0], angle: 0 },
        shape: {
          kind: "plate",
          outline: [
            [-20, -20],
            [20, -20],
            [20, 20],
            [-20, 20],
          ],
        },
        sites: [{ id: "p1", local: [-20, -20] }],
      },
      {
        id: "g",
        name: "Ground",
        isGround: true,
        pose: { position: [0, 0], angle: 0 },
        shape: { kind: "bar" },
        sites: [
          { id: "g1", local: [0, 0] },
          { id: "g2", local: [0, 300] },
        ],
      },
    ],
  });
}

function link(id: string) {
  return doc().links.find((l) => l.id === id)!;
}

describe("linkPointNear", () => {
  it("projects onto a bar's path, within the radius only", () => {
    expect(linkPointNear(link("h"), { x: 30, y: 5 }, 8)).toMatchObject({
      point: { x: 30, y: 0 },
      distance: 5,
    });
    expect(linkPointNear(link("h"), { x: 30, y: 9 }, 8)).toBeNull();
  });

  it("is the point itself inside a plate, and the nearest edge point just outside", () => {
    expect(linkPointNear(link("p"), { x: 205, y: 3 }, 8)).toEqual({
      point: { x: 205, y: 3 },
      distance: 0,
    });
    expect(linkPointNear(link("p"), { x: 225, y: 0 }, 8)?.point).toEqual({ x: 220, y: 0 });
  });

  it("never attaches to ground's body", () => {
    expect(linkPointNear(link("g"), { x: 0, y: 150 }, 8)).toBeNull();
  });
});

describe("attachmentsAt", () => {
  it("lists one attachment per link: sites first, then bodies", () => {
    const found = attachmentsAt(doc(), { x: 1, y: 1 }, 8);
    expect(found.map((a) => [a.kind, a.linkId])).toEqual([
      ["site", "h"],
      ["site", "g"],
    ]);
    const crossing = attachmentsAt(doc(), { x: 51, y: 2 }, 8);
    expect(crossing.map((a) => [a.kind, a.linkId])).toEqual([
      ["link", "v"],
      ["link", "h"],
    ]);
  });

  it("is empty over empty space and over ground's body", () => {
    expect(attachmentsAt(doc(), { x: 400, y: 400 }, 8)).toEqual([]);
    expect(attachmentsAt(doc(), { x: 0, y: 150 }, 8)).toEqual([]);
  });
});

describe("segmentIntersection / jointPoint", () => {
  it("finds where two segments cross, and nothing for parallel or distant ones", () => {
    const a = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
    ] as const;
    expect(
      segmentIntersection(a, [
        { x: 5, y: -5 },
        { x: 5, y: 5 },
      ]),
    ).toEqual({ x: 5, y: 0 });
    expect(
      segmentIntersection(a, [
        { x: 0, y: 1 },
        { x: 10, y: 1 },
      ]),
    ).toBeNull();
    expect(
      segmentIntersection(a, [
        { x: 50, y: -5 },
        { x: 50, y: 5 },
      ]),
    ).toBeNull();
  });

  it("puts a pin between two crossing bars exactly at the crossing", () => {
    const d = doc();
    const p = { x: 53, y: 4 };
    const [first, second] = attachmentsAt(d, p, 8);
    const at = jointPoint(d, first, second, p, 8);
    expect(at.x).toBeCloseTo(50, 9);
    expect(at.y).toBeCloseTo(0, 9);
  });

  it("puts a pin involving a site at the site", () => {
    const d = doc();
    const [first, second] = attachmentsAt(d, { x: 1, y: 1 }, 8);
    expect(jointPoint(d, first, second, { x: 1, y: 1 }, 8)).toEqual({ x: 0, y: 0 });
  });
});
