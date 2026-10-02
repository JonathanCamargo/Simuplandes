import { describe, expect, it } from "vitest";
import { documentFromEdges } from "./__fixtures__/fromEdges";
import { fromDocument } from "./fromDocument";
import { ATLAS_TOPOLOGIES } from "./atlasData";
import { GROUND_NODE_ID, type GraphEdge, type GraphNode, type LinkGraph } from "./types";
import {
  layoutGraph,
  GRAPH_NODE_RADIUS,
  GRAPH_GROUND_HALF_SIDE,
  GRAPH_NODE_RING_PAD,
  GRAPH_NODE_FOOTPRINT_RADIUS,
  MIN_NODE_SEPARATION,
  type GraphLayoutKind,
  type NodePosition,
} from "./layouts";
import type { Id } from "../model";
import type { LinkType } from "../ui/theme/tokens";

const KINDS: GraphLayoutKind[] = ["spatial", "circular", "layered"];
const MARGIN = 0.08;

const WATT_EDGES: [number, number][] = [
  [0, 1],
  [0, 2],
  [0, 3],
  [1, 4],
  [2, 5],
  [3, 4],
  [3, 5],
];
const STEPHENSON_EDGES: [number, number][] = [
  [0, 1],
  [0, 2],
  [0, 3],
  [1, 4],
  [2, 5],
  [4, 5],
  [3, 4],
];

/** Hand-built `LinkGraph` fixture for structural edge cases layouts.ts must handle directly (no document round-trip needed). */
function makeLinkGraph(
  nodeDefs: readonly { id: Id; isGround?: boolean; centroid?: { x: number; y: number } }[],
  edgeDefs: readonly (readonly [Id, Id])[],
): LinkGraph {
  const degreeById = new Map<Id, number>();
  const edges: GraphEdge[] = edgeDefs.map(([a, b], i) => {
    degreeById.set(a, (degreeById.get(a) ?? 0) + 1);
    degreeById.set(b, (degreeById.get(b) ?? 0) + 1);
    return { id: `e${i}`, jointId: `e${i}`, type: "R", a, b, groundPivot: false };
  });
  const nodeById = new Map<Id, GraphNode>();
  const nodeIdOfLink = new Map<Id, Id>();
  const nodes: GraphNode[] = nodeDefs.map((def) => {
    const linkType: LinkType = def.isGround ? "ground" : "binary";
    const node: GraphNode = {
      id: def.id,
      linkIds: [def.id],
      isGround: def.isGround ?? false,
      linkType,
      degree: degreeById.get(def.id) ?? 0,
      label: def.id,
      centroid: def.centroid ?? { x: 0, y: 0 },
    };
    nodeById.set(def.id, node);
    nodeIdOfLink.set(def.id, def.id);
    return node;
  });
  return { nodes, edges, jointCount: edges.length, warnings: [], nodeById, nodeIdOfLink };
}

interface Fixture {
  name: string;
  graph: LinkGraph;
}

const fourBarGraph = fromDocument(
  documentFromEdges([
    [0, 1],
    [1, 2],
    [2, 3],
    [3, 0],
  ]).doc,
);
const wattGraph = fromDocument(documentFromEdges(WATT_EDGES).doc);
const stephensonGraph = fromDocument(documentFromEdges(STEPHENSON_EDGES).doc);
/** The SC-3 rigid-triangle fixture (a triangle riveted onto a four-bar's node 2): L2/L3 were the real-geometry pair that visually overlapped under the old flat 0.05 separation floor. */
const SC3_EDGES: [number, number][] = [
  [0, 1],
  [1, 2],
  [2, 3],
  [3, 0],
  [2, 4],
  [4, 5],
  [5, 2],
];
const sc3Graph = fromDocument(documentFromEdges(SC3_EDGES).doc);
const eightBarFixtures: Fixture[] = ATLAS_TOPOLOGIES.filter((t) => t.nLinks === 8).map((t) => ({
  name: `eightBar:${t.id}`,
  graph: fromDocument(documentFromEdges(t.graph.edges).doc),
}));

const disconnectedGraph = makeLinkGraph(
  [{ id: "ground", isGround: true }, { id: "a" }, { id: "b" }, { id: "c" }, { id: "isolated" }],
  [
    ["ground", "a"],
    ["a", "b"],
    ["b", "c"],
    ["c", "ground"],
  ],
);

const noGroundGraph = makeLinkGraph(
  [{ id: "n0" }, { id: "n1" }, { id: "n2" }, { id: "n3" }],
  [
    ["n0", "n1"],
    ["n1", "n2"],
    ["n2", "n3"],
    ["n3", "n0"],
  ],
);

const singleNodeGraph = makeLinkGraph([{ id: "only", isGround: true }], []);
const emptyGraph = makeLinkGraph([], []);

const coincidentCentroidsGraph = makeLinkGraph(
  [
    { id: "p", centroid: { x: 3, y: 3 } },
    { id: "q", centroid: { x: 3, y: 3 } },
    { id: "r", centroid: { x: 10, y: -4 } },
  ],
  [
    ["p", "q"],
    ["q", "r"],
  ],
);

const verticallyColinearGraph = makeLinkGraph(
  [
    { id: "top", centroid: { x: 4, y: 4 } },
    { id: "bottom", centroid: { x: 4, y: -4 } },
  ],
  [["top", "bottom"]],
);

const horizontallyColinearGraph = makeLinkGraph(
  [
    { id: "left", centroid: { x: -4, y: 4 } },
    { id: "right", centroid: { x: 4, y: 4 } },
  ],
  [["left", "right"]],
);

const aspectRatioGraph = makeLinkGraph(
  [
    { id: "o", centroid: { x: 0, y: 0 } },
    { id: "x", centroid: { x: 10, y: 0 } },
    { id: "y", centroid: { x: 0, y: 5 } },
  ],
  [],
);

const fixtures: Fixture[] = [
  { name: "fourBar", graph: fourBarGraph },
  { name: "watt", graph: wattGraph },
  { name: "stephenson", graph: stephensonGraph },
  { name: "sc3Triangle", graph: sc3Graph },
  ...eightBarFixtures,
  { name: "disconnected", graph: disconnectedGraph },
  { name: "noGround", graph: noGroundGraph },
  { name: "singleNode", graph: singleNodeGraph },
  { name: "empty", graph: emptyGraph },
  { name: "coincidentCentroids", graph: coincidentCentroidsGraph },
  { name: "aspectRatio", graph: aspectRatioGraph },
  { name: "verticallyColinear", graph: verticallyColinearGraph },
  { name: "horizontallyColinear", graph: horizontallyColinearGraph },
];

function pairwiseDistances(map: ReadonlyMap<Id, NodePosition>): number[] {
  const points = Array.from(map.values());
  const dists: number[] = [];
  for (let i = 0; i < points.length; i += 1) {
    for (let j = i + 1; j < points.length; j += 1) {
      dists.push(Math.hypot(points[i].x - points[j].x, points[i].y - points[j].y));
    }
  }
  return dists;
}

describe("layoutGraph: universal properties (every fixture x every kind)", () => {
  for (const fixture of fixtures) {
    for (const kind of KINDS) {
      it(`${fixture.name} / ${kind}: every node has a finite, in-box position`, () => {
        const map = layoutGraph(fixture.graph, kind);
        expect(map.size).toBe(fixture.graph.nodes.length);
        for (const node of fixture.graph.nodes) {
          const pos = map.get(node.id);
          expect(pos, `missing position for ${node.id}`).toBeDefined();
          if (!pos) continue;
          expect(Number.isFinite(pos.x)).toBe(true);
          expect(Number.isFinite(pos.y)).toBe(true);
          expect(pos.x).toBeGreaterThanOrEqual(MARGIN - 1e-9);
          expect(pos.x).toBeLessThanOrEqual(1 - MARGIN + 1e-9);
          expect(pos.y).toBeGreaterThanOrEqual(MARGIN - 1e-9);
          expect(pos.y).toBeLessThanOrEqual(1 - MARGIN + 1e-9);
        }
      });

      it(`${fixture.name} / ${kind}: pairwise distances are >= MIN_NODE_SEPARATION`, () => {
        const map = layoutGraph(fixture.graph, kind);
        for (const dist of pairwiseDistances(map)) {
          expect(dist).toBeGreaterThanOrEqual(MIN_NODE_SEPARATION - 1e-9);
        }
      });

      it(`${fixture.name} / ${kind}: deterministic across calls`, () => {
        const a = layoutGraph(fixture.graph, kind);
        const b = layoutGraph(fixture.graph, kind);
        expect(a.size).toBe(b.size);
        for (const [id, pos] of a) {
          expect(b.get(id)).toEqual(pos);
        }
      });
    }
  }

  it("empty graph -> empty map, for every kind", () => {
    for (const kind of KINDS) {
      expect(layoutGraph(emptyGraph, kind).size).toBe(0);
    }
  });

  it("single node -> box center, for every kind", () => {
    for (const kind of KINDS) {
      const map = layoutGraph(singleNodeGraph, kind);
      expect(map.size).toBe(1);
      expect(map.get("only")).toEqual({ x: 0.5, y: 0.5 });
    }
  });
});

describe("layouts.ts: geometry constants relation (cannot drift from GraphSvg's own drawing sizes)", () => {
  it("GRAPH_NODE_FOOTPRINT_RADIUS is at least the ground square's half-diagonal plus its issue ring pad", () => {
    expect(GRAPH_NODE_FOOTPRINT_RADIUS).toBeGreaterThanOrEqual(
      GRAPH_GROUND_HALF_SIDE * Math.SQRT2 + GRAPH_NODE_RING_PAD,
    );
    // Also at least the plain circle radius plus its ring pad.
    expect(GRAPH_NODE_FOOTPRINT_RADIUS).toBeGreaterThanOrEqual(
      GRAPH_NODE_RADIUS + GRAPH_NODE_RING_PAD,
    );
    // MIN_NODE_SEPARATION is exactly twice the footprint radius plus the gap.
    expect(MIN_NODE_SEPARATION).toBeGreaterThan(2 * GRAPH_NODE_FOOTPRINT_RADIUS);
  });
});

describe("layoutGraph: LayoutOptions.minSeparation (06-09)", () => {
  const optionFixtures: Fixture[] = [
    { name: "fourBar", graph: fourBarGraph },
    { name: "watt", graph: wattGraph },
    { name: "stephenson", graph: stephensonGraph },
    { name: "sc3Triangle", graph: sc3Graph },
  ];

  it("no options is byte-identical to the pre-06-09 default behavior", () => {
    for (const fixture of optionFixtures) {
      for (const kind of KINDS) {
        const withoutOptions = layoutGraph(fixture.graph, kind);
        const withEmptyOptions = layoutGraph(fixture.graph, kind, {});
        expect(withEmptyOptions).toEqual(withoutOptions);
      }
    }
  });

  for (const fixture of optionFixtures) {
    for (const kind of KINDS) {
      it(`${fixture.name} / ${kind}: { minSeparation: 0.2 } enforces >= 0.2 pairwise and stays in-box`, () => {
        const map = layoutGraph(fixture.graph, kind, { minSeparation: 0.2 });
        expect(map.size).toBe(fixture.graph.nodes.length);
        for (const pos of map.values()) {
          expect(pos.x).toBeGreaterThanOrEqual(MARGIN - 1e-9);
          expect(pos.x).toBeLessThanOrEqual(1 - MARGIN + 1e-9);
          expect(pos.y).toBeGreaterThanOrEqual(MARGIN - 1e-9);
          expect(pos.y).toBeLessThanOrEqual(1 - MARGIN + 1e-9);
        }
        for (const dist of pairwiseDistances(map)) {
          expect(dist).toBeGreaterThanOrEqual(0.2 - 1e-9);
        }
      });
    }
  }
});

describe("layoutGraph: spatial", () => {
  it("preserves the four-bar's x ordering and flips y (world y-up -> SVG y-down)", () => {
    const map = layoutGraph(fourBarGraph, "spatial");
    const byCentroidX = fourBarGraph.nodes
      .slice()
      .sort((a, b) => a.centroid.x - b.centroid.x)
      .map((n) => n.id);
    const byPositionX = fourBarGraph.nodes
      .slice()
      .sort((a, b) => (map.get(a.id)?.x ?? 0) - (map.get(b.id)?.x ?? 0))
      .map((n) => n.id);
    expect(byPositionX).toEqual(byCentroidX);

    const byCentroidY = fourBarGraph.nodes
      .slice()
      .sort((a, b) => a.centroid.y - b.centroid.y)
      .map((n) => n.id);
    const byPositionYDescending = fourBarGraph.nodes
      .slice()
      .sort((a, b) => (map.get(b.id)?.y ?? 0) - (map.get(a.id)?.y ?? 0))
      .map((n) => n.id);
    // Highest world y (top) -> smallest SVG y (top of the box): flipped.
    expect(byPositionYDescending).toEqual(byCentroidY);
  });

  it("uses one uniform scale, preserving the centroid cloud's aspect ratio", () => {
    const map = layoutGraph(aspectRatioGraph, "spatial");
    const o = map.get("o")!;
    const x = map.get("x")!;
    const y = map.get("y")!;
    const distOX = Math.hypot(x.x - o.x, x.y - o.y);
    const distOY = Math.hypot(y.x - o.x, y.y - o.y);
    // World distances were 10 (o->x) and 5 (o->y): ratio 2:1 must survive a uniform scale.
    expect(distOX / distOY).toBeCloseTo(2, 5);
  });

  it("separates coincident centroids deterministically, still >= MIN_NODE_SEPARATION apart", () => {
    const map = layoutGraph(coincidentCentroidsGraph, "spatial");
    const p = map.get("p")!;
    const q = map.get("q")!;
    expect(Math.hypot(p.x - q.x, p.y - q.y)).toBeGreaterThanOrEqual(MIN_NODE_SEPARATION - 1e-9);
    const again = layoutGraph(coincidentCentroidsGraph, "spatial");
    expect(again.get("p")).toEqual(p);
    expect(again.get("q")).toEqual(q);
  });

  it("colinear extents (zero range on one axis) scale using the other axis only", () => {
    const vertical = layoutGraph(verticallyColinearGraph, "spatial");
    const top = vertical.get("top")!;
    const bottom = vertical.get("bottom")!;
    expect(top.x).toBeCloseTo(bottom.x, 9);
    expect(Math.abs(top.y - bottom.y)).toBeGreaterThan(0);

    const horizontal = layoutGraph(horizontallyColinearGraph, "spatial");
    const left = horizontal.get("left")!;
    const right = horizontal.get("right")!;
    expect(left.y).toBeCloseTo(right.y, 9);
    expect(Math.abs(left.x - right.x)).toBeGreaterThan(0);
  });

  it("degenerate extent (all centroids equal) collapses toward the box center", () => {
    const allEqual = makeLinkGraph(
      [
        { id: "a", centroid: { x: 5, y: 5 } },
        { id: "b", centroid: { x: 5, y: 5 } },
        { id: "c", centroid: { x: 5, y: 5 } },
      ],
      [],
    );
    const map = layoutGraph(allEqual, "spatial");
    for (const pos of map.values()) {
      expect(Math.hypot(pos.x - 0.5, pos.y - 0.5)).toBeLessThan(0.2);
    }
  });
});

describe("layoutGraph: circular", () => {
  it("places every node equidistant from the box center", () => {
    const map = layoutGraph(stephensonGraph, "circular");
    const distances = Array.from(map.values()).map((p) => Math.hypot(p.x - 0.5, p.y - 0.5));
    for (const d of distances) {
      expect(Math.abs(d - distances[0])).toBeLessThan(1e-9);
    }
  });

  it("puts the ground node at the top (smallest y, x = 0.5)", () => {
    const map = layoutGraph(fourBarGraph, "circular");
    const ground = map.get(GROUND_NODE_ID)!;
    expect(ground.x).toBeCloseTo(0.5, 9);
    const minY = Math.min(...Array.from(map.values()).map((p) => p.y));
    expect(ground.y).toBeCloseTo(minY, 9);
  });

  it("orders the remaining nodes by BFS from ground, then unreachable nodes in doc order", () => {
    const map = layoutGraph(disconnectedGraph, "circular");
    const n = disconnectedGraph.nodes.length;
    const isolated = map.get("isolated")!;
    // The isolated node is unreachable from ground: it must land last (theta closest to a full turn).
    const thetaOf = (p: NodePosition): number => Math.atan2(p.x - 0.5, -(p.y - 0.5));
    let theta = thetaOf(isolated);
    if (theta < 0) theta += 2 * Math.PI;
    expect(theta).toBeCloseTo((2 * Math.PI * (n - 1)) / n, 6);
  });

  it("no ground -> BFS from the first node", () => {
    const map = layoutGraph(noGroundGraph, "circular");
    const first = map.get("n0")!;
    expect(first.x).toBeCloseTo(0.5, 9);
    const minY = Math.min(...Array.from(map.values()).map((p) => p.y));
    expect(first.y).toBeCloseTo(minY, 9);
  });
});

describe("layoutGraph: layered", () => {
  it("puts ground at layer 0 (top), y strictly increasing with BFS depth", () => {
    const map = layoutGraph(stephensonGraph, "layered");
    const ground = map.get(GROUND_NODE_ID)!;
    const minY = Math.min(...Array.from(map.values()).map((p) => p.y));
    expect(ground.y).toBeCloseTo(minY, 9);

    // Recompute BFS depth independently to check monotonicity.
    const adjacency = new Map<Id, Id[]>();
    for (const node of stephensonGraph.nodes) adjacency.set(node.id, []);
    for (const edge of stephensonGraph.edges) {
      adjacency.get(edge.a)?.push(edge.b);
      adjacency.get(edge.b)?.push(edge.a);
    }
    const depth = new Map<Id, number>([[GROUND_NODE_ID, 0]]);
    const queue = [GROUND_NODE_ID];
    let qi = 0;
    while (qi < queue.length) {
      const current = queue[qi];
      qi += 1;
      for (const neighbor of adjacency.get(current) ?? []) {
        if (!depth.has(neighbor)) {
          depth.set(neighbor, (depth.get(current) ?? 0) + 1);
          queue.push(neighbor);
        }
      }
    }
    for (const [idA, depthA] of depth) {
      for (const [idB, depthB] of depth) {
        if (depthA < depthB) {
          expect(map.get(idA)!.y).toBeLessThan(map.get(idB)!.y);
        }
      }
    }
  });

  it("unreachable nodes land in one final layer, at the bottom", () => {
    const map = layoutGraph(disconnectedGraph, "layered");
    const isolatedY = map.get("isolated")!.y;
    const maxOtherY = Math.max(
      ...disconnectedGraph.nodes.filter((n) => n.id !== "isolated").map((n) => map.get(n.id)!.y),
    );
    expect(isolatedY).toBeGreaterThan(maxOtherY);
  });

  it("no ground -> BFS from the first node", () => {
    const map = layoutGraph(noGroundGraph, "layered");
    const first = map.get("n0")!;
    const minY = Math.min(...Array.from(map.values()).map((p) => p.y));
    expect(first.y).toBeCloseTo(minY, 9);
  });

  it("Stephenson: the barycenter heuristic produces zero crossings between consecutive layers, or is at least deterministic", () => {
    const map = layoutGraph(stephensonGraph, "layered");
    const layerOf = new Map<Id, number>();
    for (const [id, pos] of map) {
      layerOf.set(id, Math.round((pos.y - MARGIN) / ((1 - 2 * MARGIN) / 10000)));
    }
    let crossings = 0;
    const edgesBetweenConsecutiveLayers = stephensonGraph.edges.filter(
      (e) => Math.abs((layerOf.get(e.a) ?? 0) - (layerOf.get(e.b) ?? 0)) > 0,
    );
    for (let i = 0; i < edgesBetweenConsecutiveLayers.length; i += 1) {
      for (let j = i + 1; j < edgesBetweenConsecutiveLayers.length; j += 1) {
        const e1 = edgesBetweenConsecutiveLayers[i];
        const e2 = edgesBetweenConsecutiveLayers[j];
        const a1 = map.get(e1.a)!;
        const b1 = map.get(e1.b)!;
        const a2 = map.get(e2.a)!;
        const b2 = map.get(e2.b)!;
        // Only meaningful for edges sharing the same pair of layers.
        const layers1 = [layerOf.get(e1.a), layerOf.get(e1.b)].sort();
        const layers2 = [layerOf.get(e2.a), layerOf.get(e2.b)].sort();
        if (layers1[0] !== layers2[0] || layers1[1] !== layers2[1]) continue;
        const topX1 = a1.y < b1.y ? a1.x : b1.x;
        const bottomX1 = a1.y < b1.y ? b1.x : a1.x;
        const topX2 = a2.y < b2.y ? a2.x : b2.x;
        const bottomX2 = a2.y < b2.y ? b2.x : a2.x;
        if ((topX1 - topX2) * (bottomX1 - bottomX2) < 0) crossings += 1;
      }
    }
    if (crossings > 0) {
      // Heuristic can't avoid every crossing on every fixture -- fall back
      // to determinism, already proven by the universal test block above.
      expect(layoutGraph(stephensonGraph, "layered")).toEqual(map);
    } else {
      expect(crossings).toBe(0);
    }
  });
});
