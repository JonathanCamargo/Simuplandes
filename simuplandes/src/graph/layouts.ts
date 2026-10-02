/**
 * Three pure, deterministic node-placement layouts (GRF-05) for the graph
 * panel's SVG. Every layout places nodes in the unit box `[0, 1]^2` with a
 * fixed `MARGIN` (0.08) and SVG's own y-DOWN convention (the world/document
 * is y-up; layouts flip y). 06-05's `<svg>` just multiplies these
 * coordinates by its own viewBox width/height -- no further scaling or
 * flipping needed there.
 *
 * No layout library (no d3-force/dagre/elkjs): PROJECT.md's locked decision
 * is "Graph panel uses SVG with a custom layout", and every bundled/real
 * fixture is small enough (<=16 nodes) that hand-rolled arithmetic is both
 * sufficient and fully unit-testable.
 *
 * Minimum separation (06-08 gap closure): every layout enforces
 * `MIN_NODE_SEPARATION`, derived from the actual rendered node footprint
 * (`GraphSvg`'s circle/square radius, its outermost issue ring, and that
 * ring's stroke) rather than an arbitrary constant. The old flat
 * `MIN_SEPARATION = 0.05` was mathematically enough to keep two positions
 * distinct but not enough to keep two DRAWN shapes from visually
 * overlapping once real geometry was compact (e.g. a Stephenson six-bar's
 * ground sitting on the coupler, or the SC-3 rigid-triangle fixture's L2
 * on L3). `GraphSvg` derives its own drawing sizes from the same
 * `GRAPH_NODE_*` constants below, so the two can never drift apart.
 *
 * 06-09: the `GRAPH_NODE_*`/`MIN_NODE_SEPARATION` constants below are now
 * the DEFAULT separation used when no measured viewport exists (jsdom,
 * unit tests). The real on-screen renderer (`GraphPanel`/`GraphSvg`) instead
 * passes a `minSeparation` derived from its own measured, fixed-pixel node
 * footprint via `layoutGraph(g, kind, { minSeparation })` -- see
 * `src/ui/graph/graphViewport.ts`'s `computeGraphViewport`, the single
 * source of truth for that scale-aware value.
 */

import type { Id } from "../model";
import type { LinkGraph } from "./types";

/** Same literal union as `studioStore`'s own `GraphLayoutKind` (06-03) -- defined locally so `src/graph` never imports `src/uiState`. */
export type GraphLayoutKind = "spatial" | "circular" | "layered";

/** A node's position in the unit box, y DOWN (SVG convention). */
export interface NodePosition {
  x: number;
  y: number;
}

/** Box margin: every position lands in `[MARGIN, 1 - MARGIN]` on both axes. */
const MARGIN = 0.08;
const CENTER = 0.5;
const BOX = 1 - 2 * MARGIN;
const CIRCULAR_RADIUS = 0.42;

/** Circle node radius, unit-box units (`GraphSvg`'s `NODE_RADIUS = GRAPH_NODE_RADIUS * VIEWBOX` = 34). */
export const GRAPH_NODE_RADIUS = 0.034;
/** Ground square half-side, unit-box units (`GraphSvg`'s `GROUND_HALF_SIDE` = 32). */
export const GRAPH_GROUND_HALF_SIDE = 0.032;
/** Outermost (issue) ring offset outside the node's own shape (`GraphSvg`'s ring `pad` = 14). */
export const GRAPH_NODE_RING_PAD = 0.014;
const RING_STROKE_HALF = 0.002;
/** Radius of a circle enclosing ANY node's drawn footprint: square ground's half-diagonal, its outermost ring, and that ring's stroke. */
export const GRAPH_NODE_FOOTPRINT_RADIUS =
  Math.max(GRAPH_NODE_RADIUS, GRAPH_GROUND_HALF_SIDE * Math.SQRT2) +
  GRAPH_NODE_RING_PAD +
  RING_STROKE_HALF;
/** Extra breathing room between two nodes' footprints, beyond just touching. */
export const GRAPH_NODE_GAP = 0.02;
/** Minimum center-to-center distance between any two nodes (~0.143): footprints never touch. */
export const MIN_NODE_SEPARATION = 2 * GRAPH_NODE_FOOTPRINT_RADIUS + GRAPH_NODE_GAP;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Adjacency (undirected) built from `g.edges`, keyed by `GraphNode` id. */
function buildAdjacency(g: LinkGraph): Map<Id, Id[]> {
  const adjacency = new Map<Id, Id[]>();
  for (const node of g.nodes) adjacency.set(node.id, []);
  for (const edge of g.edges) {
    adjacency.get(edge.a)?.push(edge.b);
    adjacency.get(edge.b)?.push(edge.a);
  }
  return adjacency;
}

interface BfsResult {
  /** Reached nodes in BFS visitation order, followed by unreached nodes in doc order. */
  order: Id[];
  /** BFS depth from the root; only reached nodes are keys. */
  depth: Map<Id, number>;
  /** BFS parent; only reached non-root nodes are keys. */
  parent: Map<Id, Id>;
}

/** BFS from the ground node (or `g.nodes[0]` if there is none). */
function bfs(g: LinkGraph): BfsResult {
  const root = g.nodes.find((node) => node.isGround) ?? g.nodes[0];
  const adjacency = buildAdjacency(g);
  const depth = new Map<Id, number>([[root.id, 0]]);
  const parent = new Map<Id, Id>();
  const order: Id[] = [];
  const queue: Id[] = [root.id];
  let qi = 0;
  while (qi < queue.length) {
    const current = queue[qi];
    qi += 1;
    order.push(current);
    // `current` always came from `g.nodes` (root, or a neighbor pushed
    // below), and `buildAdjacency` seeds an entry for every node -- both
    // lookups below are always defined.
    for (const neighbor of adjacency.get(current)!) {
      if (!depth.has(neighbor)) {
        depth.set(neighbor, depth.get(current)! + 1);
        parent.set(neighbor, current);
        queue.push(neighbor);
      }
    }
  }
  for (const node of g.nodes) {
    if (!depth.has(node.id)) order.push(node.id);
  }
  return { order, depth, parent };
}

/**
 * Pushes apart any pair of points closer than `minSep`, along their
 * difference vector (or, when exactly coincident, along a fixed
 * index-derived angle -- deterministic, no randomness), then clamps every
 * point back into the box. Iterates until stable or `maxIterations` is hit.
 * `MIN_NODE_SEPARATION` (~0.143), the default `minSep`, is considerably
 * larger than the old flat 0.05, so convergence inside
 * `[MARGIN, 1 - MARGIN]` needs more iterations and, for exactly-coincident
 * pairs, a full (not halved) initial push.
 */
function separate(points: NodePosition[], minSep: number): void {
  // Clamping is folded into every iteration (not just a final pass): a pair
  // separated near the box edge can be pushed back together by clamping
  // alone, so the two steps must alternate until both stabilize.
  const maxIterations = 1000;
  for (let iteration = 0; iteration < maxIterations; iteration += 1) {
    let moved = false;
    for (let i = 0; i < points.length; i += 1) {
      for (let j = i + 1; j < points.length; j += 1) {
        const dx = points[j].x - points[i].x;
        const dy = points[j].y - points[i].y;
        let dist = Math.hypot(dx, dy);
        if (dist >= minSep) continue;
        moved = true;
        let ux: number;
        let uy: number;
        let coincident = false;
        if (dist < 1e-9) {
          // Deterministic fixed angle derived from the pair's indices --
          // never random, so two calls on the same graph agree exactly.
          const angle = ((i + 1) * 2.399963229728653 + j * 0.618033988749895) % (2 * Math.PI);
          ux = Math.cos(angle);
          uy = Math.sin(angle);
          dist = 0;
          coincident = true;
        } else {
          ux = dx / dist;
          uy = dy / dist;
        }
        // Exactly-coincident pairs push apart by the FULL shortfall (not
        // halved): with a larger `minSep`, halving would take many more
        // iterations to separate a degenerate cluster; a single strong push
        // resolves it immediately and later iterations still reconcile any
        // resulting box-edge clamping.
        const shortfall = coincident ? minSep - dist : (minSep - dist) / 2;
        points[i].x -= ux * shortfall;
        points[i].y -= uy * shortfall;
        points[j].x += ux * shortfall;
        points[j].y += uy * shortfall;
      }
    }
    for (const point of points) {
      const cx = clamp(point.x, MARGIN, 1 - MARGIN);
      const cy = clamp(point.y, MARGIN, 1 - MARGIN);
      if (cx !== point.x || cy !== point.y) {
        point.x = cx;
        point.y = cy;
        moved = true;
      }
    }
    if (!moved) break;
  }
}

/** Converts `map` to a points array in `g.nodes` order, separates it, then maps back -- deterministic, no randomness. */
function applySeparationPass(
  g: LinkGraph,
  map: ReadonlyMap<Id, NodePosition>,
  minSep: number,
): ReadonlyMap<Id, NodePosition> {
  const points: NodePosition[] = g.nodes.map((node) => ({ ...map.get(node.id)! }));
  separate(points, minSep);
  const result = new Map<Id, NodePosition>();
  g.nodes.forEach((node, i) => result.set(node.id, points[i]));
  return result;
}

/**
 * Uniformly scales+translates every node's world centroid into the box,
 * flipping y (world y-up -> SVG y-down), preserving the centroid cloud's
 * aspect ratio and relative arrangement. Degenerate extent (all centroids
 * equal) collapses to the box center; a following separation pass then
 * pulls any resulting coincident/near-coincident points apart
 * deterministically.
 */
function layoutSpatial(g: LinkGraph, minSep: number): ReadonlyMap<Id, NodePosition> {
  const xs = g.nodes.map((node) => node.centroid.x);
  const ys = g.nodes.map((node) => node.centroid.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const rangeX = maxX - minX;
  const rangeY = maxY - minY;
  const centerX = (minX + maxX) / 2;
  const centerY = (minY + maxY) / 2;

  let scale: number;
  if (rangeX === 0 && rangeY === 0) {
    scale = 0; // every node collapses to the box center; separation pass spreads them out
  } else if (rangeX === 0) {
    scale = BOX / rangeY;
  } else if (rangeY === 0) {
    scale = BOX / rangeX;
  } else {
    scale = Math.min(BOX / rangeX, BOX / rangeY);
  }

  const points: NodePosition[] = g.nodes.map((node) => ({
    x: CENTER + (node.centroid.x - centerX) * scale,
    y: CENTER - (node.centroid.y - centerY) * scale, // flip y
  }));

  separate(points, minSep);

  const map = new Map<Id, NodePosition>();
  g.nodes.forEach((node, i) => map.set(node.id, points[i]));
  return map;
}

/**
 * All nodes equidistant from the box center, ground at the top (angle 0,
 * smallest y), remaining nodes clockwise in BFS order from ground (then any
 * unreachable nodes in doc order).
 */
function layoutCircular(g: LinkGraph, minSep: number): ReadonlyMap<Id, NodePosition> {
  const { order } = bfs(g);
  const n = order.length;
  const map = new Map<Id, NodePosition>();
  order.forEach((id, i) => {
    const theta = (2 * Math.PI * i) / n;
    // theta = 0 -> (CENTER, CENTER - r) = top; increasing theta sweeps clockwise.
    map.set(id, {
      x: CENTER + CIRCULAR_RADIUS * Math.sin(theta),
      y: CENTER - CIRCULAR_RADIUS * Math.cos(theta),
    });
  });
  // Safety pass: a no-op for every current fixture (the smallest circular
  // chord, 16 nodes, is ~0.164 > MIN_NODE_SEPARATION), but guarantees the
  // property for larger/unusual graphs too.
  return applySeparationPass(g, map, minSep);
}

/**
 * Ground at layer 0 (top); y strictly increases with BFS depth; nodes
 * unreachable from ground form one final layer. Within a layer, x order is
 * chosen by the barycenter of each node's BFS parent's x (already assigned,
 * since layers are processed top-down in one sweep), ties broken by
 * document order; the root layer and the unreachable layer (no parent) are
 * ordered by document order directly.
 */
function layoutLayered(g: LinkGraph, minSep: number): ReadonlyMap<Id, NodePosition> {
  const { depth, parent } = bfs(g);
  const nodeIndex = new Map<Id, number>(g.nodes.map((node, i) => [node.id, i]));
  // `depth` always has at least the root's own entry (`layoutGraph` already
  // special-cases 0/1-node graphs before this function ever runs).
  const maxDepth = Math.max(...depth.values());
  const unreached = g.nodes.filter((node) => !depth.has(node.id));
  const numReachedLayers = maxDepth + 1;
  const numLayers = numReachedLayers + (unreached.length > 0 ? 1 : 0);

  const layers: Id[][] = Array.from({ length: numLayers }, () => []);
  for (const [id, d] of depth) layers[d].push(id);
  for (const node of unreached) layers[numReachedLayers].push(node.id);

  const positions = new Map<Id, NodePosition>();
  const xOf = new Map<Id, number>();

  for (let layerIndex = 0; layerIndex < numLayers; layerIndex += 1) {
    const ids = layers[layerIndex];
    // A reached, non-root node always has a BFS parent already positioned in
    // the previous (already-processed) layer, and every node id in `ids`
    // comes from `g.nodes` -- so `parent.get`/`xOf.get`/`nodeIndex.get`
    // below are always defined whenever they're reached.
    const isReachedNonRoot = layerIndex > 0 && layerIndex < numReachedLayers;
    const ordered = ids.slice().sort((a, b) => {
      if (isReachedNonRoot) {
        const xa = xOf.get(parent.get(a)!)!;
        const xb = xOf.get(parent.get(b)!)!;
        if (xa !== xb) return xa - xb;
      }
      return nodeIndex.get(a)! - nodeIndex.get(b)!;
    });

    // `numLayers` is always >= 2 here: `layoutGraph` already special-cases
    // 0/1-node graphs, so a >=2-node graph either reaches a second node
    // (`maxDepth >= 1`) or leaves every non-root node unreached (its own
    // extra final layer) -- either way `numReachedLayers + extra >= 2`.
    const y = MARGIN + (layerIndex * BOX) / (numLayers - 1);
    const m = ordered.length;
    ordered.forEach((id, i) => {
      const x = m > 1 ? MARGIN + (i * BOX) / (m - 1) : CENTER;
      positions.set(id, { x, y });
      xOf.set(id, x);
    });
  }

  // Safety pass: a no-op for every current fixture (layered spacing is
  // >= 0.168 for the <=8-node atlas), but guarantees the property for
  // larger/unusual graphs too.
  return applySeparationPass(g, positions, minSep);
}

/** Optional per-call overrides for `layoutGraph`. */
export interface LayoutOptions {
  /**
   * Minimum center-to-center distance (unit-box units) any two nodes are
   * pushed apart to. Defaults to `MIN_NODE_SEPARATION` (the DEFAULT
   * footprint-derived separation, for jsdom/unit tests with no measured
   * viewport). The real renderer passes a viewport-derived value instead --
   * see `src/ui/graph/graphViewport.ts`'s `computeGraphViewport`.
   */
  minSeparation?: number;
}

/** Places every node of `g` in the unit box per `kind`. Empty graph -> empty map; single node -> box center. */
export function layoutGraph(
  g: LinkGraph,
  kind: GraphLayoutKind,
  options: LayoutOptions = {},
): ReadonlyMap<Id, NodePosition> {
  if (g.nodes.length === 0) return new Map();
  if (g.nodes.length === 1) return new Map([[g.nodes[0].id, { x: CENTER, y: CENTER }]]);
  const minSep = options.minSeparation ?? MIN_NODE_SEPARATION;
  switch (kind) {
    case "spatial":
      return layoutSpatial(g, minSep);
    case "circular":
      return layoutCircular(g, minSep);
    case "layered":
      return layoutLayered(g, minSep);
  }
}
