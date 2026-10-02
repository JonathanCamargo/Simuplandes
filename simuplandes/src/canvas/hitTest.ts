/**
 * Pure world-space hit-testing and box-selection over a document: sites,
 * joints, markers and link bodies. One code path backs snapping,
 * hit-testing and box selection -- Konva shapes are rendered
 * `listening={false}` and only the Stage receives pointer events, so there
 * is no separate Konva hit-graph to keep in sync.
 *
 * Phase 5 pose seam (research Pitfall 1): `hitTest`/`sitesNear` accept an
 * optional `options.poses` override, exactly mirroring `renderModel.ts`'s
 * `poseOf`. In Simulate mode a drag must grab what's actually drawn -- the
 * posed geometry -- not the document's reference pose. `entitiesInBox` is
 * unchanged: box-select is a Build-only tool.
 */

import { distance, dot, sub, type Vec2 } from "../geom";
import {
  indexDocument,
  siteWorldPosition,
  type Id,
  type Link,
  type MechanismDocument,
  type Pose,
} from "../model";
import type { Bounds } from "./bounds";
import type { PoseOptions } from "./posesSource";

export type { PoseOptions };

export type HitResult =
  | { kind: "marker"; markerId: Id }
  | { kind: "joint"; jointId: Id; siteId: Id; linkId: Id }
  | { kind: "site"; siteId: Id; linkId: Id }
  | { kind: "link"; linkId: Id }
  | { kind: "none" };

function distanceToSegment(p: Vec2, a: Vec2, b: Vec2): number {
  const ab = sub(b, a);
  const abLenSq = ab.x * ab.x + ab.y * ab.y;
  if (abLenSq <= 1e-18) return distance(p, a);
  const t = Math.min(1, Math.max(0, dot(sub(p, a), ab) / abLenSq));
  const closest = { x: a.x + ab.x * t, y: a.y + ab.y * t };
  return distance(p, closest);
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

function poseOf(link: Link, options?: PoseOptions): Pose {
  return options?.poses?.get(link.id) ?? link.pose;
}

function hitTestLinkBody(link: Link, p: Vec2, radiusWorld: number, options?: PoseOptions): boolean {
  const pose = poseOf(link, options);
  if (link.shape.kind === "bar") {
    if (link.sites.length < 2) return false;
    const points = link.sites.map((s) => siteWorldPosition({ pose }, s.local));
    for (let i = 0; i < points.length - 1; i++) {
      if (distanceToSegment(p, points[i], points[i + 1]) <= radiusWorld) return true;
    }
    return false;
  }

  // plate
  const polygon = link.shape.outline.map((v) => siteWorldPosition({ pose }, v));
  if (pointInPolygon(p, polygon)) return true;
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i];
    const b = polygon[(i + 1) % polygon.length];
    if (distanceToSegment(p, a, b) <= radiusWorld) return true;
  }
  return false;
}

/**
 * Hit-tests `p` against `doc`, priority marker > site (or joint, if the
 * site belongs to one) > link body > none. Ground links are hittable only
 * via their sites (their body is never returned as a `"link"` hit); the
 * topmost link body is the last one in document order.
 */
export function hitTest(
  doc: MechanismDocument,
  p: Vec2,
  radiusWorld: number,
  options?: PoseOptions,
): HitResult {
  const index = indexDocument(doc);

  let bestMarker: { markerId: Id; dist: number } | null = null;
  for (const marker of doc.markers) {
    const link = index.links.get(marker.linkId);
    if (!link) continue;
    const point = siteWorldPosition({ pose: poseOf(link, options) }, marker.local);
    const dist = distance(p, point);
    if (dist <= radiusWorld && (bestMarker === null || dist < bestMarker.dist)) {
      bestMarker = { markerId: marker.id, dist };
    }
  }
  if (bestMarker) return { kind: "marker", markerId: bestMarker.markerId };

  let bestSite: { siteId: Id; linkId: Id; dist: number } | null = null;
  for (const link of doc.links) {
    for (const site of link.sites) {
      const point = siteWorldPosition({ pose: poseOf(link, options) }, site.local);
      const dist = distance(p, point);
      if (dist <= radiusWorld && (bestSite === null || dist < bestSite.dist)) {
        bestSite = { siteId: site.id, linkId: link.id, dist };
      }
    }
  }
  if (bestSite) {
    const joints = index.jointsBySite.get(bestSite.siteId);
    if (joints && joints.length > 0) {
      return {
        kind: "joint",
        jointId: joints[0].id,
        siteId: bestSite.siteId,
        linkId: bestSite.linkId,
      };
    }
    return { kind: "site", siteId: bestSite.siteId, linkId: bestSite.linkId };
  }

  let hitLinkId: Id | null = null;
  for (const link of doc.links) {
    if (link.isGround) continue;
    if (hitTestLinkBody(link, p, radiusWorld, options)) {
      hitLinkId = link.id; // later document order overwrites -> topmost wins
    }
  }
  if (hitLinkId !== null) return { kind: "link", linkId: hitLinkId };

  return { kind: "none" };
}

export interface SiteNear {
  siteId: Id;
  linkId: Id;
  isGround: boolean;
  point: Vec2;
  distance: number;
}

/**
 * Every site within `radiusWorld` of `p`, sorted nearest-first (ties broken
 * by document order via a stable sort). Unlike `hitTest`/`computeSnap`
 * (which each resolve to a single "the" site), this returns every
 * coincident candidate -- the ground/pin tools need to choose among them
 * (e.g. "prefer a moving site not already grounded" over the ground site
 * itself when both sit at the same point).
 */
export function sitesNear(
  doc: MechanismDocument,
  p: Vec2,
  radiusWorld: number,
  options?: PoseOptions,
): SiteNear[] {
  const results: SiteNear[] = [];
  for (const link of doc.links) {
    for (const site of link.sites) {
      const point = siteWorldPosition({ pose: poseOf(link, options) }, site.local);
      const dist = distance(p, point);
      if (dist <= radiusWorld) {
        results.push({
          siteId: site.id,
          linkId: link.id,
          isGround: link.isGround,
          point,
          distance: dist,
        });
      }
    }
  }
  results.sort((a, b) => a.distance - b.distance);
  return results;
}

function pointInBox(p: Vec2, box: Bounds): boolean {
  return p.x >= box.min.x && p.x <= box.max.x && p.y >= box.min.y && p.y <= box.max.y;
}

/**
 * Ids fully/partly enclosed by `box`: non-ground links whose every site
 * (and, for a plate, every outline vertex) lies inside the box, markers
 * inside the box, and joints with at least one site inside the box.
 */
export function entitiesInBox(doc: MechanismDocument, box: Bounds): Id[] {
  const index = indexDocument(doc);
  const ids: Id[] = [];

  for (const link of doc.links) {
    if (link.isGround || link.sites.length === 0) continue;
    const sitesInside = link.sites.every((s) => pointInBox(siteWorldPosition(link, s.local), box));
    const outlineInside =
      link.shape.kind === "plate"
        ? link.shape.outline.every((v) => pointInBox(siteWorldPosition(link, v), box))
        : true;
    if (sitesInside && outlineInside) ids.push(link.id);
  }

  for (const marker of doc.markers) {
    const link = index.links.get(marker.linkId);
    if (link && pointInBox(siteWorldPosition(link, marker.local), box)) ids.push(marker.id);
  }

  for (const joint of doc.joints) {
    const entryA = index.sites.get(joint.siteA);
    const entryB = index.sites.get(joint.siteB);
    const aInside = entryA
      ? pointInBox(siteWorldPosition(entryA.link, entryA.site.local), box)
      : false;
    const bInside = entryB
      ? pointInBox(siteWorldPosition(entryB.link, entryB.site.local), box)
      : false;
    if (aInside || bInside) ids.push(joint.id);
  }

  return ids;
}
