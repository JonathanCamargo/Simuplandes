/**
 * Where a joint can attach: an existing site, or any point on a moving
 * link's body (a bar's drawn path, a plate's area or outline). The joint
 * tools (Pin, Ground pivot, Bar ends) and the `"link"` snap candidate share
 * these helpers so the cue under the cursor and the joint a click creates
 * are always the same point.
 *
 * Ground's body is never an attachment: ground is reached through its
 * sites, and a click in empty space is how a new ground pivot is placed.
 */

import { distance, dot, sub, type Vec2 } from "../geom";
import {
  flattenBar,
  flattenOutline,
  siteWorldPosition,
  type Id,
  type Link,
  type MechanismDocument,
} from "../model";
import { sitesNear } from "./hitTest";

export type Attachment =
  | { kind: "site"; siteId: Id; linkId: Id; isGround: boolean; point: Vec2; distance: number }
  | { kind: "link"; linkId: Id; point: Vec2; distance: number };

/** The nearest point on a link's body to `p`, within `radiusWorld`, or `null`. */
export interface LinkPoint {
  point: Vec2;
  distance: number;
  /** The bar segment (world points) the point lies on; absent inside a plate. */
  segment?: readonly [Vec2, Vec2];
}

function closestOnSegment(p: Vec2, a: Vec2, b: Vec2): Vec2 {
  const ab = sub(b, a);
  const abLenSq = ab.x * ab.x + ab.y * ab.y;
  if (abLenSq <= 1e-18) return a;
  const t = Math.min(1, Math.max(0, dot(sub(p, a), ab) / abLenSq));
  return { x: a.x + ab.x * t, y: a.y + ab.y * t };
}

function pointInPolygon(p: Vec2, polygon: readonly Vec2[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const vi = polygon[i];
    const vj = polygon[j];
    const intersects =
      vi.y > p.y !== vj.y > p.y && p.x < ((vj.x - vi.x) * (p.y - vi.y)) / (vj.y - vi.y) + vi.x;
    if (intersects) inside = !inside;
  }
  return inside;
}

/** The point of `link`'s body nearest `p` (a bar: on its path; a plate: `p` itself when inside). */
export function linkPointNear(link: Link, p: Vec2, radiusWorld: number): LinkPoint | null {
  if (link.isGround) return null;
  const world = (local: readonly [number, number]): Vec2 => siteWorldPosition(link, local);
  const points =
    link.shape.kind === "bar"
      ? flattenBar(link).map(world)
      : flattenOutline(link.shape.outline, link.shape.edges).map(world);
  if (link.shape.kind === "plate" && points.length >= 3 && pointInPolygon(p, points)) {
    return { point: p, distance: 0 };
  }
  const closed = link.shape.kind === "plate";
  let best: LinkPoint | null = null;
  const count = closed ? points.length : points.length - 1;
  for (let i = 0; i < count; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    const point = closestOnSegment(p, a, b);
    const dist = distance(p, point);
    if (dist <= radiusWorld && (best === null || dist < best.distance)) {
      best = { point, distance: dist, segment: [a, b] };
    }
  }
  return best;
}

/**
 * Every link a joint placed at `p` could attach to, at most one per link:
 * its nearest site within `radiusWorld` if it has one, else the nearest
 * point on its body. Sites come first (nearest first), then bodies
 * (nearest first, the topmost link winning a tie).
 */
export function attachmentsAt(doc: MechanismDocument, p: Vec2, radiusWorld: number): Attachment[] {
  const sites: Attachment[] = [];
  const seen = new Set<Id>();
  for (const near of sitesNear(doc, p, radiusWorld)) {
    if (seen.has(near.linkId)) continue;
    seen.add(near.linkId);
    sites.push({ kind: "site", ...near });
  }
  const bodies: Attachment[] = [];
  for (let i = doc.links.length - 1; i >= 0; i--) {
    const link = doc.links[i];
    if (seen.has(link.id)) continue;
    const near = linkPointNear(link, p, radiusWorld);
    if (near)
      bodies.push({ kind: "link", linkId: link.id, point: near.point, distance: near.distance });
  }
  bodies.sort((a, b) => a.distance - b.distance);
  return [...sites, ...bodies];
}

/** Where two segments' lines cross, if they do within both segments (with a `slack` margin). */
export function segmentIntersection(
  a: readonly [Vec2, Vec2],
  b: readonly [Vec2, Vec2],
  slack = 0,
): Vec2 | null {
  const r = sub(a[1], a[0]);
  const s = sub(b[1], b[0]);
  const denom = r.x * s.y - r.y * s.x;
  if (Math.abs(denom) < 1e-12) return null;
  const qp = sub(b[0], a[0]);
  const t = (qp.x * s.y - qp.y * s.x) / denom;
  const u = (qp.x * r.y - qp.y * r.x) / denom;
  const point = { x: a[0].x + r.x * t, y: a[0].y + r.y * t };
  const lenR = Math.hypot(r.x, r.y);
  const lenS = Math.hypot(s.x, s.y);
  const inA = t * lenR >= -slack && (t - 1) * lenR <= slack;
  const inB = u * lenS >= -slack && (u - 1) * lenS <= slack;
  return inA && inB ? point : null;
}

/**
 * The one world point where a joint between the first two attachments
 * should go: a site's own point when either is a site, the crossing of two
 * bars when they cross near `p`, else the first body's nearest point.
 */
export function jointPoint(
  doc: MechanismDocument,
  first: Attachment,
  second: Attachment,
  p: Vec2,
  radiusWorld: number,
): Vec2 {
  if (first.kind === "site") return first.point;
  if (second.kind === "site") return second.point;
  const linkA = doc.links.find((l) => l.id === first.linkId);
  const linkB = doc.links.find((l) => l.id === second.linkId);
  const nearA = linkA ? linkPointNear(linkA, p, radiusWorld) : null;
  const nearB = linkB ? linkPointNear(linkB, p, radiusWorld) : null;
  if (nearA?.segment && nearB?.segment) {
    const crossing = segmentIntersection(nearA.segment, nearB.segment, radiusWorld);
    if (crossing && distance(crossing, p) <= radiusWorld * 2) return crossing;
  }
  return first.point;
}
