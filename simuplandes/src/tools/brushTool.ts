/**
 * The Brush tool (Draw mode): freehand annotations. Press, drag and
 * release paints one stroke in the current brush color and width (see
 * `ToolContext.brush`), saved as one annotation and one undo step. Strokes
 * follow the pointer exactly (no snapping) and are fixed to the drawing.
 * Escape abandons the stroke being painted.
 */

import { distance, type Vec2 } from "../geom";
import type { AnnotationColor, Vec2Tuple } from "../model";
import type { DynamicInputState } from "./dynamicInput";
import type {
  BrushSettings,
  HintMessage,
  PreviewShape,
  ToolContext,
  ToolEvent,
  ToolMachine,
  ToolReduceResult,
} from "./types";

export const DEFAULT_BRUSH: BrushSettings = { color: "ink", widthPx: 3 };

export type BrushToolState =
  | { phase: "idle" }
  | { phase: "painting"; points: Vec2[]; color: AnnotationColor; width: number; pixel: number };

/** One screen pixel in world units: `radiusWorld` is 8 px. */
function pixelOf(ctx: ToolContext): number {
  return ctx.radiusWorld / 8;
}

function perpendicularDistance(p: Vec2, a: Vec2, b: Vec2): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length = Math.hypot(dx, dy);
  if (length === 0) return distance(p, a);
  return Math.abs(dx * (a.y - p.y) - dy * (a.x - p.x)) / length;
}

/** Ramer-Douglas-Peucker: drops points closer than `tolerance` to the simplified line. */
export function simplifyStroke(points: readonly Vec2[], tolerance: number): Vec2[] {
  if (points.length <= 2) return [...points];
  const keep = new Array<boolean>(points.length).fill(false);
  keep[0] = true;
  keep[points.length - 1] = true;
  const stack: [number, number][] = [[0, points.length - 1]];
  while (stack.length > 0) {
    const [first, last] = stack.pop()!;
    let index = -1;
    let farthest = tolerance;
    for (let i = first + 1; i < last; i++) {
      const d = perpendicularDistance(points[i], points[first], points[last]);
      if (d > farthest) {
        farthest = d;
        index = i;
      }
    }
    if (index !== -1) {
      keep[index] = true;
      stack.push([first, index], [index, last]);
    }
  }
  return points.filter((_, i) => keep[i]);
}

function toTuples(points: readonly Vec2[]): Vec2Tuple[] {
  return points.map((p) => [p.x, p.y]);
}

function reduce(
  state: BrushToolState,
  event: ToolEvent,
  ctx: ToolContext,
): ToolReduceResult<BrushToolState> {
  const painting = state.phase === "painting";

  if (event.type === "cancel" || (event.type === "key" && event.key === "Escape")) {
    return { state: { phase: "idle" }, effects: [], handled: painting };
  }

  if (event.type === "pointerdown" && event.button === 0) {
    const brush = ctx.brush ?? DEFAULT_BRUSH;
    const pixel = pixelOf(ctx);
    return {
      state: {
        phase: "painting",
        points: [event.world],
        color: brush.color,
        width: brush.widthPx * pixel,
        pixel,
      },
      effects: [],
      handled: true,
    };
  }

  if (event.type === "pointermove" && painting) {
    const last = state.points[state.points.length - 1];
    // Sample about every 1.5 px; the stroke is simplified on release anyway.
    if (distance(last, event.world) < state.pixel * 1.5)
      return { state, effects: [], handled: true };
    return {
      state: { ...state, points: [...state.points, event.world] },
      effects: [],
      handled: true,
    };
  }

  if (event.type === "pointerup" && painting) {
    const last = state.points[state.points.length - 1];
    const points = distance(last, event.world) > 0 ? [...state.points, event.world] : state.points;
    return {
      state: { phase: "idle" },
      effects: [
        {
          kind: "addAnnotation",
          points: toTuples(simplifyStroke(points, state.pixel / 2)),
          color: state.color,
          width: state.width,
        },
      ],
      handled: true,
    };
  }

  return { state, effects: [], handled: false };
}

function preview(state: BrushToolState): PreviewShape[] {
  if (state.phase !== "painting") return [];
  return [{ kind: "stroke", points: state.points, color: state.color, width: state.width }];
}

function hint(state: BrushToolState): HintMessage {
  return {
    key: state.phase === "painting" ? "tools.brush.hint.painting" : "tools.brush.hint.idle",
  };
}

export const brushTool: ToolMachine<BrushToolState> = {
  id: "brush",
  initial: () => ({ phase: "idle" }),
  reduce,
  isBusy: (state) => state.phase === "painting",
  hint,
  preview,
  snapAnchor: () => undefined,
  dynamicInput: (): DynamicInputState | undefined => undefined,
};
