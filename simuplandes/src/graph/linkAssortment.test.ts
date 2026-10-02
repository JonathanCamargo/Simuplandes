import { describe, expect, it } from "vitest";
import { documentFromEdges } from "./__fixtures__/fromEdges";
import { fromDocument } from "./fromDocument";
import { linkAssortment, type LinkAssortment } from "./linkAssortment";

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

// dms atlas.py's _TOPOLOGY_DATA: all 16 eight-bar topologies, with their
// published link-assortment class (n2, n3, n4, n5).
const EIGHT_BAR_TOPOLOGIES: {
  id: string;
  edges: [number, number][];
  cls: [number, number, number, number];
}[] = [
  {
    id: "T01",
    edges: [
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
    cls: [4, 4, 0, 0],
  },
  {
    id: "T02",
    edges: [
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
    cls: [4, 4, 0, 0],
  },
  {
    id: "T03",
    edges: [
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
    cls: [4, 4, 0, 0],
  },
  {
    id: "T04",
    edges: [
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
    cls: [4, 4, 0, 0],
  },
  {
    id: "T05",
    edges: [
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
    cls: [4, 4, 0, 0],
  },
  {
    id: "T06",
    edges: [
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
    cls: [4, 4, 0, 0],
  },
  {
    id: "T07",
    edges: [
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
    cls: [4, 4, 0, 0],
  },
  {
    id: "T08",
    edges: [
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
    cls: [4, 4, 0, 0],
  },
  {
    id: "T09",
    edges: [
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
    cls: [4, 4, 0, 0],
  },
  {
    id: "T10",
    edges: [
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
    cls: [5, 2, 1, 0],
  },
  {
    id: "T11",
    edges: [
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
    cls: [5, 2, 1, 0],
  },
  {
    id: "T12",
    edges: [
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
    cls: [5, 2, 1, 0],
  },
  {
    id: "T13",
    edges: [
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
    cls: [5, 2, 1, 0],
  },
  {
    id: "T14",
    edges: [
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
    cls: [5, 2, 1, 0],
  },
  {
    id: "T15",
    edges: [
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
    cls: [6, 0, 2, 0],
  },
  {
    id: "T16",
    edges: [
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
    cls: [6, 0, 2, 0],
  },
];

function assortmentFromEdges(edges: ReadonlyArray<readonly [number, number]>): LinkAssortment {
  const { doc } = documentFromEdges(edges);
  return linkAssortment(fromDocument(doc));
}

describe("linkAssortment", () => {
  it("classifies the four-bar as 4 binary links", () => {
    expect(
      assortmentFromEdges([
        [0, 1],
        [1, 2],
        [2, 3],
        [3, 0],
      ]),
    ).toEqual({ n2: 4, n3: 0, n4: 0, n5: 0, other: 0 });
  });

  it("classifies the Watt and Stephenson six-bars as 4 binary + 2 ternary", () => {
    expect(assortmentFromEdges(WATT_EDGES)).toEqual({ n2: 4, n3: 2, n4: 0, n5: 0, other: 0 });
    expect(assortmentFromEdges(STEPHENSON_EDGES)).toEqual({ n2: 4, n3: 2, n4: 0, n5: 0, other: 0 });
  });

  it("matches dms's published class distribution over all 16 eight-bar topologies", () => {
    const distribution = new Map<string, number>();
    for (const { id, edges, cls } of EIGHT_BAR_TOPOLOGIES) {
      const a = assortmentFromEdges(edges);
      expect(a, id).toEqual({ n2: cls[0], n3: cls[1], n4: cls[2], n5: cls[3], other: 0 });
      const key = cls.join(",");
      distribution.set(key, (distribution.get(key) ?? 0) + 1);
    }
    expect(distribution.get("4,4,0,0")).toBe(9);
    expect(distribution.get("5,2,1,0")).toBe(5);
    expect(distribution.get("6,0,2,0")).toBe(2);
  });

  it("counts a degree-6 node in n5 and a degree-1 dangling link in other", () => {
    const a = assortmentFromEdges([
      [0, 1],
      [0, 2],
      [0, 3],
      [0, 4],
      [0, 5],
      [0, 6],
    ]);
    expect(a.n5).toBe(1); // node 0 (ground), degree 6
    expect(a.other).toBe(6); // nodes 1..6, degree 1 each
  });
});
