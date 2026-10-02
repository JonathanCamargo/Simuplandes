/**
 * Small, VF2-style color-constrained backtracking graph isomorphism check.
 * Intended for graphs of at most ~16 nodes (the largest bundled atlas entry
 * plus the live document's own graph) -- it is not a canonical form and it
 * is not meant to scale beyond this phase's atlas sizes.
 *
 * No maintained, well-adopted npm isomorphism library exists for this graph
 * size (see phase 06 research); this hand-rolled matcher is fully
 * unit-tested against the bundled atlas fixtures instead.
 */

import { degreeSequence, wlColors, type IndexGraph } from "./canonical";

function buildAdjacency(g: IndexGraph): number[][] {
  const adjacency: number[][] = Array.from({ length: g.n }, () => []);
  for (const [u, v] of g.edges) {
    adjacency[u].push(v);
    adjacency[v].push(u);
  }
  return adjacency;
}

/**
 * Finds a bijection `mapping` with `mapping[aNode] = bNode` such that every
 * edge of `a` maps onto an edge of `b` (and vice versa, since both are the
 * same size). Returns `null` if no such mapping exists.
 */
export function findIsomorphism(a: IndexGraph, b: IndexGraph): number[] | null {
  if (a.n !== b.n) return null;
  if (a.edges.length !== b.edges.length) return null;

  const n = a.n;
  if (n === 0) return [];

  const degA = degreeSequence(a);
  const degB = degreeSequence(b);
  for (let i = 0; i < n; i += 1) {
    if (degA[i] !== degB[i]) return null;
  }

  // WL colors are directly comparable across the two graphs (see
  // canonical.ts's `refineColors` doc comment): only allow a-node -> b-node
  // candidates that share a color.
  const colorsA = wlColors(a);
  const colorsB = wlColors(b);

  const adjA = buildAdjacency(a);

  // Bucket b-nodes by color for fast candidate lookup.
  const bByColor = new Map<number, number[]>();
  for (let node = 0; node < n; node += 1) {
    const color = colorsB[node];
    const bucket = bByColor.get(color);
    if (bucket) bucket.push(node);
    else bByColor.set(color, [node]);
  }

  // Order a-nodes by (smallest color class first, then most already-mapped
  // neighbors) -- both are standard VF2-style pruning heuristics that keep
  // the search small without changing correctness.
  const colorClassSize = new Map<number, number>();
  for (const color of colorsA) colorClassSize.set(color, (colorClassSize.get(color) ?? 0) + 1);

  const order: number[] = [];
  const remaining = new Set<number>(Array.from({ length: n }, (_, i) => i));
  const orderedSet = new Set<number>();
  while (remaining.size > 0) {
    let best = -1;
    let bestScore: [number, number] = [Infinity, -Infinity];
    for (const node of remaining) {
      const alreadyMappedNeighbors = adjA[node].filter((neighbor) =>
        orderedSet.has(neighbor),
      ).length;
      const score: [number, number] = [
        colorClassSize.get(colorsA[node]) ?? Infinity,
        -alreadyMappedNeighbors,
      ];
      if (score[0] < bestScore[0] || (score[0] === bestScore[0] && score[1] < bestScore[1])) {
        best = node;
        bestScore = score;
      }
    }
    order.push(best);
    orderedSet.add(best);
    remaining.delete(best);
  }

  const mapping = new Array<number>(n).fill(-1);
  const used = new Array<boolean>(n).fill(false);
  // Adjacency-count matrix for `a`, used to check edge <=> edge consistency
  // against already-mapped nodes (stays correct for simple graphs; a
  // mismatch here also cleanly rejects any accidental multigraph input).
  const adjCountA: number[][] = Array.from({ length: n }, () => new Array<number>(n).fill(0));
  for (const [u, v] of a.edges) {
    adjCountA[u][v] += 1;
    adjCountA[v][u] += 1;
  }
  const adjCountB: number[][] = Array.from({ length: n }, () => new Array<number>(n).fill(0));
  for (const [u, v] of b.edges) {
    adjCountB[u][v] += 1;
    adjCountB[v][u] += 1;
  }

  function consistent(aNode: number, bNode: number): boolean {
    for (let other = 0; other < n; other += 1) {
      if (mapping[other] === -1) continue;
      if (adjCountA[aNode][other] !== adjCountB[bNode][mapping[other]]) return false;
    }
    return true;
  }

  function backtrack(index: number): boolean {
    if (index === n) return true;
    const aNode = order[index];
    const candidates = bByColor.get(colorsA[aNode]) ?? [];
    for (const bNode of candidates) {
      if (used[bNode]) continue;
      if (!consistent(aNode, bNode)) continue;
      mapping[aNode] = bNode;
      used[bNode] = true;
      if (backtrack(index + 1)) return true;
      mapping[aNode] = -1;
      used[bNode] = false;
    }
    return false;
  }

  return backtrack(0) ? mapping.slice() : null;
}

/** True iff `a` and `b` are isomorphic. */
export function areIsomorphic(a: IndexGraph, b: IndexGraph): boolean {
  return findIsomorphism(a, b) !== null;
}
