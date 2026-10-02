import { describe, expect, it } from "vitest";
import { ATLAS_TOPOLOGIES, atlasSizes } from "./atlasData";
import type { IndexGraph } from "./canonical";
import { identifyTopology } from "./identify";

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

function verifyMapping(g: IndexGraph, target: IndexGraph, mapping: number[]): void {
  expect(new Set(mapping).size).toBe(g.n);
  const targetEdges = new Set(target.edges.map(([u, v]) => (u < v ? `${u}|${v}` : `${v}|${u}`)));
  for (const [u, v] of g.edges) {
    const mu = mapping[u];
    const mv = mapping[v];
    const key = mu < mv ? `${mu}|${mv}` : `${mv}|${mu}`;
    expect(targetEdges.has(key)).toBe(true);
  }
}

const stephenson = ATLAS_TOPOLOGIES.find((t) => t.id === "T6B_S")!;
const watt = ATLAS_TOPOLOGIES.find((t) => t.id === "T6B_W")!;
const eightBar = ATLAS_TOPOLOGIES.filter((t) => t.nLinks === 8);

describe("identifyTopology", () => {
  it("n = 0 -> empty", () => {
    expect(identifyTopology({ n: 0, edges: [] })).toEqual({ kind: "none", reason: "empty" });
  });

  it("a 4-cycle (any labeling) -> fourBar", () => {
    const cycle: IndexGraph = {
      n: 4,
      edges: [
        [0, 1],
        [1, 2],
        [2, 3],
        [3, 0],
      ],
    };
    const rng = mulberry32(3);
    const perm = randomPermutation(4, rng);
    const relabeled = relabel(cycle, perm, rng);
    expect(identifyTopology(relabeled)).toEqual({ kind: "fourBar" });
  });

  it("any relabeling of Stephenson -> T6B_S/stephenson with a valid mapping", () => {
    let seed = 10;
    for (let trial = 0; trial < 5; trial += 1) {
      seed += 1;
      const rng = mulberry32(seed);
      const perm = randomPermutation(6, rng);
      const relabeled = relabel(stephenson.graph, perm, rng);
      const result = identifyTopology(relabeled);
      expect(result.kind).toBe("atlas");
      if (result.kind === "atlas") {
        expect(result.id).toBe("T6B_S");
        expect(result.name).toBe("stephenson");
        expect(result.nLinks).toBe(6);
        verifyMapping(relabeled, stephenson.graph, result.mapping);
      }
    }
  });

  it("any relabeling of Watt -> T6B_W/watt with a valid mapping", () => {
    let seed = 20;
    for (let trial = 0; trial < 5; trial += 1) {
      seed += 1;
      const rng = mulberry32(seed);
      const perm = randomPermutation(6, rng);
      const relabeled = relabel(watt.graph, perm, rng);
      const result = identifyTopology(relabeled);
      expect(result.kind).toBe("atlas");
      if (result.kind === "atlas") {
        expect(result.id).toBe("T6B_W");
        expect(result.name).toBe("watt");
        verifyMapping(relabeled, watt.graph, result.mapping);
      }
    }
  });

  it("Stephenson relabeled so a binary node is node 0 (Stephenson III grounding) -> still T6B_S", () => {
    // Find a permutation that sends a binary (degree-2) node to index 0.
    const degrees = new Array(stephenson.graph.n).fill(0);
    for (const [u, v] of stephenson.graph.edges) {
      degrees[u] += 1;
      degrees[v] += 1;
    }
    const binaryNode = degrees.findIndex((d) => d === 2);
    const perm = [0, 1, 2, 3, 4, 5];
    // swap so that `binaryNode` maps to 0
    [perm[binaryNode], perm[0]] = [perm[0], perm[binaryNode]];
    const relabeled: IndexGraph = {
      n: 6,
      edges: stephenson.graph.edges.map(([u, v]) => [perm[u], perm[v]] as const),
    };
    // sanity: new node 0 is indeed binary in the relabeled graph
    const newDegree0 = relabeled.edges.filter(([u, v]) => u === 0 || v === 0).length;
    expect(newDegree0).toBe(2);
    const result = identifyTopology(relabeled);
    expect(result).toMatchObject({ kind: "atlas", id: "T6B_S", name: "stephenson" });
  });

  it("each of the 16 eight-bars, 5 random relabelings each -> its own id, name: null", () => {
    let seed = 200;
    for (const topology of eightBar) {
      for (let trial = 0; trial < 5; trial += 1) {
        seed += 1;
        const rng = mulberry32(seed);
        const perm = randomPermutation(8, rng);
        const relabeled = relabel(topology.graph, perm, rng);
        const result = identifyTopology(relabeled);
        expect(result.kind).toBe("atlas");
        if (result.kind === "atlas") {
          expect(result.id).toBe(topology.id);
          expect(result.name).toBeNull();
          verifyMapping(relabeled, topology.graph, result.mapping);
        }
      }
    }
  });

  it("6 nodes / 7 edges containing a triangle -> none/noMatch", () => {
    // Triangle (0-1-2-0) fused with a 4-chain back to node 0: 6 nodes, 7
    // edges, same degree sequence as Watt/Stephenson (4 binary + 2 ternary)
    // but not isomorphic to either (it has a 3-cycle; they have none).
    const triangleFused: IndexGraph = {
      n: 6,
      edges: [
        [0, 1],
        [1, 2],
        [2, 0],
        [2, 3],
        [3, 4],
        [4, 5],
        [5, 0],
      ],
    };
    expect(identifyTopology(triangleFused)).toEqual({ kind: "none", reason: "noMatch" });
  });

  it("a self-loop -> notSimple", () => {
    expect(
      identifyTopology({
        n: 4,
        edges: [
          [0, 0],
          [1, 2],
          [2, 3],
          [3, 1],
        ],
      }),
    ).toEqual({
      kind: "none",
      reason: "notSimple",
    });
  });

  it("a parallel edge -> notSimple", () => {
    expect(
      identifyTopology({
        n: 4,
        edges: [
          [0, 1],
          [0, 1],
          [1, 2],
          [2, 3],
        ],
      }),
    ).toEqual({ kind: "none", reason: "notSimple" });
  });

  it("a disconnected graph -> disconnected", () => {
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
    expect(identifyTopology(twoTriangles)).toEqual({ kind: "none", reason: "disconnected" });
  });

  it("n = 5 (no atlas size) -> noAtlasForSize", () => {
    const fiveCycle: IndexGraph = {
      n: 5,
      edges: [
        [0, 1],
        [1, 2],
        [2, 3],
        [3, 4],
        [4, 0],
      ],
    };
    expect(identifyTopology(fiveCycle)).toEqual({ kind: "none", reason: "noAtlasForSize" });
  });

  it("n = 7 (no atlas size) -> noAtlasForSize", () => {
    const sevenCycle: IndexGraph = {
      n: 7,
      edges: [
        [0, 1],
        [1, 2],
        [2, 3],
        [3, 4],
        [4, 5],
        [5, 6],
        [6, 0],
      ],
    };
    expect(identifyTopology(sevenCycle)).toEqual({ kind: "none", reason: "noAtlasForSize" });
  });

  it("n = 10 -> noAtlasForSize, while no 10-bar atlas is bundled", () => {
    if (atlasSizes().includes(10)) return; // this assertion stops applying once 06-07 lands
    const tenCycle: IndexGraph = {
      n: 10,
      edges: Array.from({ length: 10 }, (_, i) => [i, (i + 1) % 10] as const),
    };
    expect(identifyTopology(tenCycle)).toEqual({ kind: "none", reason: "noAtlasForSize" });
  });

  it("performance guard: identifying all 16 relabeled eight-bars takes < 200ms total", () => {
    const rng = mulberry32(999);
    const inputs = eightBar.map((topology) =>
      relabel(topology.graph, randomPermutation(8, rng), rng),
    );
    const start = performance.now();
    for (const g of inputs) identifyTopology(g);
    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(200);
  });
});
