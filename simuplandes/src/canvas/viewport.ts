/**
 * The pure y-up world <-> y-down Konva-screen transform, and pan/zoom/fit
 * over it. This is the ONLY module in `src/canvas` that flips the y-axis:
 * `src/geom`/`src/model` stay y-up, CCW-positive everywhere, and every
 * Konva layer feeds already-flipped screen coordinates (via
 * `worldToScreen`) into its shapes -- never a negative Konva scale (see
 * `eslint.config.js`'s no-negative-Konva-scale rule).
 *
 * Angle convention: `link.pose.angle` (radians, CCW-positive, y-up) is
 * negated ONLY at the point it becomes a Konva `rotation` prop (Konva's
 * rotation is clockwise-positive on its y-down canvas), via
 * `angleToKonvaRotationDeg`. Never negate an angle anywhere else.
 */

import { type Vec2 } from "../geom";
import { radToDeg } from "../model/units";
import type { Bounds } from "./bounds";

/** A camera over the world: `zoom` is screen pixels per world unit. */
export interface Viewport {
  /** The world point that renders at the centre of the screen. */
  panWorld: Vec2;
  /** Screen pixels per world unit. */
  zoom: number;
  widthPx: number;
  heightPx: number;
}

export const MIN_ZOOM = 0.02;
export const MAX_ZOOM = 500;

function clampZoom(zoom: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
}

/** Converts a world point to a screen point. The only place +y (world) becomes -y (screen). */
export function worldToScreen(v: Viewport, p: Vec2): Vec2 {
  return {
    x: (p.x - v.panWorld.x) * v.zoom + v.widthPx / 2,
    y: v.heightPx / 2 - (p.y - v.panWorld.y) * v.zoom,
  };
}

/** The exact inverse of `worldToScreen`. */
export function screenToWorld(v: Viewport, s: Vec2): Vec2 {
  return {
    x: (s.x - v.widthPx / 2) / v.zoom + v.panWorld.x,
    y: -(s.y - v.heightPx / 2) / v.zoom + v.panWorld.y,
  };
}

/** Converts a world-space length to a screen-space length (no translation/flip). */
export function worldLengthToScreen(v: Viewport, len: number): number {
  return len * v.zoom;
}

/** Converts a screen-space length to a world-space length (no translation/flip). */
export function screenLengthToWorld(v: Viewport, px: number): number {
  return px / v.zoom;
}

/**
 * Zooms by `factor` (>1 zooms in, <1 zooms out) around `screenPt`, keeping
 * `screenToWorld(result, screenPt)` equal to `screenToWorld(v, screenPt)`.
 * Zoom is clamped to `[MIN_ZOOM, MAX_ZOOM]`.
 */
export function zoomAt(v: Viewport, screenPt: Vec2, factor: number): Viewport {
  const zoom = clampZoom(v.zoom * factor);
  const worldAtPt = screenToWorld(v, screenPt);
  const panWorld: Vec2 = {
    x: worldAtPt.x - (screenPt.x - v.widthPx / 2) / zoom,
    y: worldAtPt.y + (screenPt.y - v.heightPx / 2) / zoom,
  };
  return { panWorld, zoom, widthPx: v.widthPx, heightPx: v.heightPx };
}

/** Pans so that world content moves `d.dx`/`d.dy` screen pixels (right/down positive). */
export function panByScreen(v: Viewport, d: { dx: number; dy: number }): Viewport {
  return {
    ...v,
    panWorld: {
      x: v.panWorld.x - d.dx / v.zoom,
      y: v.panWorld.y + d.dy / v.zoom,
    },
  };
}

/**
 * Frames `bounds` with `marginPx` of screen margin on every side, centred.
 * A zero-area bounds (a single point, or `min === max`) keeps the current
 * zoom and centres that point. `bounds === null` (an empty document) falls
 * back to `defaultViewport`.
 */
export function fitToBounds(v: Viewport, bounds: Bounds | null, marginPx = 40): Viewport {
  if (bounds === null) return defaultViewport(v.widthPx, v.heightPx);

  const width = bounds.max.x - bounds.min.x;
  const height = bounds.max.y - bounds.min.y;
  const center: Vec2 = {
    x: (bounds.min.x + bounds.max.x) / 2,
    y: (bounds.min.y + bounds.max.y) / 2,
  };

  if (width <= 0 && height <= 0) {
    return { ...v, panWorld: center };
  }

  const availW = Math.max(1, v.widthPx - 2 * marginPx);
  const availH = Math.max(1, v.heightPx - 2 * marginPx);
  const zoomW = width > 0 ? availW / width : Infinity;
  const zoomH = height > 0 ? availH / height : Infinity;
  const zoom = clampZoom(Math.min(zoomW, zoomH));

  return { panWorld: center, zoom, widthPx: v.widthPx, heightPx: v.heightPx };
}

/**
 * The viewport for a brand-new/empty document: zoom 2 px/unit, panned so a
 * 0-200mm mechanism starting near the origin sits comfortably lower-left of
 * screen centre.
 */
export function defaultViewport(widthPx: number, heightPx: number): Viewport {
  return { panWorld: { x: 100, y: 50 }, zoom: 2, widthPx, heightPx };
}

/**
 * Converts a `src/geom` angle (radians, CCW-positive, y-up) to Konva's
 * `rotation` prop (degrees, CW-positive, y-down). The ONLY angle negation
 * in the codebase outside this function's own callers -- never negate an
 * angle in `src/geom`/`src/model`/`src/kinematics` math.
 */
export function angleToKonvaRotationDeg(angleRad: number): number {
  return -radToDeg(angleRad);
}
