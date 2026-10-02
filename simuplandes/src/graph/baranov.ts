/**
 * Baranov / rigid-subchain detection (GRF-03): a JS port of dms's
 * `_passes_baranov_condition` (`atlas.py`, MIT), extended to return the
 * minimal offending subset instead of a bare boolean, for highlighting in
 * both the canvas and the graph panel.
 *
 * For k = 3..n-1 ascending, for every k-combination of nodes in lexicographic
 * order (mirroring Python's `itertools.combinations`), count edges with both
 * endpoints inside the subset (parallel edges counted individually) and
 * check `subDof = 3*(k-1) - 2*eSub <= 0`. The first such subset found (the
 * smallest `k`, then lexicographically first) is returned; a topology whose
 * only violation is the full graph (`k = n`) is Gruebler's job, not this
 * check's -- `k` never reaches `n` here.
 */

import type { Id } from "../model";
import type { LinkGraph } from "./types";

export type BaranovResult =
  | { status: "pass" }
  | {
      status: "fail";
      nodeIds: Id[];
      edgeIds: Id[];
      linkIds: Id[];
      subsetSize: number;
      subDof: number;
    }
  | { status: "skipped"; reason: "tooLarge" };

/** Above this node count, `baranovCheck` skips rather than enumerating (2^16 subsets is already a lot). */
export const BARANOV_MAX_NODES = 16;

/** Iterative combinations of `k` indices out of `[0, n)`, in ascending lexicographic order. */
function* combinations(n: number, k: number): Generator<number[]> {
  if (k > n || k < 0) return;
  const indices = Array.from({ length: k }, (_, i) => i);
  for (;;) {
    yield indices.slice();
    let i = k - 1;
    while (i >= 0 && indices[i] === i + n - k) i -= 1;
    if (i < 0) return;
    indices[i] += 1;
    for (let j = i + 1; j < k; j += 1) indices[j] = indices[j - 1] + 1;
  }
}

/** Baranov's rigid-subchain check on the merged graph `g`. Faithful to dms: `n < 4` always passes. */
export function baranovCheck(g: LinkGraph, options?: { maxNodes?: number }): BaranovResult {
  const maxNodes = options?.maxNodes ?? BARANOV_MAX_NODES;
  const n = g.nodes.length;
  if (n > maxNodes) return { status: "skipped", reason: "tooLarge" };
  if (n < 4) return { status: "pass" };

  const nodeIndex = new Map<Id, number>(g.nodes.map((node, i) => [node.id, i]));
  const edgePairs = g.edges.map(
    (edge) => [nodeIndex.get(edge.a)!, nodeIndex.get(edge.b)!] as const,
  );

  for (let k = 3; k <= n - 1; k += 1) {
    for (const combo of combinations(n, k)) {
      const inSubset = new Uint8Array(n);
      for (const idx of combo) inSubset[idx] = 1;

      let eSub = 0;
      for (const [ai, bi] of edgePairs) {
        if (inSubset[ai] && inSubset[bi]) eSub += 1;
      }

      const subDof = 3 * (k - 1) - 2 * eSub;
      if (subDof <= 0) {
        const nodeIds = combo.map((idx) => g.nodes[idx].id);
        const edgeIds: Id[] = [];
        g.edges.forEach((edge, ei) => {
          const [ai, bi] = edgePairs[ei];
          if (inSubset[ai] && inSubset[bi]) edgeIds.push(edge.id);
        });
        const linkIds = nodeIds.flatMap((id) => g.nodeById.get(id)!.linkIds);
        return { status: "fail", nodeIds, edgeIds, linkIds, subsetSize: k, subDof };
      }
    }
  }

  return { status: "pass" };
}
