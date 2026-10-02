/**
 * Pure graph primitives for topology identification (GRF-04): a minimal
 * index-labeled graph type, structural sanity checks, and a
 * Weisfeiler-Lehman-style color-refinement invariant used to bucket the
 * bundled atlas before a real isomorphism check confirms a match
 * (`./isomorphism.ts`).
 *
 * This is intentionally NOT a port of GraphThe's `canonical.py` --
 * `canonical_ordering` there is a heuristic node ordering for a
 * fixed/already-known graph, not an isomorphism invariant (it falls back to
 * raw node id on ties, so two differently-labeled isomorphic graphs are not
 * guaranteed to produce the same ordering). `wlHash`/`invariantKey` here are
 * a real (if imperfect on their own) refinement invariant, always paired
 * with `./isomorphism.ts`'s exact backtracking check to confirm a match.
 *
 * Nothing here reproduces networkx's `weisfeiler_lehman_graph_hash` bit for
 * bit -- that hash's own docs note its value changed between networkx
 * versions, and it never needs to appear in this codebase: matching only
 * ever compares a JS-computed hash of the live document graph against a
 * JS-computed hash of a bundled atlas graph, using this same function.
 */

/** An index-labeled simple graph: nodes are `0..n-1`, edges are `[u, v]` pairs. */
export interface IndexGraph {
  readonly n: number;
  readonly edges: ReadonlyArray<readonly [number, number]>;
}

function buildAdjacency(g: IndexGraph): number[][] {
  const adjacency: number[][] = Array.from({ length: g.n }, () => []);
  for (const [u, v] of g.edges) {
    if (u >= 0 && u < g.n) adjacency[u].push(v);
    if (v >= 0 && v < g.n) adjacency[v].push(u);
  }
  return adjacency;
}

/** True iff every endpoint is in range, there are no self-loops, and no parallel edges. */
export function isSimpleGraph(g: IndexGraph): boolean {
  if (!Number.isInteger(g.n) || g.n < 0) return false;
  const seen = new Set<string>();
  for (const [u, v] of g.edges) {
    if (!Number.isInteger(u) || !Number.isInteger(v)) return false;
    if (u < 0 || u >= g.n || v < 0 || v >= g.n) return false;
    if (u === v) return false;
    const key = u < v ? `${u}|${v}` : `${v}|${u}`;
    if (seen.has(key)) return false;
    seen.add(key);
  }
  return true;
}

/** True iff the graph has a single connected component (vacuously true for `n === 0`). */
export function isConnected(g: IndexGraph): boolean {
  if (g.n === 0) return true;
  const adjacency = buildAdjacency(g);
  const visited = new Array<boolean>(g.n).fill(false);
  const stack = [0];
  visited[0] = true;
  let count = 1;
  while (stack.length > 0) {
    const node = stack.pop() as number;
    for (const neighbor of adjacency[node]) {
      if (!visited[neighbor]) {
        visited[neighbor] = true;
        count += 1;
        stack.push(neighbor);
      }
    }
  }
  return count === g.n;
}

/** Node degrees, sorted descending. */
export function degreeSequence(g: IndexGraph): number[] {
  const degree = new Array<number>(g.n).fill(0);
  for (const [u, v] of g.edges) {
    if (u >= 0 && u < g.n) degree[u] += 1;
    if (v >= 0 && v < g.n) degree[v] += 1;
  }
  return degree.slice().sort((a, b) => b - a);
}

/**
 * One round of 1-WL color refinement. New colors are assigned by sorting the
 * *content* of each node's `${color}|${sorted neighbor colors}` signature
 * string lexicographically and indexing by that sorted position -- NOT by
 * the order nodes happen to be visited in. Because the signature strings
 * only ever depend on structural content (degrees, recursively-derived
 * colors), two differently-labeled isomorphic graphs produce the exact same
 * multiset of signature strings at every iteration, so this indexing scheme
 * assigns the same integer to the same equivalence class in both graphs --
 * without needing any shared mutable table between calls.
 */
function refineColors(colors: readonly number[], adjacency: readonly number[][]): number[] {
  const n = colors.length;
  const signatures: string[] = new Array<string>(n);
  for (let node = 0; node < n; node += 1) {
    const neighborColors = adjacency[node]
      .map((neighbor) => colors[neighbor])
      .sort((a, b) => a - b);
    signatures[node] = `${colors[node]}|${neighborColors.join(",")}`;
  }
  const uniqueSorted = Array.from(new Set(signatures)).sort();
  const indexOf = new Map(uniqueSorted.map((signature, index) => [signature, index]));
  return signatures.map((signature) => indexOf.get(signature) as number);
}

/**
 * Per-node WL colors after `iterations` rounds of refinement (initial color
 * = degree). Directly comparable across two different `IndexGraph` calls:
 * see `refineColors`'s doc comment for why no shared table is needed.
 */
export function wlColors(g: IndexGraph, iterations = 3): number[] {
  const adjacency = buildAdjacency(g);
  let colors: number[] = new Array<number>(g.n);
  for (let node = 0; node < g.n; node += 1) colors[node] = adjacency[node].length;
  for (let iteration = 0; iteration < iterations; iteration += 1) {
    colors = refineColors(colors, adjacency);
  }
  return colors;
}

/** Sorted multiset of final WL colors, joined as a plain string (relabeling-invariant). */
export function wlHash(g: IndexGraph, iterations = 3): string {
  const colors = wlColors(g, iterations);
  return colors
    .slice()
    .sort((a, b) => a - b)
    .join(",");
}

/** `${n}|${m}|${degreeSequence}|${wlHash}` -- a cheap pre-filter key for atlas bucketing. */
export function invariantKey(g: IndexGraph): string {
  const m = g.edges.length;
  const degSeq = degreeSequence(g);
  return `${g.n}|${m}|${degSeq.join(",")}|${wlHash(g)}`;
}
