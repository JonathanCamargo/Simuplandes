import { describe, expect, it } from "vitest";
import { ATLAS_TOPOLOGIES } from "./atlasData";
import type { IndexGraph } from "./canonical";
import { areIsomorphic, findIsomorphism } from "./isomorphism";

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

function randomPermutation(n: number, rng: () => number): number[] {
  const perm = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [perm[i], perm[j]] = [perm[j], perm[i]];
  }
  return perm;
}

function relabel(g: IndexGraph, perm: readonly number[], rng: () => number): IndexGraph {
  const edges = g.edges.map(([u, v]) => [perm[u], perm[v]] as const);
  for (let i = edges.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [edges[i], edges[j]] = [edges[j], edges[i]];
  }
  return { n: g.n, edges };
}

function edgeSet(g: IndexGraph): Set<string> {
  return new Set(g.edges.map(([u, v]) => (u < v ? `${u}|${v}` : `${v}|${u}`)));
}

/** Verifies `mapping` is a genuine bijection AND maps every edge of `g` onto an edge of `relabeled`. */
function verifyMapping(g: IndexGraph, relabeled: IndexGraph, mapping: number[] | null): void {
  expect(mapping).not.toBeNull();
  const m = mapping as number[];
  expect(m).toHaveLength(g.n);
  expect(new Set(m).size).toBe(g.n); // bijection
  const targetEdges = edgeSet(relabeled);
  for (const [u, v] of g.edges) {
    const mu = m[u];
    const mv = m[v];
    const key = mu < mv ? `${mu}|${mv}` : `${mv}|${mu}`;
    expect(targetEdges.has(key)).toBe(true);
  }
}

const stephenson = ATLAS_TOPOLOGIES.find((t) => t.id === "T6B_S")!;
const watt = ATLAS_TOPOLOGIES.find((t) => t.id === "T6B_W")!;

describe("findIsomorphism", () => {
  it("recovers a valid mapping for 10 relabelings of every atlas entry", () => {
    let seed = 100;
    for (const topology of ATLAS_TOPOLOGIES) {
      for (let trial = 0; trial < 10; trial += 1) {
        seed += 1;
        const rng = mulberry32(seed);
        const perm = randomPermutation(topology.graph.n, rng);
        const relabeled = relabel(topology.graph, perm, rng);
        const mapping = findIsomorphism(topology.graph, relabeled);
        verifyMapping(topology.graph, relabeled, mapping);
      }
    }
  });

  it("negative control: same degree sequence, non-isomorphic (Watt vs Stephenson) -> null", () => {
    expect(findIsomorphism(watt.graph, stephenson.graph)).toBeNull();
  });

  it("negative control: different n -> null fast", () => {
    const g4: IndexGraph = {
      n: 4,
      edges: [
        [0, 1],
        [1, 2],
        [2, 3],
        [3, 0],
      ],
    };
    expect(findIsomorphism(g4, watt.graph)).toBeNull();
  });

  it("negative control: same n, different m -> null fast", () => {
    const fewerEdges: IndexGraph = { n: 6, edges: watt.graph.edges.slice(0, -1) };
    expect(findIsomorphism(watt.graph, fewerEdges)).toBeNull();
  });

  it("hard case: K3,3 vs the triangular prism are not isomorphic (same degree sequence)", () => {
    const k33: IndexGraph = {
      n: 6,
      edges: [
        [0, 3],
        [0, 4],
        [0, 5],
        [1, 3],
        [1, 4],
        [1, 5],
        [2, 3],
        [2, 4],
        [2, 5],
      ],
    };
    const prism: IndexGraph = {
      n: 6,
      edges: [
        [0, 1],
        [1, 2],
        [2, 0],
        [3, 4],
        [4, 5],
        [5, 3],
        [0, 3],
        [1, 4],
        [2, 5],
      ],
    };
    expect(areIsomorphic(k33, prism)).toBe(false);
  });

  it("hard case: K3,3 vs a relabeled K3,3 are isomorphic", () => {
    const k33: IndexGraph = {
      n: 6,
      edges: [
        [0, 3],
        [0, 4],
        [0, 5],
        [1, 3],
        [1, 4],
        [1, 5],
        [2, 3],
        [2, 4],
        [2, 5],
      ],
    };
    const rng = mulberry32(7);
    const perm = randomPermutation(6, rng);
    const relabeled = relabel(k33, perm, rng);
    const mapping = findIsomorphism(k33, relabeled);
    verifyMapping(k33, relabeled, mapping);
  });
});

describe("areIsomorphic pairwise atlas check", () => {
  it("every pair of distinct atlas entries of the same size is non-isomorphic", () => {
    for (const size of new Set(ATLAS_TOPOLOGIES.map((t) => t.nLinks))) {
      const sameSize = ATLAS_TOPOLOGIES.filter((t) => t.nLinks === size);
      for (let i = 0; i < sameSize.length; i += 1) {
        for (let j = i + 1; j < sameSize.length; j += 1) {
          expect(areIsomorphic(sameSize[i].graph, sameSize[j].graph)).toBe(false);
        }
      }
    }
  });
});
