/**
 * The Plate tool: click vertices, close with Enter or a click on the first
 * vertex (>= 3 vertices required). A vertex landing on an existing site is
 * carried in `vertexSiteIds` -- `effects.ts` turns those into auto-pin R
 * joints in the SAME `store.execute()` call as the plate itself. Typed
 * length/angle (reusing `dynamicInput.ts`) places the next vertex relative
 * to the last one; plain `Backspace` (no typed text pending) removes the
 * last vertex instead of editing a field.
 */

import { add, distance, fromPolar, type Vec2 } from "../geom";
import {
  applyDynamicKey,
  initialDynamicInput,
  resolveDynamicInput,
  type DynamicInputState,
} from "./dynamicInput";
import type {
  HintMessage,
  PreviewShape,
  ToolContext,
  ToolEvent,
  ToolMachine,
  ToolReduceResult,
} from "./types";
import type { SnapResult } from "../canvas/snapping";
import { indexDocument, type Id } from "../model";

export type PlateToolState =
  | { phase: "idle" }
  | {
      phase: "drawing";
      vertices: Vec2[];
      vertexSiteIds: (Id | undefined)[];
      cursor: Vec2;
      cursorSnap: SnapResult;
      input: DynamicInputState;
    };

function beginDrawing(snap: SnapResult): PlateToolState {
  return {
    phase: "drawing",
    vertices: [snap.point],
    vertexSiteIds: [snap.siteId],
    cursor: snap.point,
    cursorSnap: snap,
    input: initialDynamicInput(),
  };
}

function pushVertex(
  state: Extract<PlateToolState, { phase: "drawing" }>,
  point: Vec2,
  siteId: Id | undefined,
): PlateToolState {
  return {
    phase: "drawing",
    vertices: [...state.vertices, point],
    vertexSiteIds: [...state.vertexSiteIds, siteId],
    cursor: point,
    cursorSnap: { kind: "none", point },
    input: initialDynamicInput(),
  };
}

function reduce(
  state: PlateToolState,
  event: ToolEvent,
  ctx: ToolContext,
): ToolReduceResult<PlateToolState> {
  if (event.type === "cancel") {
    return { state: { phase: "idle" }, effects: [], handled: state.phase === "drawing" };
  }

  if (state.phase === "idle") {
    if (event.type === "pointerdown" && event.button !== 2) {
      return { state: beginDrawing(event.snap), effects: [], handled: true };
    }
    return { state, effects: [], handled: false };
  }

  // state.phase === "drawing"
  if (event.type === "pointerdown") {
    if (event.button === 2) {
      return { state: { phase: "idle" }, effects: [], handled: true };
    }
    if (
      state.vertices.length >= 3 &&
      distance(event.snap.point, state.vertices[0]) <= ctx.radiusWorld
    ) {
      return {
        state: { phase: "idle" },
        effects: [
          { kind: "commitPlate", vertices: state.vertices, vertexSiteIds: state.vertexSiteIds },
        ],
        handled: true,
      };
    }
    return {
      state: pushVertex(state, event.snap.point, event.snap.siteId),
      effects: [],
      handled: true,
    };
  }

  if (event.type === "pointermove") {
    return {
      state: { ...state, cursor: event.world, cursorSnap: event.snap },
      effects: [],
      handled: true,
    };
  }

  if (event.type === "key") {
    if (event.key === "Backspace" && state.input.length === "" && state.input.angle === "") {
      const vertices = state.vertices.slice(0, -1);
      const vertexSiteIds = state.vertexSiteIds.slice(0, -1);
      if (vertices.length === 0) {
        return { state: { phase: "idle" }, effects: [], handled: true };
      }
      return {
        state: {
          phase: "drawing",
          vertices,
          vertexSiteIds,
          cursor: vertices[vertices.length - 1],
          cursorSnap: { kind: "none", point: vertices[vertices.length - 1] },
          input: initialDynamicInput(),
        },
        effects: [],
        handled: true,
      };
    }

    const result = applyDynamicKey(state.input, event.key);
    if (result.action === "cancel") {
      return { state: { phase: "idle" }, effects: [], handled: true };
    }
    if (result.action === "unhandled") {
      return { state, effects: [], handled: false };
    }
    if (result.action === "edit") {
      return { state: { ...state, input: result.state }, effects: [], handled: true };
    }

    // "commit" (Enter)
    const hasTyped = state.input.length !== "" || state.input.angle !== "";
    if (!hasTyped) {
      if (state.vertices.length < 3) {
        return { state, effects: [], handled: true };
      }
      return {
        state: { phase: "idle" },
        effects: [
          { kind: "commitPlate", vertices: state.vertices, vertexSiteIds: state.vertexSiteIds },
        ],
        handled: true,
      };
    }
    const last = state.vertices[state.vertices.length - 1];
    const resolved = resolveDynamicInput(state.input, last, state.cursor);
    if ("error" in resolved) {
      return { state, effects: [], handled: true };
    }
    const nextPoint = add(last, fromPolar(resolved.length, resolved.angle));
    return {
      state: pushVertex(state, nextPoint, state.cursorSnap.siteId),
      effects: [],
      handled: true,
    };
  }

  return { state, effects: [], handled: false };
}

function isBusy(state: PlateToolState): boolean {
  return state.phase === "drawing";
}

function hint(state: PlateToolState, ctx: ToolContext): HintMessage {
  if (state.phase === "idle") return { key: "tools.plate.hint.idle" };
  if (state.cursorSnap.kind === "site" && state.cursorSnap.siteId) {
    const index = indexDocument(ctx.doc);
    const entry = index.sites.get(state.cursorSnap.siteId);
    const target = entry?.site.name || entry?.link.name || state.cursorSnap.siteId;
    return { key: "tools.plate.hint.drawingPin", values: { target } };
  }
  if (state.vertices.length < 3) {
    return { key: "tools.plate.hint.needThree" };
  }
  return { key: "tools.plate.hint.drawing", values: { count: state.vertices.length } };
}

function preview(state: PlateToolState): PreviewShape[] {
  if (state.phase === "idle") return [];
  return [{ kind: "polyline", points: [...state.vertices, state.cursor], closed: false }];
}

function snapAnchor(state: PlateToolState): Vec2 | undefined {
  return state.phase === "drawing" ? state.vertices[state.vertices.length - 1] : undefined;
}

function dynamicInput(state: PlateToolState): DynamicInputState | undefined {
  return state.phase === "drawing" ? state.input : undefined;
}

export const plateTool: ToolMachine<PlateToolState> = {
  id: "plate",
  initial: () => ({ phase: "idle" }),
  reduce,
  isBusy,
  hint,
  preview,
  snapAnchor,
  dynamicInput,
};
