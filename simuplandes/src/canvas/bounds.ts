/**
 * A pure world-space axis-aligned bounding box, and `documentBounds`: the
 * union of every site, plate-outline vertex and marker in a document,
 * transformed to world coordinates via each entity's owning link's pose.
 */

import { indexDocument, siteWorldPosition, type MechanismDocument } from "../model";
import type { Vec2 } from "../geom";

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

/**
 * The bounding box of every site world position, every plate outline
 * vertex (transformed by its link's pose) and every marker world position
 * in `doc`. An empty document (no links and no markers with a resolvable
 * link) returns `null`.
 */
export function documentBounds(doc: MechanismDocument): Bounds | null {
  let bounds: Bounds | null = null;

  for (const link of doc.links) {
    for (const site of link.sites) {
      bounds = expandBounds(bounds, siteWorldPosition(link, site.local));
    }
    if (link.shape.kind === "plate") {
      for (const vertex of link.shape.outline) {
        bounds = expandBounds(bounds, siteWorldPosition(link, vertex));
      }
    }
  }

  if (doc.markers.length > 0) {
    const index = indexDocument(doc);
    for (const marker of doc.markers) {
      const link = index.links.get(marker.linkId);
      if (link) {
        bounds = expandBounds(bounds, siteWorldPosition(link, marker.local));
      }
    }
  }

  return bounds;
}
