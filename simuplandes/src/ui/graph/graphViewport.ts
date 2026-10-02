/**
 * Pure screen-px geometry for the graph panel's SVG (06-09 gap closure).
 *
 * The core idea: 1 SVG unit == 1 CSS px. `GraphPanel` measures its SVG box
 * (ResizeObserver, guarded) and `GraphSvg` sets `viewBox="0 0 {w} {h}"` equal
 * to that measured size, so every drawing size below (`GRAPH_PX`) is a real
 * on-screen pixel count that never shrinks just because the flex layout
 * compresses the box -- unlike the old fixed `VIEWBOX = 1000` scheme, where
 * a small measured box meant a small on-screen scale for every viewBox-unit
 * size (06-08's regression, see 06-VERIFICATION.md).
 *
 * `computeGraphViewport` is also the SINGLE SOURCE OF TRUTH for the minimum
 * separation `layoutGraph` enforces: `minSeparation` is derived from the same
 * `GRAPH_PX.footprintRadius` the renderer actually draws with, so the
 * guaranteed layout separation and the drawn shape sizes can never drift
 * apart (mirrors `layouts.ts`'s own `MIN_NODE_SEPARATION` derivation, one
 * level up: unit-box separation for a MEASURED viewport, not a fixed one).
 */

import { MIN_NODE_SEPARATION, type NodePosition } from "../../graph";

/** Used whenever the measured SVG box size is 0/NaN/negative (jsdom, first render before layout). */
export const GRAPH_FALLBACK_SIZE_PX = 360;

/** Upper bound on the derived `minSeparation` (unit-box units) so a tiny measured box never forces degenerate layouts. */
export const GRAPH_MAX_SEPARATION = 0.3;

const NODE_RADIUS_PX = 13;
const GROUND_HALF_SIDE_PX = 11;
const ISSUE_RING_PAD_PX = 4;
const RING_STROKE_PX = 2;
/** Radius of a circle enclosing ANY node's drawn footprint (circle or ground square), plus its outermost ring and that ring's stroke. */
const FOOTPRINT_RADIUS_PX =
  Math.max(NODE_RADIUS_PX, GROUND_HALF_SIDE_PX * Math.SQRT2) +
  ISSUE_RING_PAD_PX +
  RING_STROKE_PX / 2;

/**
 * Fixed screen-px drawing constants. Every size `GraphSvg` draws with lives
 * here so it can never silently drift from what `computeGraphViewport`
 * assumes when deriving `minSeparation`. Tuning knobs (see 06-09-PLAN.md):
 * `nodeGap` and `maxOutsideLabelWidth` may be adjusted if E2E/visual review
 * needs more breathing room; `nodeRadius` must never drop below 11 and
 * `groundHalfSide` never below 10 (legibility floor).
 */
export const GRAPH_PX = {
  nodeRadius: NODE_RADIUS_PX,
  groundHalfSide: GROUND_HALF_SIDE_PX,
  issueRingPad: ISSUE_RING_PAD_PX,
  hoverRingPad: 3,
  selectedRingPad: 2,
  ringStroke: RING_STROKE_PX,
  shapeStroke: 1.5,
  edgeStroke: 1.5,
  edgeStrokeActive: 3,
  edgeHitWidth: 10,
  parallelSpacing: 6,
  hatchOffset: 8,
  hatchHalf: 5,
  prismaticDash: "6 4",
  issueDash: "4 3",
  nodeGap: 10,
  labelGap: 3,
  labelHalo: 3,
  labelPadding: 2,
  maxOutsideLabelWidth: 96,
  footprintRadius: FOOTPRINT_RADIUS_PX,
} as const;

export interface GraphViewport {
  width: number;
  height: number;
  drawSize: number;
  offsetX: number;
  offsetY: number;
  minSeparation: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Derives a screen-px viewport from a measured SVG box size. If either
 * dimension is not finite or <= 0 (jsdom, or a box that hasn't laid out
 * yet), BOTH dimensions fall back to `GRAPH_FALLBACK_SIZE_PX` -- a partial
 * fallback (only one dimension) would produce a nonsensical aspect ratio.
 */
export function computeGraphViewport(measuredWidth: number, measuredHeight: number): GraphViewport {
  const bothValid =
    Number.isFinite(measuredWidth) &&
    measuredWidth > 0 &&
    Number.isFinite(measuredHeight) &&
    measuredHeight > 0;
  const width = Math.round(bothValid ? measuredWidth : GRAPH_FALLBACK_SIZE_PX);
  const height = Math.round(bothValid ? measuredHeight : GRAPH_FALLBACK_SIZE_PX);
  const drawSize = Math.min(width, height);
  const offsetX = (width - drawSize) / 2;
  const offsetY = (height - drawSize) / 2;
  const minSeparation = clamp(
    (2 * GRAPH_PX.footprintRadius + GRAPH_PX.nodeGap) / drawSize,
    MIN_NODE_SEPARATION,
    GRAPH_MAX_SEPARATION,
  );
  return { width, height, drawSize, offsetX, offsetY, minSeparation };
}

/** Maps a unit-box position (`layoutGraph`'s output, `[0,1]^2`) to real screen px inside `vp`. */
export function toScreen(pos: NodePosition, vp: GraphViewport): { x: number; y: number } {
  return { x: vp.offsetX + pos.x * vp.drawSize, y: vp.offsetY + pos.y * vp.drawSize };
}
