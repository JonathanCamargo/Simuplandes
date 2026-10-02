import { describe, it, expect } from "vitest";
import { hitTest, entitiesInBox, sitesNear } from "./hitTest";
import {
  MechanismDocumentSchema,
  type Id,
  type MechanismDocument,
  type MechanismDocumentInput,
  type Pose,
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

const fourBar = doc({
  links: [
    {
      id: "ground",
      name: "ground",
      isGround: true,
      pose: { position: [0, 0], angle: 0 },
      shape: { kind: "bar" },
      sites: [
        { id: "gO2", local: [0, 0] },
        { id: "gO4", local: [100, 0] },
      ],
    },
    {
      id: "crank",
      name: "crank",
      isGround: false,
      pose: { position: [0, 0], angle: 0 },
      shape: { kind: "bar" },
      sites: [
        { id: "cO2", local: [0, 0] },
        { id: "cA", local: [40, 0] },
      ],
    },
    {
      id: "coupler",
      name: "coupler",
      isGround: false,
      pose: { position: [40, 0], angle: 0 },
      shape: {
        kind: "plate",
        outline: [
          [0, -5],
          [30, -5],
          [30, 5],
          [0, 5],
        ],
      },
      sites: [
        { id: "pA", local: [0, 0] },
        { id: "pB", local: [30, 0] },
      ],
    },
  ],
  joints: [{ id: "jointA", type: "R", siteA: "cA", siteB: "pA" }],
  markers: [{ id: "marker1", name: "", linkId: "coupler", local: [15, 0] }],
});

describe("hitTest", () => {
  it("hits a marker with top priority", () => {
    // marker1 world = (55, 0); cA world = (40,0) is far; only marker within radius here.
    const result = hitTest(fourBar, { x: 55.2, y: 0.1 }, 1);
    expect(result).toEqual({ kind: "marker", markerId: "marker1" });
  });

  it("hits a joint when the nearest site belongs to one", () => {
    // cA (40,0) and pA (40,0) coincide and share jointA.
    const result = hitTest(fourBar, { x: 40.1, y: 0 }, 1);
    expect(result).toEqual({ kind: "joint", jointId: "jointA", siteId: "cA", linkId: "crank" });
  });

  it("hits a bare site when it belongs to no joint", () => {
    // gO2 (0,0) has no joint.
    const result = hitTest(fourBar, { x: 0.1, y: 0 }, 1);
    expect(result).toEqual({ kind: "site", siteId: "gO2", linkId: "ground" });
  });

  it("hits a bar link body between its sites", () => {
    // Midpoint of crank (0,0)-(40,0) at (20,0), 0.5 away from every site.
    const result = hitTest(fourBar, { x: 20, y: 0.2 }, 1);
    expect(result).toEqual({ kind: "link", linkId: "crank" });
  });

  it("hits inside a plate polygon", () => {
    // Coupler world outline: (40,-5)-(70,-5)-(70,5)-(40,5); interior point (55, 2).
    const result = hitTest(fourBar, { x: 55, y: 2 }, 1);
    expect(result).toEqual({ kind: "link", linkId: "coupler" });
  });

  it("never returns a ground link body, only its sites", () => {
    // On the ground bar body (0,0)-(100,0) at x=85 -- outside the crank
    // segment (x in [0,40]) and outside the coupler plate (x in [40,70]) --
    // so this only hits something if the ground body itself is hittable.
    const result = hitTest(fourBar, { x: 85, y: 0.2 }, 1);
    expect(result).toEqual({ kind: "none" });
  });

  it("returns none far from everything", () => {
    const result = hitTest(fourBar, { x: 9999, y: 9999 }, 1);
    expect(result).toEqual({ kind: "none" });
  });

  it("the topmost (later document order) link wins for overlapping bodies", () => {
    const overlapping = doc({
      links: [
        {
          id: "under",
          name: "under",
          isGround: false,
          pose: { position: [0, 0], angle: 0 },
          shape: { kind: "bar" },
          sites: [
            { id: "u1", local: [-10, 0] },
            { id: "u2", local: [10, 0] },
          ],
        },
        {
          id: "over",
          name: "over",
          isGround: false,
          pose: { position: [0, 0], angle: 0 },
          shape: { kind: "bar" },
          sites: [
            { id: "o1", local: [-10, 0] },
            { id: "o2", local: [10, 0] },
          ],
        },
      ],
    });
    const result = hitTest(overlapping, { x: 0, y: 0.2 }, 1);
    expect(result).toEqual({ kind: "link", linkId: "over" });
  });
});

describe("hitTest: edge cases", () => {
  it("handles a zero-length bar segment (coincident sites) without dividing by zero", () => {
    const d = doc({
      links: [
        {
          id: "degenerate",
          name: "degenerate",
          isGround: false,
          pose: { position: [0, 0], angle: 0 },
          shape: { kind: "bar" },
          sites: [
            { id: "d1", local: [5, 5] },
            { id: "d2", local: [5, 5] },
          ],
        },
      ],
    });
    // Far from the coincident sites, so the site check finds nothing and
    // falls through to the (zero-length) body check for this link, which
    // must degrade to a plain point-distance check rather than NaN/crash.
    const result = hitTest(d, { x: 50, y: 50 }, 1);
    expect(result).toEqual({ kind: "none" });
  });

  it("a bar link with fewer than 2 sites has no hittable body", () => {
    const d = doc({
      links: [
        {
          id: "stub",
          name: "stub",
          isGround: false,
          pose: { position: [0, 0], angle: 0 },
          shape: { kind: "bar" },
          sites: [{ id: "s1", local: [0, 0] }],
        },
      ],
    });
    const result = hitTest(d, { x: 5, y: 5 }, 1);
    expect(result).toEqual({ kind: "none" });
  });

  it("hits a plate edge when the point is outside the polygon but close to an edge", () => {
    const d = doc({
      links: [
        {
          id: "plate1",
          name: "plate1",
          isGround: false,
          pose: { position: [0, 0], angle: 0 },
          shape: {
            kind: "plate",
            outline: [
              [0, 0],
              [10, 0],
              [10, 10],
              [0, 10],
            ],
          },
          sites: [],
        },
      ],
    });
    // Just outside the top edge (y=10), within radius 1.
    const result = hitTest(d, { x: 5, y: 10.5 }, 1);
    expect(result).toEqual({ kind: "link", linkId: "plate1" });
  });

  it("skips a marker whose linkId does not resolve (defensive)", () => {
    const withDangling: MechanismDocument = {
      ...fourBar,
      markers: [
        ...fourBar.markers,
        { id: "dangling", name: "", linkId: "no-such-link", local: [0, 0] },
      ],
    };
    const result = hitTest(withDangling, { x: 0, y: 0 }, 1);
    expect(result.kind).not.toBe("marker");
  });

  it("keeps the nearer of two markers within radius", () => {
    const d = doc({
      links: [
        {
          id: "l1",
          name: "l1",
          isGround: false,
          pose: { position: [0, 0], angle: 0 },
          shape: { kind: "bar" },
          sites: [],
        },
      ],
      markers: [
        { id: "near", name: "", linkId: "l1", local: [0, 0] },
        { id: "far", name: "", linkId: "l1", local: [3, 0] },
      ],
    });
    const result = hitTest(d, { x: 0.1, y: 0 }, 5);
    expect(result).toEqual({ kind: "marker", markerId: "near" });
  });
});

describe("entitiesInBox", () => {
  it("includes a non-ground link only when every site (and plate outline vertex) lies inside the box", () => {
    const box = { min: { x: -5, y: -20 }, max: { x: 45, y: 20 } };
    const ids = entitiesInBox(fourBar, box);
    expect(ids).toContain("crank"); // sites (0,0),(40,0) both inside
    expect(ids).not.toContain("coupler"); // outline vertex at world x=70 is outside
    expect(ids).not.toContain("ground"); // ground is never included
  });

  it("includes a plate link only when the whole outline is inside", () => {
    const box = { min: { x: -5, y: -20 }, max: { x: 75, y: 20 } };
    const ids = entitiesInBox(fourBar, box);
    expect(ids).toContain("coupler");
  });

  it("includes markers inside the box", () => {
    const box = { min: { x: 50, y: -5 }, max: { x: 60, y: 5 } };
    const ids = entitiesInBox(fourBar, box);
    expect(ids).toContain("marker1");
  });

  it("includes joints with at least one site inside the box", () => {
    const box = { min: { x: 35, y: -5 }, max: { x: 45, y: 5 } };
    const ids = entitiesInBox(fourBar, box);
    expect(ids).toContain("jointA");
  });

  it("excludes everything for a box that contains nothing", () => {
    const box = { min: { x: 1000, y: 1000 }, max: { x: 1001, y: 1001 } };
    expect(entitiesInBox(fourBar, box)).toEqual([]);
  });

  it("skips a joint whose sites do not resolve (defensive)", () => {
    const withDangling: MechanismDocument = {
      ...fourBar,
      joints: [
        ...fourBar.joints,
        { id: "dangling-joint", name: "", type: "R", siteA: "no-such-a", siteB: "no-such-b" },
      ],
    };
    const box = { min: { x: -1000, y: -1000 }, max: { x: 1000, y: 1000 } };
    expect(entitiesInBox(withDangling, box)).not.toContain("dangling-joint");
  });
});

describe("sitesNear", () => {
  it("returns every site within radius, nearest first", () => {
    // gO2 (ground, world (0,0)) and cO2 (crank, world (0,0)) coincide.
    const results = sitesNear(fourBar, { x: 0.1, y: 0 }, 1);
    expect(results.map((r) => r.siteId).sort()).toEqual(["cO2", "gO2"]);
    expect(results.every((r) => r.distance <= 1)).toBe(true);
  });

  it("marks isGround per the owning link", () => {
    const results = sitesNear(fourBar, { x: 0, y: 0 }, 1);
    const ground = results.find((r) => r.siteId === "gO2");
    const moving = results.find((r) => r.siteId === "cO2");
    expect(ground?.isGround).toBe(true);
    expect(moving?.isGround).toBe(false);
  });

  it("sorts nearest-first", () => {
    const d = doc({
      links: [
        {
          id: "l1",
          name: "l1",
          isGround: false,
          pose: { position: [0, 0], angle: 0 },
          shape: { kind: "bar" },
          sites: [
            { id: "far", local: [3, 0] },
            { id: "near", local: [1, 0] },
          ],
        },
      ],
    });
    const results = sitesNear(d, { x: 0, y: 0 }, 5);
    expect(results.map((r) => r.siteId)).toEqual(["near", "far"]);
  });

  it("breaks equal-distance ties by document order (stable sort)", () => {
    const d = doc({
      links: [
        {
          id: "l1",
          name: "l1",
          isGround: false,
          pose: { position: [0, 0], angle: 0 },
          shape: { kind: "bar" },
          sites: [
            { id: "first", local: [1, 0] },
            { id: "second", local: [-1, 0] },
          ],
        },
      ],
    });
    const results = sitesNear(d, { x: 0, y: 0 }, 5);
    expect(results.map((r) => r.siteId)).toEqual(["first", "second"]);
  });

  it("returns an empty array when nothing is within radius", () => {
    expect(sitesNear(fourBar, { x: 9999, y: 9999 }, 1)).toEqual([]);
  });
});

describe("hitTest / sitesNear: options.poses (Phase 5 pose seam)", () => {
  // The coupler's reference pose is { position: [40, 0], angle: 0 }. Rotate
  // it 40 degrees about joint A (world (40, 0)) -- pA is the coupler's own
  // local origin, so its world position (the pivot) is unchanged by the
  // rotation, exactly like the research scenario ("rotated 40deg about
  // joint A").
  const angle40 = (40 * Math.PI) / 180;
  const posedCoupler: Pose = { position: [40, 0], angle: angle40 };
  const posedFourBar = new Map<Id, Pose>([["coupler", posedCoupler]]);

  function rotate40(local: readonly [number, number]): { x: number; y: number } {
    const cos = Math.cos(angle40);
    const sin = Math.sin(angle40);
    return {
      x: 40 + local[0] * cos - local[1] * sin,
      y: 0 + local[0] * sin + local[1] * cos,
    };
  }

  it("hits the posed coupler body where the reference-pose body is not", () => {
    const posedBodyPoint = rotate40([15, 3]);

    const posed = hitTest(fourBar, posedBodyPoint, 1, { poses: posedFourBar });
    expect(posed).toEqual({ kind: "link", linkId: "coupler" });

    const unposed = hitTest(fourBar, posedBodyPoint, 1);
    expect(unposed).toEqual({ kind: "none" });
  });

  it("a posed marker hit wins over the body, at its posed world position", () => {
    // marker1 is at coupler local [15, 0].
    const posedMarkerPoint = rotate40([15, 0]);

    const posed = hitTest(fourBar, posedMarkerPoint, 1, { poses: posedFourBar });
    expect(posed).toEqual({ kind: "marker", markerId: "marker1" });

    // Reference-pose marker1 world position (55, 0) is far from the posed point.
    const unposed = hitTest(fourBar, posedMarkerPoint, 1);
    expect(unposed).not.toEqual({ kind: "marker", markerId: "marker1" });
  });

  // A dedicated fixture isolates "site"/"joint" pose-following: two links
  // joined by an R joint whose sites coincide only at the reference pose.
  const posedDoc = doc({
    links: [
      {
        id: "ground",
        name: "ground",
        isGround: true,
        pose: { position: [0, 0], angle: 0 },
        shape: { kind: "bar" },
        sites: [
          { id: "gFar", local: [0, 0] },
          { id: "gPin", local: [10, 0] },
        ],
      },
      {
        id: "mover",
        name: "mover",
        isGround: false,
        pose: { position: [10, 0], angle: 0 },
        shape: { kind: "bar" },
        sites: [
          { id: "mPin", local: [0, 0] },
          { id: "mFree", local: [5, 0] },
        ],
      },
    ],
    joints: [{ id: "pinJ", type: "R", siteA: "gPin", siteB: "mPin" }],
  });
  const posedMover: Pose = { position: [10, 8], angle: Math.PI / 2 };
  const posedMoverMap = new Map<Id, Pose>([["mover", posedMover]]);

  it("a posed site (no joint) hit uses the posed position, and misses at the reference position", () => {
    // mFree local [5, 0], rotated 90deg about (10, 8) -> world (10, 13).
    const posed = hitTest(posedDoc, { x: 10, y: 13 }, 1, { poses: posedMoverMap });
    expect(posed).toEqual({ kind: "site", siteId: "mFree", linkId: "mover" });

    const unposed = hitTest(posedDoc, { x: 10, y: 13 }, 1);
    expect(unposed).toEqual({ kind: "none" });
  });

  it("a posed joint hit uses the posed position, and misses where the reference joint used to be", () => {
    // mPin local [0, 0] is the mover's own local origin -> posed world (10, 8).
    const posed = hitTest(posedDoc, { x: 10, y: 8 }, 1, { poses: posedMoverMap });
    expect(posed).toEqual({ kind: "joint", jointId: "pinJ", siteId: "mPin", linkId: "mover" });

    // At the reference pose, mPin coincides with gPin at (10, 0), not (10, 8).
    const unposed = hitTest(posedDoc, { x: 10, y: 8 }, 1);
    expect(unposed).toEqual({ kind: "none" });
  });

  it("links missing from the pose map fall back to their own link.pose", () => {
    // "ground" is absent from posedMoverMap -- gFar must still resolve at
    // its reference position (0, 0), not move or disappear.
    const result = hitTest(posedDoc, { x: 0, y: 0 }, 1, { poses: posedMoverMap });
    expect(result).toEqual({ kind: "site", siteId: "gFar", linkId: "ground" });
  });

  it("sitesNear uses posed positions and returns the posed point value", () => {
    const results = sitesNear(posedDoc, { x: 10, y: 13 }, 1, { poses: posedMoverMap });
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ siteId: "mFree", linkId: "mover" });
    expect(results[0].point.x).toBeCloseTo(10, 9);
    expect(results[0].point.y).toBeCloseTo(13, 9);
  });

  it("sitesNear with no options behaves exactly as before (reference poses)", () => {
    const results = sitesNear(posedDoc, { x: 10, y: 0 }, 1);
    expect(results.map((r) => r.siteId).sort()).toEqual(["gPin", "mPin"]);
  });
});
