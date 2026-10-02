import { describe, expect, it } from "vitest";
import { MechanismDocumentSchema } from "../model";
import { documentFromEdges } from "./__fixtures__/fromEdges";
import { fromDocument } from "./fromDocument";
import { graphMobility } from "./mobility";

// dms atlas.py's own hardcoded 6-bar edge lists (Watt/Stephenson), ground = node 0.
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

// dms atlas.py's _TOPOLOGY_DATA: all 16 eight-bar topologies (ground = node 0).
const EIGHT_BAR_EDGES: Record<string, [number, number][]> = {
  T01: [
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
  T02: [
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
  T03: [
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
  T04: [
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
  T05: [
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
  T06: [
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
  T07: [
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
  T08: [
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
  T09: [
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
  T10: [
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
  T11: [
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
  T12: [
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
  T13: [
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
  T14: [
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
  T15: [
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
  T16: [
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
};

function mobilityFromEdges(
  edges: ReadonlyArray<readonly [number, number]>,
  options?: { ground?: readonly number[] },
): ReturnType<typeof graphMobility> {
  const { doc } = documentFromEdges(edges, options);
  return graphMobility(fromDocument(doc));
}

describe("graphMobility", () => {
  it("computes the four-bar's Gruebler F", () => {
    expect(
      mobilityFromEdges([
        [0, 1],
        [1, 2],
        [2, 3],
        [3, 0],
      ]),
    ).toEqual({ n: 4, j: 4, gruebler: 1 });
  });

  it("computes the Watt and Stephenson six-bars' Gruebler F", () => {
    expect(mobilityFromEdges(WATT_EDGES)).toEqual({ n: 6, j: 7, gruebler: 1 });
    expect(mobilityFromEdges(STEPHENSON_EDGES)).toEqual({ n: 6, j: 7, gruebler: 1 });
  });

  it("computes Gruebler F = 1 for every one of the 16 eight-bar topologies", () => {
    for (const [id, edges] of Object.entries(EIGHT_BAR_EDGES)) {
      expect(mobilityFromEdges(edges), id).toEqual({ n: 8, j: 10, gruebler: 1 });
    }
  });

  it("computes Gruebler F = 0 for a four-bar plus one redundant bar across", () => {
    const mobility = mobilityFromEdges([
      [0, 1],
      [1, 2],
      [2, 3],
      [3, 0],
      [0, 4],
      [4, 2],
    ]);
    expect(mobility).toEqual({ n: 5, j: 6, gruebler: 0 });
  });

  it("counts a groundLoop joint in j (matches kinematics' counting)", () => {
    const { doc } = documentFromEdges(
      [
        [0, 1],
        [1, 2],
        [0, 2],
      ],
      { ground: [0, 2] },
    );
    const mobility = graphMobility(fromDocument(doc));
    expect(mobility.j).toBe(3);
    // 2 nodes: the merged ground node + node 1.
    expect(mobility.n).toBe(2);
  });

  it("returns gruebler: null when there are only ground links, or the document is empty", () => {
    const { doc: onlyGroundDoc } = documentFromEdges([[0, 1]], { ground: [0, 1] });
    expect(graphMobility(fromDocument(onlyGroundDoc)).gruebler).toBeNull();

    const emptyDoc = MechanismDocumentSchema.parse({ schemaVersion: 1 });
    expect(graphMobility(fromDocument(emptyDoc)).gruebler).toBeNull();
  });
});
