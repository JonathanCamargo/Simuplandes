/**
 * The Select tool (EDT-03): click/shift-click/box selection, live drag-move
 * of the selection, live joint-geometry drag (every R-jointed coincident
 * site moves together, via `jointClusterSiteIds`), Delete/Backspace
 * (cascading delete) and Ctrl+D (duplicate). A drag is ONE undo step
 * however many pointermove frames it spans: every `moveEntities` effect
 * emitted during the same gesture carries `ctx.gestureSeed` as its
 * `gestureId`, and `history.ts` merges consecutive records sharing a
 * `coalesceKey`.
 *
 * The snap exclusion for a joint drag (so a dragged cluster never snaps back
 * onto its own, pre-drag site) is exposed via the optional
 * `ToolMachine.snapExclude`, computed by THIS machine (not `effects.ts`/the
 * controller), since only this machine knows which sites are mid-drag.
 */

import { distance, sub, type Vec2 } from "../geom";
import { hitTest, entitiesInBox, type HitResult } from "../canvas/hitTest";
import { expandBounds } from "../canvas/bounds";
import { jointClusterSiteIds, type Id } from "../model";
import type { SelectionMode } from "../store/selection";
import type {
  HintMessage,
  PreviewShape,
  ToolContext,
  ToolEffect,
  ToolEvent,
  ToolMachine,
  ToolReduceResult,
} from "./types";
import type { DynamicInputState } from "./dynamicInput";

/** World-unit offset a keyboard (Ctrl+D) duplicate is placed at. */
const DUPLICATE_OFFSET: Vec2 = { x: 20, y: -20 };

export type SelectToolState =
  | { phase: "idle" }
  | {
      phase: "pressing";
      downWorld: Vec2;
      hit: HitResult;
      shift: boolean;
      gestureSeed: string;
      /** Precomputed at pointerdown when `hit.kind === "joint"`, so
       * `snapExclude` can see it without needing `ctx.doc`. */
      jointClusterIds?: ReadonlySet<Id>;
    }
  | { phase: "boxing"; start: Vec2; current: Vec2; shift: boolean }
  | { phase: "moving"; ids: Id[]; last: Vec2; gestureId: string }
  | { phase: "draggingJoint"; siteIds: Id[]; last: Vec2; gestureId: string };

type PointerToolEvent = Extract<ToolEvent, { type: "pointerdown" | "pointermove" | "pointerup" }>;
type KeyToolEvent = Extract<ToolEvent, { type: "key" }>;
type PressingState = Extract<SelectToolState, { phase: "pressing" }>;

/** The single entity id a click/box target resolves to, or `undefined` for "none". */
function hitEntityId(hit: HitResult): Id | undefined {
  switch (hit.kind) {
    case "link":
      return hit.linkId;
    case "site":
      return hit.siteId;
    case "joint":
      return hit.jointId;
    case "marker":
      return hit.markerId;
    default:
      return undefined;
  }
}

/** The id a link/site/marker hit drags as a whole-selection move (joints use `jointClusterSiteIds` instead). */
function moveTargetId(hit: HitResult): Id | undefined {
  if (hit.kind === "link") return hit.linkId;
  if (hit.kind === "site") return hit.siteId;
  if (hit.kind === "marker") return hit.markerId;
  return undefined;
}

function boundsOf(a: Vec2, b: Vec2): { min: Vec2; max: Vec2 } {
  return expandBounds(expandBounds(null, a), b);
}

function finishClick(state: PressingState, ctx: ToolContext): ToolReduceResult<SelectToolState> {
  const targetId = hitEntityId(state.hit);
  if (targetId === undefined) {
    void ctx;
    if (state.shift) {
      return { state: { phase: "idle" }, effects: [], handled: true };
    }
    return {
      state: { phase: "idle" },
      effects: [{ kind: "clearSelection" }],
      handled: true,
    };
  }
  const mode: SelectionMode = state.shift ? "toggle" : "replace";
  return {
    state: { phase: "idle" },
    effects: [{ kind: "select", ids: [targetId], mode }],
    handled: true,
  };
}

function startDrag(
  state: PressingState,
  event: PointerToolEvent,
  ctx: ToolContext,
): ToolReduceResult<SelectToolState> {
  if (state.hit.kind === "none") {
    return {
      state: { phase: "boxing", start: state.downWorld, current: event.world, shift: state.shift },
      effects: [],
      handled: true,
    };
  }

  if (state.hit.kind === "joint") {
    const cluster = state.jointClusterIds ?? jointClusterSiteIds(ctx.doc, state.hit.siteId);
    const siteIds = Array.from(cluster);
    const delta = sub(event.snap.point, state.downWorld);
    return {
      state: {
        phase: "draggingJoint",
        siteIds,
        last: event.snap.point,
        gestureId: state.gestureSeed,
      },
      effects: [
        {
          kind: "moveEntities",
          ids: siteIds,
          delta,
          gestureId: state.gestureSeed,
          label: "move-joint",
        },
      ],
      handled: true,
    };
  }

  const targetId = moveTargetId(state.hit);
  if (targetId === undefined) {
    return { state: { phase: "idle" }, effects: [], handled: true };
  }

  const alreadySelected = ctx.selection.has(targetId);
  const effects: ToolEffect[] = [];
  let ids: Id[];
  if (alreadySelected) {
    ids = Array.from(ctx.selection);
  } else if (state.shift) {
    ids = [...ctx.selection, targetId];
    effects.push({ kind: "select", ids: [targetId], mode: "add" });
  } else {
    ids = [targetId];
    effects.push({ kind: "select", ids: [targetId], mode: "replace" });
  }

  const delta = sub(event.world, state.downWorld);
  effects.push({
    kind: "moveEntities",
    ids,
    delta,
    gestureId: state.gestureSeed,
    label: "move-selection",
  });

  return {
    state: { phase: "moving", ids, last: event.world, gestureId: state.gestureSeed },
    effects,
    handled: true,
  };
}

function reduceKey(
  state: SelectToolState,
  event: KeyToolEvent,
  ctx: ToolContext,
): ToolReduceResult<SelectToolState> {
  if (event.key === "Escape") {
    if (state.phase !== "idle") {
      return { state: { phase: "idle" }, effects: [], handled: true };
    }
    if (ctx.selection.size > 0) {
      return { state, effects: [{ kind: "clearSelection" }], handled: true };
    }
    return { state, effects: [], handled: false };
  }

  if (state.phase !== "idle") {
    return { state, effects: [], handled: false };
  }

  if (event.key === "Delete" || event.key === "Backspace") {
    if (ctx.selection.size === 0) {
      return { state, effects: [], handled: false };
    }
    return { state, effects: [{ kind: "deleteSelection" }], handled: true };
  }

  if (event.mod && (event.key === "d" || event.key === "D")) {
    return {
      state,
      effects: [{ kind: "duplicateSelection", offset: DUPLICATE_OFFSET }],
      handled: true,
    };
  }

  if (event.mod && (event.key === "a" || event.key === "A")) {
    const ids = ctx.doc.links.filter((link) => !link.isGround).map((link) => link.id);
    return { state, effects: [{ kind: "select", ids, mode: "replace" }], handled: true };
  }

  return { state, effects: [], handled: false };
}

function reduce(
  state: SelectToolState,
  event: ToolEvent,
  ctx: ToolContext,
): ToolReduceResult<SelectToolState> {
  if (event.type === "cancel") {
    return { state: { phase: "idle" }, effects: [], handled: state.phase !== "idle" };
  }
  if (event.type === "committed") {
    return { state, effects: [], handled: false };
  }
  if (event.type === "key") {
    return reduceKey(state, event, ctx);
  }

  if (state.phase === "idle") {
    if (event.type !== "pointerdown" || event.button === 2) {
      return { state, effects: [], handled: false };
    }
    const hit = hitTest(ctx.doc, event.world, ctx.radiusWorld);
    const jointClusterIds =
      hit.kind === "joint" ? jointClusterSiteIds(ctx.doc, hit.siteId) : undefined;
    return {
      state: {
        phase: "pressing",
        downWorld: event.world,
        hit,
        shift: event.shift,
        gestureSeed: ctx.gestureSeed,
        ...(jointClusterIds ? { jointClusterIds } : {}),
      },
      effects: [],
      handled: true,
    };
  }

  if (state.phase === "pressing") {
    if (event.type === "pointerup") {
      return finishClick(state, ctx);
    }
    if (event.type === "pointermove") {
      const threshold = ctx.radiusWorld / 2;
      if (distance(state.downWorld, event.world) < threshold) {
        return { state, effects: [], handled: true };
      }
      return startDrag(state, event, ctx);
    }
    return { state, effects: [], handled: false };
  }

  if (state.phase === "boxing") {
    if (event.type === "pointermove") {
      return { state: { ...state, current: event.world }, effects: [], handled: true };
    }
    if (event.type === "pointerup") {
      const box = boundsOf(state.start, event.world);
      const ids = entitiesInBox(ctx.doc, box);
      return {
        state: { phase: "idle" },
        effects: [{ kind: "select", ids, mode: state.shift ? "add" : "replace" }],
        handled: true,
      };
    }
    return { state, effects: [], handled: false };
  }

  if (state.phase === "moving") {
    if (event.type === "pointermove") {
      const delta = sub(event.world, state.last);
      return {
        state: { ...state, last: event.world },
        effects: [
          {
            kind: "moveEntities",
            ids: state.ids,
            delta,
            gestureId: state.gestureId,
            label: "move-selection",
          },
        ],
        handled: true,
      };
    }
    if (event.type === "pointerup") {
      return { state: { phase: "idle" }, effects: [], handled: true };
    }
    return { state, effects: [], handled: false };
  }

  // state.phase === "draggingJoint"
  if (event.type === "pointermove") {
    const delta = sub(event.snap.point, state.last);
    return {
      state: { ...state, last: event.snap.point },
      effects: [
        {
          kind: "moveEntities",
          ids: state.siteIds,
          delta,
          gestureId: state.gestureId,
          label: "move-joint",
        },
      ],
      handled: true,
    };
  }
  if (event.type === "pointerup") {
    return { state: { phase: "idle" }, effects: [], handled: true };
  }
  return { state, effects: [], handled: false };
}

function isBusy(state: SelectToolState): boolean {
  return state.phase === "boxing" || state.phase === "moving" || state.phase === "draggingJoint";
}

function hint(state: SelectToolState): HintMessage {
  if (state.phase === "boxing") return { key: "tools.select.hint.boxing" };
  if (state.phase === "moving") return { key: "tools.select.hint.movingSelection" };
  if (state.phase === "draggingJoint") {
    return {
      key: "tools.select.hint.draggingJoint",
      values: { x: state.last.x, y: state.last.y },
    };
  }
  return { key: "tools.select.hint.idle" };
}

function preview(state: SelectToolState): PreviewShape[] {
  if (state.phase === "boxing") {
    const box = boundsOf(state.start, state.current);
    return [{ kind: "rect", min: box.min, max: box.max }];
  }
  return [];
}

function snapAnchor(): Vec2 | undefined {
  return undefined;
}

function snapExclude(state: SelectToolState): ReadonlySet<Id> | undefined {
  if (state.phase === "pressing" && state.jointClusterIds) return state.jointClusterIds;
  if (state.phase === "draggingJoint") return new Set(state.siteIds);
  return undefined;
}

function dynamicInput(): DynamicInputState | undefined {
  return undefined;
}

export const selectTool: ToolMachine<SelectToolState> = {
  id: "select",
  initial: () => ({ phase: "idle" }),
  reduce,
  isBusy,
  hint,
  preview,
  snapAnchor,
  snapExclude,
  dynamicInput,
};
