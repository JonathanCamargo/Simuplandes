/**
 * The Bar tool: click-click drawing with CAD polyline chaining (a click on
 * a different point continues from the last endpoint) and typed
 * length/angle commit (EDT-07). A bar end landing on an existing site is
 * carried as `startSiteId`/`endSiteId` on the `commitBar` effect --
 * `effects.ts` turns that into an auto-pin R joint in the SAME
 * `store.execute()` call as the bar itself (one undo step).
 *
 * The chain's next start-site id is not known until `effects.ts` mints it,
 * so this machine never mints ids itself: after a commit it enters a
 * "pending" chaining state, and the `committed` event (fed back by the
 * controller once the commit lands) supplies the real site id.
 */

import { direction, distance, type Vec2 } from "../geom";
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

const ZERO_LENGTH_EPSILON = 1e-9;

export type BarToolState =
  | { phase: "idle" }
  | {
      phase: "drawing";
      start: Vec2;
      startSiteId?: Id;
      cursor: Vec2;
      cursorSnap: SnapResult;
      input: DynamicInputState;
      /** `true` right after a chained commit: `startSiteId` is not yet
       * known and arrives via the next `"committed"` event. */
      chainPendingEndSiteId: boolean;
      /** `true` only right after a click that landed exactly on `start`
       * (the failed-zero-length-commit case) -- NOT true merely because
       * the cursor hasn't moved yet after starting the bar. Drives the
       * `zeroLength` vs. `drawing` hint distinction. */
      zeroLengthAttempt: boolean;
    };

function beginDrawing(at: Vec2, siteId: Id | undefined, snap: SnapResult): BarToolState {
  return {
    phase: "drawing",
    start: at,
    startSiteId: siteId,
    cursor: at,
    cursorSnap: snap,
    input: initialDynamicInput(),
    chainPendingEndSiteId: false,
    zeroLengthAttempt: false,
  };
}

function reduce(
  state: BarToolState,
  event: ToolEvent,
  ctx: ToolContext,
): ToolReduceResult<BarToolState> {
  void ctx; // reduce doesn't need document/selection context; hint() does.
  if (event.type === "cancel") {
    return { state: { phase: "idle" }, effects: [], handled: state.phase === "drawing" };
  }

  if (state.phase === "idle") {
    if (event.type === "pointerdown" && event.button !== 2) {
      return {
        state: beginDrawing(event.snap.point, event.snap.siteId, event.snap),
        effects: [],
        handled: true,
      };
    }
    return { state, effects: [], handled: false };
  }

  // state.phase === "drawing"
  if (event.type === "pointerdown") {
    if (event.button === 2) {
      return { state: { phase: "idle" }, effects: [], handled: true };
    }
    const end = event.snap.point;
    if (distance(state.start, end) < ZERO_LENGTH_EPSILON) {
      return {
        state: { ...state, cursor: end, cursorSnap: event.snap, zeroLengthAttempt: true },
        effects: [],
        handled: true,
      };
    }
    return {
      state: {
        phase: "drawing",
        start: end,
        startSiteId: undefined,
        cursor: end,
        cursorSnap: event.snap,
        input: initialDynamicInput(),
        chainPendingEndSiteId: true,
        zeroLengthAttempt: false,
      },
      effects: [
        {
          kind: "commitBar",
          start: state.start,
          angle: direction({ x: end.x - state.start.x, y: end.y - state.start.y }),
          length: distance(state.start, end),
          startSiteId: state.startSiteId,
          endSiteId: event.snap.siteId,
        },
      ],
      handled: true,
    };
  }

  if (event.type === "pointermove") {
    return {
      state: { ...state, cursor: event.world, cursorSnap: event.snap, zeroLengthAttempt: false },
      effects: [],
      handled: true,
    };
  }

  if (event.type === "committed") {
    if (state.chainPendingEndSiteId) {
      const nextStartSiteId = event.siteIds[1];
      return {
        state: { ...state, startSiteId: nextStartSiteId, chainPendingEndSiteId: false },
        effects: [],
        handled: false,
      };
    }
    return { state, effects: [], handled: false };
  }

  if (event.type === "key") {
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
    // "commit"
    const resolved = resolveDynamicInput(state.input, state.start, state.cursor);
    if ("error" in resolved) {
      return { state, effects: [], handled: true };
    }
    return {
      state: {
        phase: "drawing",
        start: state.start,
        startSiteId: state.startSiteId,
        cursor: state.start,
        cursorSnap: { kind: "none", point: state.start },
        input: initialDynamicInput(),
        chainPendingEndSiteId: true,
        zeroLengthAttempt: false,
      },
      effects: [
        {
          kind: "commitBar",
          start: state.start,
          angle: resolved.angle,
          length: resolved.length,
          startSiteId: state.startSiteId,
          endSiteId: state.cursorSnap.siteId,
        },
      ],
      handled: true,
    };
  }

  return { state, effects: [], handled: false };
}

function isBusy(state: BarToolState): boolean {
  return state.phase === "drawing";
}

function hint(state: BarToolState, ctx: ToolContext): HintMessage {
  if (state.phase === "idle") return { key: "tools.bar.hint.idle" };
  if (state.cursorSnap.kind === "site" && state.cursorSnap.siteId) {
    const index = indexDocument(ctx.doc);
    const entry = index.sites.get(state.cursorSnap.siteId);
    const target = entry?.site.name || entry?.link.name || state.cursorSnap.siteId;
    return {
      key: "tools.bar.hint.drawingPin",
      values: { target },
    };
  }
  if (state.zeroLengthAttempt) {
    return { key: "tools.bar.hint.zeroLength" };
  }
  const length = distance(state.start, state.cursor);
  const angle = direction({ x: state.cursor.x - state.start.x, y: state.cursor.y - state.start.y });
  return {
    key: "tools.bar.hint.drawing",
    values: { length, angle: (angle * 180) / Math.PI },
  };
}

function preview(state: BarToolState): PreviewShape[] {
  if (state.phase === "idle") return [];
  return [{ kind: "segment", a: state.start, b: state.cursor, dashed: true }];
}

function snapAnchor(state: BarToolState): Vec2 | undefined {
  return state.phase === "drawing" ? state.start : undefined;
}

function dynamicInput(state: BarToolState): DynamicInputState | undefined {
  return state.phase === "drawing" ? state.input : undefined;
}

export const barTool: ToolMachine<BarToolState> = {
  id: "bar",
  initial: () => ({ phase: "idle" }),
  reduce,
  isBusy,
  hint,
  preview,
  snapAnchor,
  dynamicInput,
};
