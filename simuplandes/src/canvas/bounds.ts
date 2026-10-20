/**
 * A pure world-space axis-aligned bounding box, and `documentBounds`: the
 * union of every site, plate-outline vertex and marker in a document,
 * transformed to world coordinates via each entity's owning link's pose.
 */

import {
  flattenShape,
  indexDocument,
  siteWorldPosition,
  type Link,
  type MechanismDocument,
  type Pose,
} from "../model";
import type { Vec2 } from "../geom";
import type { PoseOptions, TracePrimitive } from "./posesSource";

export interface Bounds {
  min: Vec2;
  max: Vec2;
}

/** Grows `b` (or starts a new bounds if `b` is `null`) to include `p`. */
export function expandBounds(b: Bounds | null, p: Vec2): Bounds {
  if (b === null) {
    return { min: { x: p.x, y: p.y }, max: { x: p.x, y: p.y } };
  }
  return {
    min: { x: Math.min(b.min.x, p.x), y: Math.min(b.min.y, p.y) },
    max: { x: Math.max(b.max.x, p.x), y: Math.max(b.max.y, p.y) },
  };
}

export interface DocumentBoundsOptions extends PoseOptions {
  /** Coupler-curve traces drawn on the canvas; their points count toward the bounds. */
  readonly traces?: readonly TracePrimitive[];
}

/**
 * The bounding box of every site world position, every plate outline
 * vertex (transformed by its link's pose) and every marker world position
 * in `doc`. With `options.poses`, each link uses its posed geometry (the
 * same override the canvas renders in Simulate mode) instead of its
 * reference pose; `options.traces` adds every trace point. An empty
 * document (no links and no markers with a resolvable link) returns `null`.
 */
export function documentBounds(
  doc: MechanismDocument,
  options?: DocumentBoundsOptions,
): Bounds | null {
  let bounds: Bounds | null = null;
  const poseOf = (link: Link): Pose => options?.poses?.get(link.id) ?? link.pose;

  for (const link of doc.links) {
    const posed = { pose: poseOf(link) };
    for (const site of link.sites) {
      bounds = expandBounds(bounds, siteWorldPosition(posed, site.local));
    }
    // The drawn shape: a curved edge can reach past its vertices.
    for (const point of flattenShape(link)) {
      bounds = expandBounds(bounds, siteWorldPosition(posed, point));
    }
  }

  for (const annotation of doc.annotations) {
    const r = annotation.width / 2;
    for (const [x, y] of annotation.points) {
      bounds = expandBounds(bounds, { x: x - r, y: y - r });
      bounds = expandBounds(bounds, { x: x + r, y: y + r });
    }
  }

  if (doc.markers.length > 0) {
    const index = indexDocument(doc);
    for (const marker of doc.markers) {
      const link = index.links.get(marker.linkId);
      if (link) {
        bounds = expandBounds(bounds, siteWorldPosition({ pose: poseOf(link) }, marker.local));
      }
    }
  }

  for (const trace of options?.traces ?? []) {
    for (let i = 0; i + 1 < trace.points.length; i += 2) {
      bounds = expandBounds(bounds, { x: trace.points[i], y: trace.points[i + 1] });
    }
  }

  return bounds;
}

/** The smallest bounds containing both `a` and `b` (either may be `null`). */
export function unionBounds(a: Bounds | null, b: Bounds | null): Bounds | null {
  if (a === null) return b;
  if (b === null) return a;
  return expandBounds(expandBounds(a, b.min), b.max);
}

/**
 * Everything the mechanism occupies over its motion: the reference pose, each
 * of `sweepPoses` (link poses sampled along the sweep) and every trace point.
 * Used to frame a freshly opened mechanism so it never moves off screen.
 */
export function motionBounds(
  doc: MechanismDocument,
  sweepPoses: readonly ReadonlyMap<string, Pose>[],
  traces?: readonly TracePrimitive[],
): Bounds | null {
  let bounds = documentBounds(doc, { traces });
  for (const poses of sweepPoses) {
    bounds = unionBounds(bounds, documentBounds(doc, { poses }));
  }
  return bounds;
}
