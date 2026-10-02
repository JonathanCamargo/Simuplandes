/**
 * `placeLabels`: pure, deterministic label placement for the graph panel's
 * nodes (06-09 gap closure). A readable label (>= 11-12 screen px) of a name
 * like "coupler" is physically wider than a ~26px node, so "labels fit
 * inside node shapes" (06-08's rule) is replaced here by "labels are
 * readable and never overlap a node shape or another label": short labels
 * ("L5") are drawn inside their own node when they fit there at a readable
 * size; everything else is drawn beside/below/above the node at the first
 * collision-free candidate position, with a background halo (drawn by the
 * caller, `GraphSvg.tsx`).
 *
 * No DOM measurement (jsdom has no `getBBox`): text width is the same
 * `chars * fontSize * GLYPH_WIDTH_EM` estimate `labelFit.ts` already uses.
 * Never throws: pathological crowding falls back to the first in-viewport
 * candidate (or a viewport-clamped "below" position), flagged `collides: true`
 * rather than omitting a label.
 */

import { fitLabel, GLYPH_WIDTH_EM, LABEL_MAX_FONT } from "./labelFit";
import { GRAPH_PX, type GraphViewport } from "./graphViewport";

export type LabelPlacementKind =
  | "inside"
  | "below"
  | "above"
  | "right"
  | "left"
  | "below-right"
  | "below-left"
  | "above-right"
  | "above-left";

export interface LabelNodeInput {
  id: string;
  cx: number;
  cy: number;
  shape: "circle" | "square";
  label: string;
}

export interface LabelBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PlacedLabel {
  id: string;
  text: string;
  truncated: boolean;
  fontSize: number;
  x: number;
  y: number;
  textAnchor: "start" | "middle" | "end";
  placement: LabelPlacementKind;
  box: LabelBox;
  collides: boolean;
}

type OutsideDirection = Exclude<LabelPlacementKind, "inside">;

const DIRECTION_VECTORS: Record<OutsideDirection, { dx: number; dy: number }> = {
  below: { dx: 0, dy: 1 },
  above: { dx: 0, dy: -1 },
  right: { dx: 1, dy: 0 },
  left: { dx: -1, dy: 0 },
  "below-right": { dx: Math.SQRT1_2, dy: Math.SQRT1_2 },
  "below-left": { dx: -Math.SQRT1_2, dy: Math.SQRT1_2 },
  "above-right": { dx: Math.SQRT1_2, dy: -Math.SQRT1_2 },
  "above-left": { dx: -Math.SQRT1_2, dy: -Math.SQRT1_2 },
};

/** Candidate scan order once the preferred (centroid-away) direction is placed first. */
const DEFAULT_ORDER: OutsideDirection[] = [
  "below",
  "above",
  "right",
  "left",
  "below-right",
  "below-left",
  "above-right",
  "above-left",
];

const EPS = 1e-6;

function estimateWidth(text: string, fontSize: number): number {
  return [...text].length * fontSize * GLYPH_WIDTH_EM;
}

function estimateHeight(fontSize: number): number {
  return fontSize * 1.25;
}

function boxesIntersect(a: LabelBox, b: LabelBox): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

function withinViewport(box: LabelBox, viewport: { width: number; height: number }): boolean {
  return (
    box.x >= -EPS &&
    box.y >= -EPS &&
    box.x + box.width <= viewport.width + EPS &&
    box.y + box.height <= viewport.height + EPS
  );
}

/** Half-extent (screen px) of `node`'s drawn shape, grown by its outermost issue ring and that ring's stroke -- the same footprint `GraphSvg` draws rings around. */
function obstacleHalfExtent(node: LabelNodeInput): number {
  const base = node.shape === "circle" ? GRAPH_PX.nodeRadius : GRAPH_PX.groundHalfSide;
  return base + GRAPH_PX.issueRingPad + GRAPH_PX.ringStroke / 2;
}

function obstacleBox(node: LabelNodeInput): LabelBox {
  const half = obstacleHalfExtent(node);
  return { x: node.cx - half, y: node.cy - half, width: half * 2, height: half * 2 };
}

/** The node's own inner label width: the largest text box that visually sits inside its shape. */
function innerWidth(node: LabelNodeInput): number {
  return node.shape === "circle"
    ? 2 * GRAPH_PX.nodeRadius * 0.85
    : 2 * GRAPH_PX.groundHalfSide - 2 * GRAPH_PX.labelPadding;
}

function centroidOf(nodes: readonly LabelNodeInput[]): { x: number; y: number } {
  if (nodes.length === 0) return { x: 0, y: 0 };
  let sx = 0;
  let sy = 0;
  for (const node of nodes) {
    sx += node.cx;
    sy += node.cy;
  }
  return { x: sx / nodes.length, y: sy / nodes.length };
}

/** The of the 8 fixed directions whose unit vector is closest (max dot product) to `(vx, vy)`; `null` when the vector is ~zero (node sits at the centroid). */
function nearestDirection(vx: number, vy: number): OutsideDirection | null {
  const len = Math.hypot(vx, vy);
  if (len < EPS) return null;
  const ux = vx / len;
  const uy = vy / len;
  let best: OutsideDirection = DEFAULT_ORDER[0];
  let bestDot = -Infinity;
  for (const dir of DEFAULT_ORDER) {
    const v = DIRECTION_VECTORS[dir];
    const dot = v.dx * ux + v.dy * uy;
    if (dot > bestDot) {
      bestDot = dot;
      best = dir;
    }
  }
  return best;
}

function candidateOrder(
  node: LabelNodeInput,
  centroid: { x: number; y: number },
): OutsideDirection[] {
  const preferred = nearestDirection(node.cx - centroid.x, node.cy - centroid.y);
  const order: OutsideDirection[] = [];
  if (preferred) order.push(preferred);
  for (const dir of DEFAULT_ORDER) {
    if (!order.includes(dir)) order.push(dir);
  }
  return order;
}

interface DirectionBox {
  box: LabelBox;
  x: number;
  y: number;
  textAnchor: "start" | "middle" | "end";
}

/**
 * Places a `width` x `height` label box `distance` px from `center` along
 * `dir`. `below`/`above` (dx === 0) center horizontally; `right`/`left`
 * (dy === 0) anchor start/end and center vertically; diagonals anchor
 * start/end (by their dx sign) and abut vertically (by their dy sign).
 */
function boxForDirection(
  center: { x: number; y: number },
  dir: OutsideDirection,
  distance: number,
  width: number,
  height: number,
): DirectionBox {
  const { dx, dy } = DIRECTION_VECTORS[dir];
  const anchorX = center.x + dx * distance;
  const anchorY = center.y + dy * distance;

  let textAnchor: "start" | "middle" | "end";
  let boxX: number;
  if (dx > 0.1) {
    textAnchor = "start";
    boxX = anchorX;
  } else if (dx < -0.1) {
    textAnchor = "end";
    boxX = anchorX - width;
  } else {
    textAnchor = "middle";
    boxX = anchorX - width / 2;
  }

  let boxY: number;
  if (dy > 0.1) {
    boxY = anchorY;
  } else if (dy < -0.1) {
    boxY = anchorY - height;
  } else {
    boxY = anchorY - height / 2;
  }

  const svgX =
    textAnchor === "start" ? boxX : textAnchor === "end" ? boxX + width : boxX + width / 2;
  const svgY = boxY + height / 2; // caller renders with dominantBaseline="central"
  return { box: { x: boxX, y: boxY, width, height }, x: svgX, y: svgY, textAnchor };
}

function clampNum(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function tryInside(node: LabelNodeInput): PlacedLabel | null {
  const fitted = fitLabel(node.label, innerWidth(node));
  if (fitted.truncated) return null;
  const width = estimateWidth(fitted.text, fitted.fontSize);
  const height = estimateHeight(fitted.fontSize);
  const box: LabelBox = { x: node.cx - width / 2, y: node.cy - height / 2, width, height };
  return {
    id: node.id,
    text: fitted.text,
    truncated: false,
    fontSize: fitted.fontSize,
    x: node.cx,
    y: node.cy,
    textAnchor: "middle",
    placement: "inside",
    box,
    collides: false,
  };
}

function placeOutside(
  node: LabelNodeInput,
  obstacles: ReadonlyMap<string, LabelBox>,
  centroid: { x: number; y: number },
  placedBoxes: readonly LabelBox[],
  viewport: { width: number; height: number },
): PlacedLabel {
  const fitted = fitLabel(node.label, GRAPH_PX.maxOutsideLabelWidth);
  const distance = obstacleHalfExtent(node) + GRAPH_PX.labelGap;
  const order = candidateOrder(node, centroid);
  const ownObstacle = obstacles.get(node.id);

  function isFree(box: LabelBox): boolean {
    if (!withinViewport(box, viewport)) return false;
    for (const [id, obstacle] of obstacles) {
      if (id === node.id) continue;
      if (boxesIntersect(box, obstacle)) return false;
    }
    if (ownObstacle && boxesIntersect(box, ownObstacle)) return false;
    for (const placed of placedBoxes) {
      if (boxesIntersect(box, placed)) return false;
    }
    return true;
  }

  // Full text, every candidate direction.
  {
    const width = estimateWidth(fitted.text, fitted.fontSize);
    const height = estimateHeight(fitted.fontSize);
    for (const dir of order) {
      const placed = boxForDirection({ x: node.cx, y: node.cy }, dir, distance, width, height);
      if (isFree(placed.box)) {
        return {
          id: node.id,
          text: fitted.text,
          truncated: fitted.truncated,
          fontSize: fitted.fontSize,
          x: placed.x,
          y: placed.y,
          textAnchor: placed.textAnchor,
          placement: dir,
          box: placed.box,
          collides: false,
        };
      }
    }
  }

  // Progressively shorter ellipsized text, down to 1 char + "…".
  let base = fitted.text.endsWith("…") ? fitted.text.slice(0, -1) : fitted.text;
  while (base.length > 1) {
    base = base.slice(0, -1);
    const candidateText = `${base}…`;
    const width = estimateWidth(candidateText, fitted.fontSize);
    const height = estimateHeight(fitted.fontSize);
    for (const dir of order) {
      const placed = boxForDirection({ x: node.cx, y: node.cy }, dir, distance, width, height);
      if (isFree(placed.box)) {
        return {
          id: node.id,
          text: candidateText,
          truncated: true,
          fontSize: fitted.fontSize,
          x: placed.x,
          y: placed.y,
          textAnchor: placed.textAnchor,
          placement: dir,
          box: placed.box,
          collides: false,
        };
      }
    }
  }

  // Nothing collision-free: first in-viewport candidate (collides: true).
  {
    const width = estimateWidth(fitted.text, fitted.fontSize);
    const height = estimateHeight(fitted.fontSize);
    for (const dir of order) {
      const placed = boxForDirection({ x: node.cx, y: node.cy }, dir, distance, width, height);
      if (withinViewport(placed.box, viewport)) {
        return {
          id: node.id,
          text: fitted.text,
          truncated: fitted.truncated,
          fontSize: fitted.fontSize,
          x: placed.x,
          y: placed.y,
          textAnchor: placed.textAnchor,
          placement: dir,
          box: placed.box,
          collides: true,
        };
      }
    }
  }

  // Last resort: "below", clamped into the viewport (collides: true).
  {
    const width = estimateWidth(fitted.text, fitted.fontSize);
    const height = estimateHeight(fitted.fontSize);
    const raw = boxForDirection({ x: node.cx, y: node.cy }, "below", distance, width, height);
    const clampedX = clampNum(raw.box.x, 0, Math.max(0, viewport.width - width));
    const clampedY = clampNum(raw.box.y, 0, Math.max(0, viewport.height - height));
    const box: LabelBox = { x: clampedX, y: clampedY, width, height };
    return {
      id: node.id,
      text: fitted.text,
      truncated: fitted.truncated,
      fontSize: fitted.fontSize,
      x: clampedX,
      y: clampedY + height / 2,
      textAnchor: "start",
      placement: "below",
      box,
      collides: true,
    };
  }
}

/**
 * Places one label per node. Pass 1 places labels that fit INSIDE their own
 * node (at a readable size); pass 2 places every remaining label OUTSIDE at
 * the first collision-free candidate (own/other obstacles, already-placed
 * labels), so short labels claim their own node before longer ones compete
 * for the space around it. Never throws.
 */
export function placeLabels(
  nodes: readonly LabelNodeInput[],
  viewport: { width: number; height: number } | GraphViewport,
): Map<string, PlacedLabel> {
  const result = new Map<string, PlacedLabel>();
  const centroid = centroidOf(nodes);
  const obstacles = new Map<string, LabelBox>(nodes.map((node) => [node.id, obstacleBox(node)]));
  const placedBoxes: LabelBox[] = [];

  const outsideNodes: LabelNodeInput[] = [];
  for (const node of nodes) {
    const inside = tryInside(node);
    if (inside) {
      result.set(node.id, inside);
      placedBoxes.push(inside.box);
    } else {
      outsideNodes.push(node);
    }
  }

  for (const node of outsideNodes) {
    const placed = placeOutside(node, obstacles, centroid, placedBoxes, viewport);
    result.set(node.id, placed);
    placedBoxes.push(placed.box);
  }

  return result;
}

// Re-exported so callers/tests importing only from this module can see the
// max font a label ever renders at without an extra import.
export { LABEL_MAX_FONT };
