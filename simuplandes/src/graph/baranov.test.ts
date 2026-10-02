import { describe, expect, it } from "vitest";
import { documentFromEdges } from "./__fixtures__/fromEdges";
import { fromDocument } from "./fromDocument";
import { baranovCheck } from "./baranov";
import { GROUND_NODE_ID } from "./types";

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
  [3, 4],
  [4, 5],
];

// dms atlas.py's _TOPOLOGY_DATA: all 16 eight-bar topologies.
const EIGHT_BAR_EDGES: [number, number][][] = [
  [
    [0, 1],
    [0, 2],
    [0, 7],
    [1, 4],
    [1, 6],
    [2, 3],
    [2, 6],
    [3, 5],
    [3, 7],
    [4, 5],
  ],
  [
    [0, 1],
    [0, 3],
    [0, 6],
    [1, 5],
    [1, 7],
    [2, 4],
    [2, 5],
    [2, 6],
    [3, 4],
    [3, 7],
  ],
  [
    [0, 3],
    [0, 4],
    [0, 6],
    [1, 2],
    [1, 3],
    [1, 5],
    [2, 4],
    [2, 7],
    [3, 7],
    [5, 6],
  ],
  [
    [0, 2],
    [0, 6],
    [0, 7],
    [1, 3],
    [1, 4],
    [1, 6],
    [2, 4],
    [2, 5],
    [3, 5],
    [3, 7],
  ],
  [
    [0, 2],
    [0, 4],
    [0, 5],
    [1, 2],
    [1, 6],
    [1, 7],
    [2, 3],
    [3, 4],
    [3, 6],
    [5, 7],
  ],
  [
    [0, 1],
    [0, 3],
    [0, 4],
    [1, 2],
    [1, 7],
    [2, 3],
    [2, 5],
    [3, 6],
    [4, 5],
    [6, 7],
  ],
  [
    [0, 3],
    [0, 4],
    [0, 7],
    [1, 2],
    [1, 4],
    [1, 7],
    [2, 3],
    [2, 6],
    [3, 5],
    [5, 6],
  ],
  [
    [0, 1],
    [0, 3],
    [0, 6],
    [1, 2],
    [1, 7],
    [2, 3],
    [2, 4],
    [3, 5],
    [4, 5],
    [6, 7],
  ],
  [
    [0, 1],
    [0, 4],
    [0, 7],
    [1, 5],
    [1, 6],
    [2, 3],
    [2, 5],
    [2, 6],
    [3, 4],
    [3, 7],
  ],
  [
    [0, 1],
    [0, 3],
    [0, 5],
    [0, 6],
    [1, 2],
    [1, 4],
    [2, 3],
    [2, 7],
    [4, 6],
    [5, 7],
  ],
  [
    [0, 1],
    [0, 4],
    [0, 5],
    [0, 6],
    [1, 3],
    [1, 7],
    [2, 4],
    [2, 5],
    [2, 7],
    [3, 6],
  ],
  [
    [0, 1],
    [0, 2],
    [0, 3],
    [0, 6],
    [1, 4],
    [1, 7],
    [2, 4],
    [2, 5],
    [3, 7],
    [5, 6],
  ],
  [
    [0, 4],
    [0, 5],
    [0, 6],
    [0, 7],
    [1, 2],
    [1, 3],
    [1, 6],
    [2, 5],
    [2, 7],
    [3, 4],
  ],
  [
    [0, 3],
    [0, 5],
    [0, 6],
    [0, 7],
    [1, 3],
    [1, 4],
    [1, 6],
    [2, 4],
    [2, 5],
    [2, 7],
  ],
  [
    [0, 2],
    [0, 3],
    [0, 4],
    [0, 6],
    [1, 3],
    [1, 4],
    [1, 5],
    [1, 7],
    [2, 7],
    [5, 6],
  ],
  [
    [0, 1],
    [0, 3],
    [0, 5],
    [0, 7],
    [1, 2],
    [1, 4],
    [1, 6],
    [2, 5],
    [3, 4],
    [6, 7],
  ],
];

function checkFromEdges(
  edges: ReadonlyArray<readonly [number, number]>,
  options?: { ground?: readonly number[]; maxNodes?: number },
): ReturnType<typeof baranovCheck> {
  const { doc } = documentFromEdges(edges, options);
  return baranovCheck(
    fromDocument(doc),
    options?.maxNodes ? { maxNodes: options.maxNodes } : undefined,
  );
}

describe("baranovCheck", () => {
  it("passes for the four-bar, Watt and Stephenson six-bars", () => {
    expect(
      checkFromEdges([
        [0, 1],
        [1, 2],
        [2, 3],
        [3, 0],
      ]),
    ).toEqual({ status: "pass" });
    expect(checkFromEdges(WATT_EDGES)).toEqual({ status: "pass" });
    expect(checkFromEdges(STEPHENSON_EDGES)).toEqual({ status: "pass" });
  });

  it("passes for all 16 dms eight-bar topologies", () => {
    EIGHT_BAR_EDGES.forEach((edges, i) => {
      expect(checkFromEdges(edges), `T${i + 1}`).toEqual({ status: "pass" });
    });
  });

  it("SC-3 golden fixture: a triangle riveted onto a four-bar fails with exactly its 3 links, even though Gruebler F = 1", () => {
    const { doc, linkIdOf, jointIdOf } = documentFromEdges([
      [0, 1],
      [1, 2],
      [2, 3],
      [3, 0],
      [2, 4],
      [4, 5],
      [5, 2],
    ]);
    const g = fromDocument(doc);
    const result = baranovCheck(g);

    expect(result.status).toBe("fail");
    if (result.status !== "fail") return;
    expect(result.subsetSize).toBe(3);
    expect(result.subDof).toBe(0);
    expect(new Set(result.nodeIds)).toEqual(new Set([linkIdOf(2), linkIdOf(4), linkIdOf(5)]));
    expect(new Set(result.edgeIds)).toEqual(new Set([jointIdOf(4), jointIdOf(5), jointIdOf(6)]));
    expect(new Set(result.linkIds)).toEqual(new Set([linkIdOf(2), linkIdOf(4), linkIdOf(5)]));
  });

  it("reports the smaller triangle first (k ascending) even with a larger rigid 5-link subchain elsewhere", () => {
    const { doc, linkIdOf } = documentFromEdges([
      // Base four-bar + triangle on link 2 (SC-3's own fixture).
      [0, 1],
      [1, 2],
      [2, 3],
      [3, 0],
      [2, 4],
      [4, 5],
      [5, 2],
      // A disconnected K(2,3) Baranov 5-link truss (nodes 6,7 vs 8,9,10):
      // triangle-free, no k=3/k=4 violation of its own, only violates at k=5.
      [6, 8],
      [6, 9],
      [6, 10],
      [7, 8],
      [7, 9],
      [7, 10],
    ]);
    const g = fromDocument(doc);
    const result = baranovCheck(g);

    expect(result.status).toBe("fail");
    if (result.status !== "fail") return;
    expect(result.subsetSize).toBe(3);
    expect(new Set(result.nodeIds)).toEqual(new Set([linkIdOf(2), linkIdOf(4), linkIdOf(5)]));
  });

  it("expands a ground node in the violating subset to every ground link id", () => {
    const { doc } = documentFromEdges([
      [0, 1],
      [1, 2],
      [2, 0],
      [1, 3],
    ]);
    const g = fromDocument(doc);
    const result = baranovCheck(g);

    expect(result.status).toBe("fail");
    if (result.status !== "fail") return;
    expect(result.nodeIds).toContain(GROUND_NODE_ID);
    const groundNode = g.nodeById.get(GROUND_NODE_ID)!;
    for (const linkId of groundNode.linkIds) {
      expect(result.linkIds).toContain(linkId);
    }
  });

  it("counts parallel edges (two joints between the same pair of links) individually", () => {
    const { doc } = documentFromEdges([
      [0, 1],
      [0, 1],
      [1, 2],
      [2, 3],
    ]);
    const g = fromDocument(doc);
    const result = baranovCheck(g);

    expect(result.status).toBe("fail");
    if (result.status !== "fail") return;
    expect(result.subsetSize).toBe(3);
    expect(result.subDof).toBe(0);
    expect(result.edgeIds).toHaveLength(3);
  });

  it("always passes for n < 4, faithful to dms's own short-circuit", () => {
    const { doc } = documentFromEdges([
      [0, 1],
      [1, 2],
      [2, 0],
    ]);
    const g = fromDocument(doc);
    expect(baranovCheck(g)).toEqual({ status: "pass" });
  });

  it("skips graphs larger than maxNodes", () => {
    const { doc } = documentFromEdges(WATT_EDGES); // 6 nodes
    const g = fromDocument(doc);
    expect(baranovCheck(g, { maxNodes: 5 })).toEqual({ status: "skipped", reason: "tooLarge" });
  });

  it("is deterministic across calls", () => {
    const { doc } = documentFromEdges([
      [0, 1],
      [1, 2],
      [2, 3],
      [3, 0],
      [2, 4],
      [4, 5],
      [5, 2],
    ]);
    const g = fromDocument(doc);
    expect(baranovCheck(g)).toEqual(baranovCheck(g));
  });
});
