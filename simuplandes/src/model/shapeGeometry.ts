/**
 * Curved link shapes. Every edge of a plate outline and every segment of a
 * bar's path is a line, a circular arc or a cubic Bézier curve (see
 * `EdgeSchema`). Drawing, hit-testing, bounds and mass properties all work
 * on the FLATTENED shape -- curves replaced by short straight segments --
 * so only this module knows about curves.
 *
 * All points are link-local `[x, y]` tuples. An arc is stored as its
 * `bulge`: twice the sagitta over the chord (= tan of a quarter of the
 * included angle), positive when it bows to the LEFT of start -> end; 0 is
 * straight and +-1 a semicircle. A Bézier edge stores its two control
 * points as offsets from the vertex each one leaves from (`out` from the
 * start, `in` from the end), so they follow their vertices when those move.
 */

import { MAX_BULGE, type Edge, type Link } from "./schema";
import type { Vec2Tuple } from "./vec";
import { barPathSites } from "./document";

/** At most this many degrees of arc per flattened segment. */
const ARC_STEP_DEG = 3;
/** Flattened segments per Bézier edge. */
const BEZIER_STEPS = 32;

const LINE: Edge = { kind: "line" };

/** `edges[i]`, or a straight line when `edges` is missing or shorter. */
export function edgeAt(edges: readonly Edge[] | undefined, i: number): Edge {
  return edges?.[i] ?? LINE;
}

function lerp(a: Vec2Tuple, b: Vec2Tuple, t: number): Vec2Tuple {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
}

/** The unit normal to the LEFT of a -> b, and the chord length. */
function leftNormal(a: Vec2Tuple, b: Vec2Tuple): { n: Vec2Tuple; chord: number } {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const chord = Math.hypot(dx, dy);
  return chord === 0 ? { n: [0, 0], chord } : { n: [-dy / chord, dx / chord], chord };
}

/** Center, radius, start angle and signed sweep of a non-degenerate arc. */
function arcFrame(
  a: Vec2Tuple,
  b: Vec2Tuple,
  bulge: number,
): { center: Vec2Tuple; radius: number; start: number; sweep: number } | null {
  const { n, chord } = leftNormal(a, b);
  if (chord === 0 || bulge === 0) return null;
  const sagitta = (bulge * chord) / 2;
  const radius = (chord * (1 + bulge * bulge)) / (4 * Math.abs(bulge));
  const mid = lerp(a, b, 0.5);
  // The apex is `sagitta` along the left normal; the center is `radius` back from it.
  const along = sagitta - Math.sign(bulge) * radius;
  const center: Vec2Tuple = [mid[0] + n[0] * along, mid[1] + n[1] * along];
  const start = Math.atan2(a[1] - center[1], a[0] - center[0]);
  // Bowing left means travelling clockwise from a to b.
  const sweep = -Math.sign(bulge) * 4 * Math.atan(Math.abs(bulge));
  return { center, radius, start, sweep };
}

function arcPoint(frame: NonNullable<ReturnType<typeof arcFrame>>, t: number): Vec2Tuple {
  const angle = frame.start + frame.sweep * t;
  return [
    frame.center[0] + frame.radius * Math.cos(angle),
    frame.center[1] + frame.radius * Math.sin(angle),
  ];
}

function bezierPoint(
  a: Vec2Tuple,
  c1: Vec2Tuple,
  c2: Vec2Tuple,
  b: Vec2Tuple,
  t: number,
): Vec2Tuple {
  const u = 1 - t;
  const w0 = u * u * u;
  const w1 = 3 * u * u * t;
  const w2 = 3 * u * t * t;
  const w3 = t * t * t;
  return [
    w0 * a[0] + w1 * c1[0] + w2 * c2[0] + w3 * b[0],
    w0 * a[1] + w1 * c1[1] + w2 * c2[1] + w3 * b[1],
  ];
}

/** A Bézier edge's absolute control points. */
export function bezierControls(
  a: Vec2Tuple,
  b: Vec2Tuple,
  edge: Extract<Edge, { kind: "bezier" }>,
): [Vec2Tuple, Vec2Tuple] {
  return [
    [a[0] + edge.out[0], a[1] + edge.out[1]],
    [b[0] + edge.in[0], b[1] + edge.in[1]],
  ];
}

/** The point at parameter `t` in [0, 1] along the edge a -> b. */
export function edgePoint(a: Vec2Tuple, b: Vec2Tuple, edge: Edge, t: number): Vec2Tuple {
  if (edge.kind === "arc") {
    const frame = arcFrame(a, b, edge.bulge);
    return frame ? arcPoint(frame, t) : lerp(a, b, t);
  }
  if (edge.kind === "bezier") {
    const [c1, c2] = bezierControls(a, b, edge);
    return bezierPoint(a, c1, c2, b, t);
  }
  return lerp(a, b, t);
}

/** The edge's midpoint (t = 0.5): its apex for an arc. */
export function edgeMidpoint(a: Vec2Tuple, b: Vec2Tuple, edge: Edge): Vec2Tuple {
  return edgePoint(a, b, edge, 0.5);
}

/** The flattened edge a -> b, WITHOUT `a` and WITH `b`. */
export function flattenEdge(a: Vec2Tuple, b: Vec2Tuple, edge: Edge): Vec2Tuple[] {
  let steps = 1;
  if (edge.kind === "arc") {
    const frame = arcFrame(a, b, edge.bulge);
    if (frame)
      steps = Math.max(2, Math.ceil(Math.abs((frame.sweep * 180) / Math.PI) / ARC_STEP_DEG));
  } else if (edge.kind === "bezier") {
    steps = BEZIER_STEPS;
  }
  const out: Vec2Tuple[] = [];
  for (let i = 1; i < steps; i++) out.push(edgePoint(a, b, edge, i / steps));
  out.push([b[0], b[1]]);
  return out;
}

/** A plate's flattened outline (closed implicitly: the last point joins the first). */
export function flattenOutline(
  outline: readonly Vec2Tuple[],
  edges?: readonly Edge[],
): Vec2Tuple[] {
  if (outline.length === 0) return [];
  const out: Vec2Tuple[] = [];
  outline.forEach((a, i) => {
    out.push([a[0], a[1]]);
    const b = outline[(i + 1) % outline.length];
    out.push(...flattenEdge(a, b, edgeAt(edges, i)).slice(0, -1));
  });
  return out;
}

/** A bar's flattened path (open), link-local; empty for a plate. */
export function flattenBar(link: Pick<Link, "shape" | "sites">): Vec2Tuple[] {
  if (link.shape.kind !== "bar") return [];
  const points = barPathSites(link).map((site) => site.local);
  if (points.length === 0) return [];
  const out: Vec2Tuple[] = [[points[0][0], points[0][1]]];
  for (let i = 1; i < points.length; i++) {
    out.push(...flattenEdge(points[i - 1], points[i], edgeAt(link.shape.edges, i - 1)));
  }
  return out;
}

/** A link's flattened shape: a bar's open polyline or a plate's closed outline. */
export function flattenShape(link: Pick<Link, "shape" | "sites">): Vec2Tuple[] {
  return link.shape.kind === "plate"
    ? flattenOutline(link.shape.outline, link.shape.edges)
    : flattenBar(link);
}

/** The bulge of the arc a -> b through `p` (its signed distance from the chord sets the sagitta), clamped. */
export function bulgeThrough(a: Vec2Tuple, b: Vec2Tuple, p: Vec2Tuple): number {
  const { n, chord } = leftNormal(a, b);
  if (chord === 0) return 0;
  const sagitta = (p[0] - a[0]) * n[0] + (p[1] - a[1]) * n[1];
  const bulge = (2 * sagitta) / chord;
  return Math.max(-MAX_BULGE, Math.min(MAX_BULGE, bulge));
}

/** The default bend given to an edge first turned into an arc. */
const DEFAULT_BULGE = 0.4;

/** `edge` re-expressed as `kind`, keeping its shape where it can. */
export function convertEdge(a: Vec2Tuple, b: Vec2Tuple, edge: Edge, kind: Edge["kind"]): Edge {
  if (edge.kind === kind) return edge;
  if (kind === "line") return LINE;
  if (kind === "arc") {
    const bulge = edge.kind === "line" ? 0 : bulgeThrough(a, b, edgeMidpoint(a, b, edge));
    return { kind: "arc", bulge: Math.abs(bulge) < 1e-6 ? DEFAULT_BULGE : bulge };
  }
  return toBezier(a, b, edge.kind === "arc" ? edge.bulge : DEFAULT_BULGE);
}

/**
 * The standard cubic Bézier approximation of the arc a -> b with `bulge`:
 * exact at both ends and the apex, off by about 0.03% of the radius for a
 * quarter circle and about 1% for a semicircle.
 */
function toBezier(a: Vec2Tuple, b: Vec2Tuple, bulge: number): Edge {
  const frame = arcFrame(a, b, bulge);
  if (!frame) return { kind: "bezier", out: [0, 0], in: [0, 0] };
  const { radius, start, sweep } = frame;
  const k = (4 / 3) * Math.tan(sweep / 4) * radius;
  const end = start + sweep;
  // Tangents follow the direction of travel (the sign of `sweep`).
  const tangentAt = (angle: number): Vec2Tuple => [-Math.sin(angle), Math.cos(angle)];
  const ts = tangentAt(start);
  const te = tangentAt(end);
  return { kind: "bezier", out: [ts[0] * k, ts[1] * k], in: [-te[0] * k, -te[1] * k] };
}

/**
 * Splits the edge a -> b at its midpoint without changing its shape:
 * the new vertex, and the edges either side of it.
 */
export function splitEdge(
  a: Vec2Tuple,
  b: Vec2Tuple,
  edge: Edge,
): { mid: Vec2Tuple; first: Edge; second: Edge } {
  const mid = edgeMidpoint(a, b, edge);
  if (edge.kind === "arc") {
    // Half the included angle: bulge' = tan(atan(bulge) / 2).
    const half = Math.tan(Math.atan(edge.bulge) / 2);
    return { mid, first: { kind: "arc", bulge: half }, second: { kind: "arc", bulge: half } };
  }
  if (edge.kind === "bezier") {
    // De Casteljau at t = 0.5.
    const [c1, c2] = bezierControls(a, b, edge);
    const p01 = lerp(a, c1, 0.5);
    const p12 = lerp(c1, c2, 0.5);
    const p23 = lerp(c2, b, 0.5);
    const p012 = lerp(p01, p12, 0.5);
    const p123 = lerp(p12, p23, 0.5);
    const rel = (p: Vec2Tuple, from: Vec2Tuple): Vec2Tuple => [p[0] - from[0], p[1] - from[1]];
    return {
      mid,
      first: { kind: "bezier", out: rel(p01, a), in: rel(p012, mid) },
      second: { kind: "bezier", out: rel(p123, mid), in: rel(p23, b) },
    };
  }
  return { mid, first: LINE, second: LINE };
}

/**
 * Edges for a vertex list that lost or gained vertices: an edge between
 * vertices that were already neighbors (same order) keeps its curve; any
 * new pairing is a straight line. `oldIndexOf[i]` is the old index of new
 * vertex i, or -1 for a brand-new vertex. `closed` wraps the last vertex
 * to the first (a plate); otherwise there is one edge fewer (a bar).
 */
export function remapEdges(
  edges: readonly Edge[] | undefined,
  oldCount: number,
  oldIndexOf: readonly number[],
  closed: boolean,
): Edge[] {
  const count = closed ? oldIndexOf.length : Math.max(0, oldIndexOf.length - 1);
  const out: Edge[] = [];
  for (let i = 0; i < count; i++) {
    const from = oldIndexOf[i];
    const to = oldIndexOf[(i + 1) % oldIndexOf.length];
    const wasEdge =
      from >= 0 && to >= 0 && (closed ? (from + 1) % oldCount === to : from + 1 === to);
    out.push(wasEdge ? edgeAt(edges, from) : LINE);
  }
  return out;
}
