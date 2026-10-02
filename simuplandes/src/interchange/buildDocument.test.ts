import { describe, it, expect } from "vitest";
import { rotate, vec2 } from "../geom";
import { indexDocument, siteWorldPosition, type MechanismDocument } from "../model";
import { buildStudioDocument, convexHull, type StudioBuildInput } from "./buildDocument";
import type { StudioBuildEdge } from "./buildDocument";

function input(
  edges: readonly StudioBuildEdge[],
  overrides: Partial<StudioBuildInput> = {},
): StudioBuildInput {
  const nodeCount = edges.reduce((m, e) => Math.max(m, e.u, e.v), 0) + 1;
  return {
    name: "test",
    units: null,
    nodeCount,
    linkNames: Array.from({ length: nodeCount }, () => null),
    edges,
    inputEdge: null,
    markers: [],
    ...overrides,
  };
}

const r = (u: number, v: number, pos: [number, number]): StudioBuildEdge => ({
  u,
  v,
  kind: "R",
  axis: null,
  pos,
});

const FOUR_BAR: StudioBuildEdge[] = [
  r(0, 1, [0, 0]),
  r(0, 3, [100, 0]),
  r(1, 2, [20, 34.64101615137754]),
  r(2, 3, [110, 80]),
];

function worldPoint(doc: MechanismDocument, siteId: string): [number, number] {
  const info = indexDocument(doc).sites.get(siteId)!;
  const p = siteWorldPosition(info.link, info.site.local);
  return [p.x, p.y];
}

describe("buildStudioDocument: poses and sites", () => {
  const doc = buildStudioDocument(input(FOUR_BAR, { inputEdge: 0 }));

  it("anchors each moving link at its first site, angled toward the second", () => {
    const crank = doc.links.find((l) => l.name === "link-1")!;
    expect(crank.pose.position).toEqual([0, 0]);
    expect(crank.pose.angle).toBeCloseTo(Math.atan2(34.64101615137754, 20), 12);
    const rocker = doc.links.find((l) => l.name === "link-3")!;
    expect(rocker.pose.position).toEqual([100, 0]);
    const ground = doc.links.find((l) => l.isGround)!;
    expect(ground.pose).toEqual({ position: [0, 0], angle: 0 });
  });

  it("keeps every joint site at the input pos within 1e-12", () => {
    doc.joints.forEach((joint, i) => {
      for (const siteId of [joint.siteA, joint.siteB]) {
        const p = worldPoint(doc, siteId);
        expect(Math.abs(p[0] - FOUR_BAR[i].pos[0])).toBeLessThan(1e-12);
        expect(Math.abs(p[1] - FOUR_BAR[i].pos[1])).toBeLessThan(1e-12);
      }
    });
  });

  it("names joints and sites and puts siteA on the lower node", () => {
    expect(doc.joints.map((j) => j.name)).toEqual(["0-1", "0-3", "1-2", "2-3"]);
    const index = indexDocument(doc);
    expect(index.sites.get(doc.joints[2].siteA)?.link.name).toBe("link-1");
    expect(index.sites.get(doc.joints[2].siteA)?.site.name).toBe("n2");
  });

  it("makes every two-site link a bar", () => {
    expect(doc.links.every((l) => l.shape.kind === "bar")).toBe(true);
  });

  it("adds exactly one rotary motor on the input edge", () => {
    expect(doc.motors).toHaveLength(1);
    expect(doc.motors[0]).toMatchObject({
      jointId: doc.joints[0].id,
      kind: "rotary",
      drive: { mode: "constant", speed: 1 },
    });
  });

  it("adds no motor without an input edge", () => {
    expect(buildStudioDocument(input(FOUR_BAR)).motors).toEqual([]);
  });
});

describe("buildStudioDocument: shapes", () => {
  it("builds a plate from the convex hull for 3+ distinct sites", () => {
    const doc = buildStudioDocument(
      input([
        r(0, 1, [0, 0]),
        r(1, 2, [40, 0]),
        r(1, 3, [20, 30]),
        r(0, 2, [100, 0]),
        r(0, 3, [60, 80]),
      ]),
    );
    const plate = doc.links.find((l) => l.name === "link-1")!;
    expect(plate.shape.kind).toBe("plate");
    if (plate.shape.kind === "plate") expect(plate.shape.outline).toHaveLength(3);
  });

  it("falls back to a non-degenerate triangle for a collinear 3-site link", () => {
    const doc = buildStudioDocument(input([r(0, 1, [0, 0]), r(1, 2, [10, 0]), r(1, 3, [20, 0])]));
    const link = doc.links.find((l) => l.name === "link-1")!;
    expect(link.shape.kind).toBe("plate");
    if (link.shape.kind === "plate") {
      const [a, b, c] = link.shape.outline;
      const area = Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])) / 2;
      expect(area).toBeGreaterThan(1);
    }
  });

  it("treats coincident sites as one position (bar)", () => {
    const doc = buildStudioDocument(input([r(0, 1, [5, 5]), r(1, 2, [5, 5]), r(0, 2, [50, 0])]));
    const link = doc.links.find((l) => l.name === "link-1")!;
    expect(link.shape.kind).toBe("bar");
    expect(link.pose).toEqual({ position: [5, 5], angle: 0 });
  });
});

describe("buildStudioDocument: prismatic joints", () => {
  it("keeps a ground-owned axis and gives the block link angle 0", () => {
    const doc = buildStudioDocument(
      input(
        [
          r(0, 1, [0, 0]),
          { u: 0, v: 3, kind: "P", axis: [1, 0], pos: [154.22, 10] },
          r(1, 2, [34.64, 20]),
          r(2, 3, [154.22, 10]),
        ],
        { inputEdge: 0 },
      ),
    );
    const prismatic = doc.joints.find((j) => j.type === "P")!;
    expect(prismatic.type === "P" && prismatic.axis).toEqual([1, 0]);
    const block = doc.links.find((l) => l.name === "link-3")!;
    expect(block.pose).toEqual({ position: [154.22, 10], angle: 0 });
  });

  it("expresses a moving-owner axis in the owner's local frame", () => {
    const world: [number, number] = [0.2773500981126146, 0.9607689228305228];
    const doc = buildStudioDocument(
      input([
        r(0, 1, [0, 0]),
        r(0, 2, [0, -100]),
        r(1, 3, [34.64, 20]),
        { u: 2, v: 3, kind: "P", axis: world, pos: [34.64, 20] },
      ]),
    );
    const prismatic = doc.joints.find((j) => j.type === "P")!;
    const owner = doc.links.find((l) => l.name === "link-2")!;
    expect(owner.pose.angle).not.toBe(0);
    if (prismatic.type !== "P") throw new Error("expected P");
    const back = rotate(vec2(prismatic.axis[0], prismatic.axis[1]), owner.pose.angle);
    expect(back.x).toBeCloseTo(world[0], 12);
    expect(back.y).toBeCloseTo(world[1], 12);
  });

  it("uses a linear motor for a prismatic input edge and defaults a missing axis to (1, 0)", () => {
    const doc = buildStudioDocument(
      input(
        [{ u: 0, v: 1, kind: "P", axis: null, pos: [0, 0] }, r(1, 2, [0, 0]), r(0, 2, [50, 0])],
        { inputEdge: 0 },
      ),
    );
    expect(doc.motors[0].kind).toBe("linear");
    const p = doc.joints[0];
    expect(p.type === "P" && p.axis).toEqual([1, 0]);
  });
});

describe("buildStudioDocument: ground, markers, units", () => {
  it("creates several ground links for merged-ground names with a placeholder site", () => {
    const doc = buildStudioDocument(
      input(FOUR_BAR, { linkNames: [["g1", "g2"], ["a"], null, null], units: "m" }),
    );
    const grounds = doc.links.filter((l) => l.isGround);
    expect(grounds.map((l) => l.name)).toEqual(["g1", "g2"]);
    expect(grounds[1].sites).toHaveLength(1);
    expect(doc.links.find((l) => l.name === "a")).toBeDefined();
    expect(doc.units.length).toBe("m");
  });

  it("drops an unknown units label to the default", () => {
    expect(buildStudioDocument(input(FOUR_BAR, { units: "furlong" })).units.length).toBe("mm");
  });

  it("omits the ground link for an empty link_names with no joints on node 0", () => {
    const doc = buildStudioDocument(
      input([r(1, 2, [0, 0]), r(1, 3, [5, 5])], {
        nodeCount: 4,
        linkNames: [[], null, null, null],
      }),
    );
    expect(doc.links.some((l) => l.isGround)).toBe(false);
  });

  it("uses the default ground name for an empty link_names that has joints", () => {
    const doc = buildStudioDocument(input(FOUR_BAR, { linkNames: [[], null, null, null] }));
    expect(doc.links.filter((l) => l.isGround).map((l) => l.name)).toEqual(["link-0"]);
  });

  it("places markers link-locally and names them", () => {
    const doc = buildStudioDocument(
      input(FOUR_BAR, {
        markers: [
          { link: 2, pos: [51.5, 84.1], name: null },
          { link: 0, pos: [3, 4], name: "g" },
        ],
      }),
    );
    expect(doc.markers.map((m) => m.name)).toEqual(["marker-0", "g"]);
    const linkOfMarker = (i: number) => doc.links.find((l) => l.id === doc.markers[i].linkId)!;
    const p = siteWorldPosition(linkOfMarker(0), doc.markers[0].local);
    expect(p.x).toBeCloseTo(51.5, 12);
    expect(p.y).toBeCloseTo(84.1, 12);
    expect(linkOfMarker(1).isGround).toBe(true);
  });

  it("keeps an isolated node as a link with one anchor site", () => {
    const doc = buildStudioDocument(
      input([r(0, 1, [0, 0]), r(1, 2, [5, 0]), r(0, 2, [9, 9])], { nodeCount: 4 }),
    );
    const lone = doc.links.find((l) => l.name === "link-3")!;
    expect(lone.sites).toHaveLength(1);
  });

  it("throws loudly on a marker for an unknown node", () => {
    expect(() =>
      buildStudioDocument(input(FOUR_BAR, { markers: [{ link: 9, pos: [0, 0], name: null }] })),
    ).toThrow(/marker 0/);
  });

  it("builds a default ground for empty link_names and rejects a bad input edge", () => {
    expect(() =>
      buildStudioDocument(input([r(0, 1, [0, 0])], { nodeCount: 2, linkNames: [[], null] })),
    ).not.toThrow();
    expect(() => buildStudioDocument(input(FOUR_BAR, { inputEdge: 9 }))).toThrow(/no edge 9/);
  });
});

describe("convexHull", () => {
  it("returns the hull of a square with an interior point", () => {
    const hull = convexHull([
      [0, 0],
      [4, 0],
      [4, 4],
      [0, 4],
      [2, 2],
    ]);
    expect(hull).toHaveLength(4);
  });

  it("collapses collinear points to two", () => {
    expect(
      convexHull([
        [0, 0],
        [1, 0],
        [2, 0],
      ]),
    ).toHaveLength(2);
  });
});
