/**
 * The pure snapping engine: `computeSnap(cursorWorld, doc, options)` returns
 * the single best snap candidate under a fixed priority order. Called from
 * every drawing tool's pointer handler and from `CanvasStage`'s status-bar
 * publish. No React/Konva (purity rule); one `indexDocument` pass per call
 * is fine for the documents this app targets (<= ~200 sites).
 *
 * Priority: site > midpoint > grid (within radius) > angle ray (within
 * radius, only with an anchor) > none.
 *
 * Decision (deviates from the research sketch of object > angle > grid):
 * grid beats angle here, not the other way around. The research assumed an
 * always-visible grid, where "nearest object wins" naturally puts a 15deg
 * ray ahead of a merely-nearby grid line. This engine's grid candidate is
 * itself radius-limited (only "within radius" counts, same as every other
 * kind) so an exact grid point directly under the cursor must win -- if
 * angle won instead, clicking squarely on a grid point near a 15deg ray
 * from some anchor would silently land off-grid, which is worse than the
 * reverse (an angle-ray click landing on a coincidentally-nearby grid
 * point only happens when the two literally overlap).
 */

import { distance, direction, magnitude, sub, dot, type Vec2 } from "../geom";
import { siteWorldPosition, type MechanismDocument, type Id } from "../model";
import { radToDeg, degToRad } from "../model/units";

export type SnapKind = "site" | "midpoint" | "grid" | "angle" | "none";

export interface SnapResult {
  kind: SnapKind;
  point: Vec2;
  siteId?: Id;
  linkId?: Id;
  angleDeg?: number;
}

export interface SnapOptions {
  /** Snap radius, in WORLD units (convert screen px via `screenLengthToWorld`/`8 / zoom`). */
  radiusWorld: number;
  gridSpacing: number;
  /** Degrees between angle-snap rays. Defaults to 15. */
  angleStepDeg?: number;
  /** Origin for the angle-ray candidate. No anchor -> no angle candidate. */
  anchor?: Vec2;
  /** `false` forces "none" unconditionally. Defaults to true. */
  enabled?: boolean;
  /** Sites to skip when scanning for a site candidate (e.g. sites mid-drag). */
  excludeSiteIds?: ReadonlySet<Id>;
  kinds?: Partial<Record<Exclude<SnapKind, "none">, boolean>>;
}

function normalizeAngleDeg(deg: number): number {
  return ((deg % 360) + 360) % 360;
}

function findNearestSite(
  cursor: Vec2,
  doc: MechanismDocument,
  radiusWorld: number,
  excludeSiteIds: ReadonlySet<Id> | undefined,
): { siteId: Id; linkId: Id; point: Vec2 } | null {
  let best: { siteId: Id; linkId: Id; point: Vec2; dist: number } | null = null;
  for (const link of doc.links) {
    for (const site of link.sites) {
      if (excludeSiteIds?.has(site.id)) continue;
      const point = siteWorldPosition(link, site.local);
      const dist = distance(cursor, point);
      if (dist <= radiusWorld && (best === null || dist < best.dist)) {
        best = { siteId: site.id, linkId: link.id, point, dist };
      }
    }
  }
  return best;
}

function findNearestMidpoint(
  cursor: Vec2,
  doc: MechanismDocument,
  radiusWorld: number,
): { linkId: Id; point: Vec2 } | null {
  let best: { linkId: Id; point: Vec2; dist: number } | null = null;

  const consider = (linkId: Id, a: Vec2, b: Vec2): void => {
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const dist = distance(cursor, mid);
    if (dist <= radiusWorld && (best === null || dist < best.dist)) {
      best = { linkId, point: mid, dist };
    }
  };

  for (const link of doc.links) {
    if (!link.isGround && link.shape.kind === "bar" && link.sites.length === 2) {
      consider(
        link.id,
        siteWorldPosition(link, link.sites[0].local),
        siteWorldPosition(link, link.sites[1].local),
      );
    }
    if (link.shape.kind === "plate") {
      const outline = link.shape.outline;
      for (let i = 0; i < outline.length; i++) {
        const a = siteWorldPosition(link, outline[i]);
        const b = siteWorldPosition(link, outline[(i + 1) % outline.length]);
        consider(link.id, a, b);
      }
    }
  }
  return best;
}

function findGridSnap(cursor: Vec2, gridSpacing: number, radiusWorld: number): Vec2 | null {
  if (!(gridSpacing > 0)) return null;
  const point = {
    x: Math.round(cursor.x / gridSpacing) * gridSpacing,
    y: Math.round(cursor.y / gridSpacing) * gridSpacing,
  };
  return distance(cursor, point) <= radiusWorld ? point : null;
}

function findAngleSnap(
  cursor: Vec2,
  anchor: Vec2,
  angleStepDeg: number,
  radiusWorld: number,
): { point: Vec2; angleDeg: number } | null {
  const rel = sub(cursor, anchor);
  if (magnitude(rel) <= 1e-9) return null;

  const cursorAngleDeg = radToDeg(direction(rel));
  const nearestMultiple = Math.round(cursorAngleDeg / angleStepDeg) * angleStepDeg;
  const rayAngleRad = degToRad(nearestMultiple);
  const rayDir: Vec2 = { x: Math.cos(rayAngleRad), y: Math.sin(rayAngleRad) };
  const projLength = dot(rel, rayDir);
  const point: Vec2 = {
    x: anchor.x + rayDir.x * projLength,
    y: anchor.y + rayDir.y * projLength,
  };
  return distance(cursor, point) <= radiusWorld
    ? { point, angleDeg: normalizeAngleDeg(nearestMultiple) }
    : null;
}

/** The single best snap candidate under `cursor`, per this module's priority order. */
export function computeSnap(cursor: Vec2, doc: MechanismDocument, opts: SnapOptions): SnapResult {
  if (opts.enabled === false) {
    return { kind: "none", point: cursor };
  }

  if (opts.kinds?.site !== false) {
    const site = findNearestSite(cursor, doc, opts.radiusWorld, opts.excludeSiteIds);
    if (site) {
      return { kind: "site", point: site.point, siteId: site.siteId, linkId: site.linkId };
    }
  }

  if (opts.kinds?.midpoint !== false) {
    const midpoint = findNearestMidpoint(cursor, doc, opts.radiusWorld);
    if (midpoint) {
      return { kind: "midpoint", point: midpoint.point, linkId: midpoint.linkId };
    }
  }

  if (opts.kinds?.grid !== false) {
    const gridPoint = findGridSnap(cursor, opts.gridSpacing, opts.radiusWorld);
    if (gridPoint) {
      return { kind: "grid", point: gridPoint };
    }
  }

  if (opts.kinds?.angle !== false && opts.anchor) {
    const angle = findAngleSnap(cursor, opts.anchor, opts.angleStepDeg ?? 15, opts.radiusWorld);
    if (angle) {
      return { kind: "angle", point: angle.point, angleDeg: angle.angleDeg };
    }
  }

  return { kind: "none", point: cursor };
}
