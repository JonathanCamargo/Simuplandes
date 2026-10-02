import { describe, it, expect } from "vitest";
import { computeSnap } from "./snapping";
import {
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

// Isolates the kind(s) under test by disabling grid outright (a huge spacing
// still produces a nearby grid point when the cursor itself is near zero).
const NO_GRID = { gridSpacing: 1e9, kinds: { grid: false } } as const;

describe("computeSnap: site", () => {
  const d = doc({
    links: [
      {
        id: "l1",
        name: "a",
        isGround: false,
        pose: { position: [0, 0], angle: 0 },
        shape: { kind: "bar" },
        sites: [{ id: "s1", local: [0, 0] }],
      },
      {
        id: "l2",
        name: "b",
        isGround: false,
        pose: { position: [10, 0], angle: 0 },
        shape: { kind: "bar" },
        sites: [{ id: "s2", local: [0, 0] }],
      },
    ],
  });

  it("snaps to the exact site world position when within radius", () => {
    const result = computeSnap({ x: 0.5, y: 0 }, d, { radiusWorld: 2, ...NO_GRID });
    expect(result).toEqual({ kind: "site", point: { x: 0, y: 0 }, siteId: "s1", linkId: "l1" });
  });

  it("picks the nearest site, ties going to lower document order", () => {
    const tied = doc({
      links: [
        {
          id: "first",
          name: "first",
          isGround: false,
          pose: { position: [1, 0], angle: 0 },
          shape: { kind: "bar" },
          sites: [{ id: "siteFirst", local: [0, 0] }],
        },
        {
          id: "second",
          name: "second",
          isGround: false,
          pose: { position: [-1, 0], angle: 0 },
          shape: { kind: "bar" },
          sites: [{ id: "siteSecond", local: [0, 0] }],
        },
      ],
    });
    const result = computeSnap({ x: 0, y: 0 }, tied, { radiusWorld: 5, ...NO_GRID });
    expect(result.kind).toBe("site");
    expect(result.siteId).toBe("siteFirst");
  });

  it("excludes ids in excludeSiteIds", () => {
    const result = computeSnap({ x: 0.5, y: 0 }, d, {
      radiusWorld: 2,
      excludeSiteIds: new Set(["s1"]),
      ...NO_GRID,
    });
    expect(result.kind).toBe("none");
  });

  it("is disabled by kinds.site = false", () => {
    const result = computeSnap({ x: 0.5, y: 0 }, d, {
      radiusWorld: 2,
      gridSpacing: 1e9,
      kinds: { site: false, grid: false },
    });
    expect(result.kind).toBe("none");
  });
});

describe("computeSnap: midpoint", () => {
  it("finds the midpoint of a non-ground bar's two sites, beating grid", () => {
    const d = doc({
      links: [
        {
          id: "bar1",
          name: "bar",
          isGround: false,
          pose: { position: [0, 0], angle: 0 },
          shape: { kind: "bar" },
          sites: [
            { id: "sA", local: [-5, 0] },
            { id: "sB", local: [5, 0] },
          ],
        },
      ],
    });
    const result = computeSnap({ x: 0.05, y: 0.02 }, d, { radiusWorld: 1, gridSpacing: 1 });
    expect(result.kind).toBe("midpoint");
    expect(result.point).toEqual({ x: 0, y: 0 });
    expect(result.linkId).toBe("bar1");
  });

  it("ignores a ground link's two-site midpoint", () => {
    const d = doc({
      links: [
        {
          id: "ground1",
          name: "ground",
          isGround: true,
          pose: { position: [0, 0], angle: 0 },
          shape: { kind: "bar" },
          sites: [
            { id: "sA", local: [-5, 0] },
            { id: "sB", local: [5, 0] },
          ],
        },
      ],
    });
    const result = computeSnap({ x: 0.05, y: 0.02 }, d, {
      radiusWorld: 1,
      gridSpacing: 1e9,
      kinds: { grid: false },
    });
    expect(result.kind).toBe("none");
  });

  it("finds midpoints of consecutive plate outline edges, transformed to world", () => {
    const d = doc({
      links: [
        {
          id: "plate1",
          name: "plate",
          isGround: false,
          pose: { position: [100, 0], angle: 0 },
          shape: {
            kind: "plate",
            outline: [
              [0, 0],
              [10, 0],
              [10, 10],
            ],
          },
          sites: [],
        },
      ],
    });
    // Edge (0,0)-(10,0) world midpoint is (105, 0).
    const result = computeSnap({ x: 105.02, y: 0.01 }, d, { radiusWorld: 1, gridSpacing: 1e9 });
    expect(result.kind).toBe("midpoint");
    expect(result.point).toEqual({ x: 105, y: 0 });
  });

  it("keeps the nearest of two midpoint candidates within radius", () => {
    const d = doc({
      links: [
        {
          id: "near",
          name: "near",
          isGround: false,
          pose: { position: [0, 0], angle: 0 },
          shape: { kind: "bar" },
          sites: [
            { id: "n1", local: [-1, 0] },
            { id: "n2", local: [1, 0] },
          ],
        },
        {
          id: "far",
          name: "far",
          isGround: false,
          pose: { position: [3, 0], angle: 0 },
          shape: { kind: "bar" },
          sites: [
            { id: "f1", local: [-1, 0] },
            { id: "f2", local: [1, 0] },
          ],
        },
      ],
    });
    // "near" midpoint is (0,0); "far" midpoint is (3,0) -- both within radius 5,
    // but "near" is strictly closer to the cursor. Site kind is disabled so
    // the two links' own sites (which are also within radius 5) don't win first.
    const result = computeSnap({ x: 0.1, y: 0 }, d, {
      radiusWorld: 5,
      gridSpacing: 1e9,
      kinds: { grid: false, site: false },
    });
    expect(result.kind).toBe("midpoint");
    expect(result.linkId).toBe("near");
  });

  it("is disabled by kinds.midpoint = false", () => {
    const d = doc({
      links: [
        {
          id: "bar1",
          name: "bar",
          isGround: false,
          pose: { position: [0, 0], angle: 0 },
          shape: { kind: "bar" },
          sites: [
            { id: "sA", local: [-5, 0] },
            { id: "sB", local: [5, 0] },
          ],
        },
      ],
    });
    const result = computeSnap({ x: 0.05, y: 0 }, d, {
      radiusWorld: 1,
      gridSpacing: 1e9,
      kinds: { midpoint: false, grid: false },
    });
    expect(result.kind).toBe("none");
  });
});

describe("computeSnap: grid", () => {
  const empty = doc();

  it("snaps to the exact grid point when within radius", () => {
    const result = computeSnap({ x: 21, y: 39 }, empty, { radiusWorld: 5, gridSpacing: 10 });
    expect(result).toEqual({ kind: "grid", point: { x: 20, y: 40 } });
  });

  it("does not snap to grid when outside radius", () => {
    const result = computeSnap({ x: 25, y: 45 }, empty, { radiusWorld: 2, gridSpacing: 10 });
    expect(result.kind).toBe("none");
  });

  it("is disabled by kinds.grid = false", () => {
    const result = computeSnap({ x: 21, y: 39 }, empty, {
      radiusWorld: 5,
      gridSpacing: 10,
      kinds: { grid: false },
    });
    expect(result.kind).toBe("none");
  });

  it("never grid-snaps for a non-positive gridSpacing", () => {
    const result = computeSnap({ x: 0, y: 0 }, empty, { radiusWorld: 5, gridSpacing: 0 });
    expect(result.kind).toBe("none");
  });
});

describe("computeSnap: angle", () => {
  const empty = doc();

  it("snaps to the projection onto the nearest 15deg ray from the anchor", () => {
    const anchor = { x: 0, y: 0 };
    // A point near the 30deg ray, slightly off to the side.
    const rayAngle = (30 * Math.PI) / 180;
    const along = 20;
    const onRay = { x: Math.cos(rayAngle) * along, y: Math.sin(rayAngle) * along };
    const cursor = { x: onRay.x, y: onRay.y + 1 }; // ~1 unit off the ray
    const result = computeSnap(cursor, empty, { radiusWorld: 2, gridSpacing: 1e9, anchor });
    expect(result.kind).toBe("angle");
    expect(result.angleDeg).toBeCloseTo(30, 6);
  });

  it("has no angle candidate without an anchor", () => {
    const result = computeSnap({ x: 20, y: 20.5 }, empty, { radiusWorld: 2, gridSpacing: 1e9 });
    expect(result.kind).toBe("none");
  });

  it("has no angle candidate when the cursor sits on the anchor itself", () => {
    const result = computeSnap({ x: 0, y: 0 }, empty, {
      radiusWorld: 2,
      gridSpacing: 1e9,
      anchor: { x: 0, y: 0 },
      kinds: { grid: false },
    });
    expect(result.kind).toBe("none");
  });

  it("is disabled by kinds.angle = false", () => {
    const anchor = { x: 0, y: 0 };
    const rayAngle = (30 * Math.PI) / 180;
    const onRay = { x: Math.cos(rayAngle) * 20, y: Math.sin(rayAngle) * 20 };
    const result = computeSnap({ x: onRay.x, y: onRay.y + 1 }, empty, {
      radiusWorld: 2,
      gridSpacing: 1e9,
      anchor,
      kinds: { angle: false },
    });
    expect(result.kind).toBe("none");
  });

  it("has no angle candidate when the cursor is farther than radiusWorld from every ray", () => {
    const anchor = { x: 0, y: 0 };
    const rayAngle = (30 * Math.PI) / 180;
    const onRay = { x: Math.cos(rayAngle) * 20, y: Math.sin(rayAngle) * 20 };
    const result = computeSnap({ x: onRay.x, y: onRay.y + 50 }, empty, {
      radiusWorld: 1,
      gridSpacing: 1e9,
      anchor,
      kinds: { grid: false },
    });
    expect(result.kind).toBe("none");
  });

  it("respects a custom angleStepDeg", () => {
    const anchor = { x: 0, y: 0 };
    const rayAngle = (45 * Math.PI) / 180; // not a multiple of 15 nor 90... but is of 45
    const onRay = { x: Math.cos(rayAngle) * 20, y: Math.sin(rayAngle) * 20 };
    const result = computeSnap({ x: onRay.x, y: onRay.y + 0.5 }, empty, {
      radiusWorld: 1,
      gridSpacing: 1e9,
      anchor,
      angleStepDeg: 45,
    });
    expect(result.kind).toBe("angle");
    expect(result.angleDeg).toBeCloseTo(45, 6);
  });
});

describe("computeSnap: none / enabled", () => {
  it("returns none with point = cursor when nothing is nearby", () => {
    const result = computeSnap({ x: 12345, y: 6789 }, doc(), { radiusWorld: 1, gridSpacing: 1e9 });
    expect(result).toEqual({ kind: "none", point: { x: 12345, y: 6789 } });
  });

  it("forces none when enabled = false, even with a site right under the cursor", () => {
    const d = doc({
      links: [
        {
          id: "l1",
          name: "a",
          isGround: false,
          pose: { position: [0, 0], angle: 0 },
          shape: { kind: "bar" },
          sites: [{ id: "s1", local: [0, 0] }],
        },
      ],
    });
    const result = computeSnap({ x: 0, y: 0 }, d, {
      radiusWorld: 5,
      gridSpacing: 1,
      enabled: false,
    });
    expect(result).toEqual({ kind: "none", point: { x: 0, y: 0 } });
  });
});

describe("computeSnap: radius is in world units, scaled by 1/zoom", () => {
  it("a fixed world distance from a site snaps at low zoom (large radiusWorld) but not at high zoom (small radiusWorld)", () => {
    const d = doc({
      links: [
        {
          id: "l1",
          name: "a",
          isGround: false,
          pose: { position: [0, 0], angle: 0 },
          shape: { kind: "bar" },
          sites: [{ id: "s1", local: [0, 0] }],
        },
      ],
    });
    const cursor = { x: 3, y: 0 }; // fixed 3mm world distance from the site
    const lowZoomRadius = 8 / 0.5; // 16
    const highZoomRadius = 8 / 4; // 2

    const lowZoom = computeSnap(cursor, d, { radiusWorld: lowZoomRadius, ...NO_GRID });
    const highZoom = computeSnap(cursor, d, { radiusWorld: highZoomRadius, ...NO_GRID });

    expect(lowZoom.kind).toBe("site");
    expect(highZoom.kind).toBe("none");
  });
});
