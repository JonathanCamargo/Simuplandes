import { describe, expect, it } from "vitest";
import { ATLAS_TOPOLOGIES } from "./atlasData";
import {
  degreeSequence,
  invariantKey,
  isConnected,
  isSimpleGraph,
  wlHash,
  type IndexGraph,
} from "./canonical";

/** Deterministic seeded PRNG (mulberry32), so relabeling tests are reproducible. */
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A random permutation of `0..n-1`, via Fisher-Yates driven by `rng`. */
function randomPermutation(n: number, rng: () => number): number[] {
  const perm = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [perm[i], perm[j]] = [perm[j], perm[i]];
  }
  return perm;
}

/** Relabels every node of `g` through `perm` (`perm[oldNode] = newNode`) and shuffles edge order. */
function relabel(g: IndexGraph, perm: readonly number[], rng: () => number): IndexGraph {
  const edges = g.edges.map(([u, v]) => [perm[u], perm[v]] as const);
  for (let i = edges.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [edges[i], edges[j]] = [edges[j], edges[i]];
  }
  return { n: g.n, edges };
}

const stephenson = ATLAS_TOPOLOGIES.find((t) => t.id === "T6B_S")!;
const watt = ATLAS_TOPOLOGIES.find((t) => t.id === "T6B_W")!;

describe("isSimpleGraph", () => {
  it("rejects a self-loop", () => {
    expect(isSimpleGraph({ n: 3, edges: [[0, 0]] })).toBe(false);
  });

  it("rejects a parallel edge in the same orientation", () => {
    expect(
      isSimpleGraph({
        n: 3,
        edges: [
          [0, 1],
          [0, 1],
        ],
      }),
    ).toBe(false);
  });

  it("rejects a parallel edge in the reversed orientation", () => {
    expect(
      isSimpleGraph({
        n: 3,
        edges: [
          [0, 1],
          [1, 0],
        ],
      }),
    ).toBe(false);
  });

  it("rejects an out-of-range endpoint", () => {
    expect(isSimpleGraph({ n: 3, edges: [[0, 5]] })).toBe(false);
  });

  it("is true for every bundled atlas entry", () => {
    for (const topology of ATLAS_TOPOLOGIES) {
      expect(isSimpleGraph(topology.graph)).toBe(true);
    }
  });
});

describe("degreeSequence / isConnected", () => {
  it("Stephenson's degree sequence is [3,3,2,2,2,2]", () => {
    expect(degreeSequence(stephenson.graph)).toEqual([3, 3, 2, 2, 2, 2]);
  });

  it("is false for two disjoint triangles", () => {
    const twoTriangles: IndexGraph = {
      n: 6,
      edges: [
        [0, 1],
        [1, 2],
        [2, 0],
        [3, 4],
        [4, 5],
        [5, 3],
      ],
    };
    expect(isConnected(twoTriangles)).toBe(false);
  });

  it("is true for every bundled atlas entry", () => {
    for (const topology of ATLAS_TOPOLOGIES) {
      expect(isConnected(topology.graph)).toBe(true);
    }
  });
});

describe("wlHash / invariantKey relabeling invariance", () => {
  it("is invariant under 20 random relabelings + edge shuffles of every atlas entry", () => {
    let seed = 1;
    for (const topology of ATLAS_TOPOLOGIES) {
      const baseHash = wlHash(topology.graph);
      const baseKey = invariantKey(topology.graph);
      for (let trial = 0; trial < 20; trial += 1) {
        seed += 1;
        const rng = mulberry32(seed);
        const perm = randomPermutation(topology.graph.n, rng);
        const relabeled = relabel(topology.graph, perm, rng);
        expect(wlHash(relabeled)).toBe(baseHash);
        expect(invariantKey(relabeled)).toBe(baseKey);
      }
    }
  });

  it("Watt and Stephenson have different invariantKeys (WL separates them)", () => {
    expect(invariantKey(watt.graph)).not.toBe(invariantKey(stephenson.graph));
  });
});
