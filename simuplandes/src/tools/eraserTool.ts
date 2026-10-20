/**
 * The Eraser tool (Draw mode): removes annotation strokes. A click removes
 * the strokes under the pointer; a drag removes every stroke it crosses,
 * as ONE undo step (every removal in a drag shares the gesture's
 * `gestureSeed`). It only ever touches annotations, never the mechanism.
 */

import { dot, sub, type Vec2 } from "../geom";
import type { Annotation, Id, MechanismDocument } from "../model";
import type { DynamicInputState } from "./dynamicInput";
import type {
  HintMessage,
  PreviewShape,
  ToolContext,
  ToolEvent,
  ToolMachine,
  ToolReduceResult,
} from "./types";

export type EraserToolState =
  { phase: "idle" } | { phase: "erasing"; last: Vec2; gestureId: string };

function pointToSegment(p: Vec2, a: Vec2, b: Vec2): number {
  const ab = sub(b, a);
  const lengthSq = dot(ab, ab);
  const t = lengthSq === 0 ? 0 : Math.max(0, Math.min(1, dot(sub(p, a), ab) / lengthSq));
  return Math.hypot(p.x - (a.x + ab.x * t), p.y - (a.y + ab.y * t));
}

function cross(o: Vec2, a: Vec2, b: Vec2): number {
  return (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
}

/** The distance between segments p0-p1 and q0-q1 (0 when they cross). */
function segmentToSegment(p0: Vec2, p1: Vec2, q0: Vec2, q1: Vec2): number {
  const d1 = cross(q0, q1, p0);
  const d2 = cross(q0, q1, p1);
  const d3 = cross(p0, p1, q0);
  const d4 = cross(p0, p1, q1);
  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) {
    return 0;
  }
  return Math.min(
    pointToSegment(p0, q0, q1),
    pointToSegment(p1, q0, q1),
    pointToSegment(q0, p0, p1),
    pointToSegment(q1, p0, p1),
  );
}

/** Whether the eraser's sweep from `from` to `to` (radius `radius`) touches `annotation`. */
function touches(annotation: Annotation, from: Vec2, to: Vec2, radius: number): boolean {
  const reach = radius + annotation.width / 2;
  const points = annotation.points.map(([x, y]) => ({ x, y }));
  if (points.length === 1) return pointToSegment(points[0], from, to) <= reach;
  for (let i = 1; i < points.length; i++) {
    if (segmentToSegment(from, to, points[i - 1], points[i]) <= reach) return true;
  }
  return false;
}

/** The annotations the sweep `from` -> `to` touches. */
export function annotationsUnder(
  doc: MechanismDocument,
  from: Vec2,
  to: Vec2,
  radius: number,
): Id[] {
  return doc.annotations.filter((a) => touches(a, from, to, radius)).map((a) => a.id);
}

function erase(
  ctx: ToolContext,
  from: Vec2,
  to: Vec2,
  gestureId: string,
): ToolReduceResult<EraserToolState> {
  const ids = annotationsUnder(ctx.doc, from, to, ctx.radiusWorld);
  return {
    state: { phase: "erasing", last: to, gestureId },
    effects: ids.length > 0 ? [{ kind: "deleteAnnotations", ids, gestureId }] : [],
    handled: true,
  };
}

function reduce(
  state: EraserToolState,
  event: ToolEvent,
  ctx: ToolContext,
): ToolReduceResult<EraserToolState> {
  const erasing = state.phase === "erasing";
  switch (event.type) {
    case "cancel":
      return { state: { phase: "idle" }, effects: [], handled: erasing };
    case "key":
      return event.key === "Escape" && erasing
        ? { state: { phase: "idle" }, effects: [], handled: true }
        : { state, effects: [], handled: false };
    case "pointerdown":
      if (event.button !== 0) return { state, effects: [], handled: false };
      return erase(ctx, event.world, event.world, ctx.gestureSeed);
    case "pointermove":
      return erasing
        ? erase(ctx, state.last, event.world, state.gestureId)
        : { state, effects: [], handled: false };
    case "pointerup":
      return { state: { phase: "idle" }, effects: [], handled: erasing };
    default:
      return { state, effects: [], handled: false };
  }
}

function hint(state: EraserToolState, ctx: ToolContext): HintMessage {
  if (ctx.doc.annotations.length === 0) return { key: "tools.eraser.hint.empty" };
  return {
    key: state.phase === "erasing" ? "tools.eraser.hint.erasing" : "tools.eraser.hint.idle",
  };
}

export const eraserTool: ToolMachine<EraserToolState> = {
  id: "eraser",
  initial: () => ({ phase: "idle" }),
  reduce,
  isBusy: (state) => state.phase === "erasing",
  hint,
  preview: (): PreviewShape[] => [],
  snapAnchor: () => undefined,
  dynamicInput: (): DynamicInputState | undefined => undefined,
};
