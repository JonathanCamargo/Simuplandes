/**
 * The Pin tool: click a site, then click a site on a DIFFERENT link to
 * create a revolute (R) joint between them. Like the Ground pivot tool,
 * picking the second site uses `sitesNear` (not `computeSnap`'s single
 * candidate) so a click near several coincident sites can still find one on
 * a different link than the first pick.
 */

import { sitesNear } from "../canvas/hitTest";
import { indexDocument, type Id } from "../model";
import type {
  HintMessage,
  PreviewShape,
  ToolContext,
  ToolEvent,
  ToolMachine,
  ToolReduceResult,
} from "./types";
import type { Vec2 } from "../geom";
import type { DynamicInputState } from "./dynamicInput";

export type PinToolState =
  | { phase: "idle"; lastMessage?: "needSite" }
  | {
      phase: "pickedA";
      siteA: Id;
      linkA: Id;
      at: Vec2;
      lastMessage?: "differentLink" | "alreadyPinned";
    };

function alreadyJoined(doc: ToolContext["doc"], siteA: Id, siteB: Id): boolean {
  const index = indexDocument(doc);
  const joints = index.jointsBySite.get(siteA) ?? [];
  return joints.some((joint) => joint.siteA === siteB || joint.siteB === siteB);
}

function reduce(
  state: PinToolState,
  event: ToolEvent,
  ctx: ToolContext,
): ToolReduceResult<PinToolState> {
  if (event.type === "cancel") {
    return { state: { phase: "idle" }, effects: [], handled: state.phase === "pickedA" };
  }

  if (event.type === "pointermove") {
    if (state.phase === "idle") {
      return state.lastMessage === undefined
        ? { state, effects: [], handled: false }
        : { state: { phase: "idle" }, effects: [], handled: false };
    }
    return state.lastMessage === undefined
      ? { state, effects: [], handled: false }
      : { state: { ...state, lastMessage: undefined }, effects: [], handled: false };
  }

  if (event.type !== "pointerdown") {
    return { state, effects: [], handled: false };
  }

  if (event.button === 2) {
    return { state: { phase: "idle" }, effects: [], handled: state.phase === "pickedA" };
  }

  if (state.phase === "idle") {
    if (event.snap.kind === "site" && event.snap.siteId && event.snap.linkId) {
      return {
        state: {
          phase: "pickedA",
          siteA: event.snap.siteId,
          linkA: event.snap.linkId,
          at: event.snap.point,
        },
        effects: [],
        handled: true,
      };
    }
    return { state: { phase: "idle", lastMessage: "needSite" }, effects: [], handled: true };
  }

  // state.phase === "pickedA"
  const candidates = sitesNear(ctx.doc, event.world, ctx.radiusWorld).filter(
    (c) => c.siteId !== state.siteA,
  );
  if (candidates.length === 0) {
    return { state: { ...state, lastMessage: undefined }, effects: [], handled: true };
  }
  const differentLink = candidates.find((c) => c.linkId !== state.linkA);
  if (!differentLink) {
    return { state: { ...state, lastMessage: "differentLink" }, effects: [], handled: true };
  }
  if (alreadyJoined(ctx.doc, state.siteA, differentLink.siteId)) {
    return { state: { ...state, lastMessage: "alreadyPinned" }, effects: [], handled: true };
  }
  return {
    state: { phase: "idle" },
    effects: [{ kind: "commitPin", siteA: state.siteA, siteB: differentLink.siteId }],
    handled: true,
  };
}

function isBusy(state: PinToolState): boolean {
  return state.phase === "pickedA";
}

function hint(state: PinToolState, ctx: ToolContext): HintMessage {
  void ctx; // pin's hint never needs document lookups.
  if (state.phase === "idle") {
    return state.lastMessage === "needSite"
      ? { key: "tools.pin.hint.needSite" }
      : { key: "tools.pin.hint.idle" };
  }
  if (state.lastMessage === "differentLink") return { key: "tools.pin.hint.differentLink" };
  if (state.lastMessage === "alreadyPinned") return { key: "tools.pin.hint.alreadyPinned" };
  return { key: "tools.pin.hint.pickSecond" };
}

function preview(state: PinToolState): PreviewShape[] {
  return state.phase === "pickedA" ? [{ kind: "point", at: state.at }] : [];
}

function snapAnchor(state: PinToolState): Vec2 | undefined {
  return state.phase === "pickedA" ? state.at : undefined;
}

function dynamicInput(): DynamicInputState | undefined {
  return undefined;
}

export const pinTool: ToolMachine<PinToolState> = {
  id: "pin",
  initial: () => ({ phase: "idle" }),
  reduce,
  isBusy,
  hint,
  preview,
  snapAnchor,
  dynamicInput,
};
