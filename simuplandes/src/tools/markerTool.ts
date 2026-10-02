/**
 * The Marker tool: a single click on a NON-ground link (its body, or one of
 * its sites/joints) adds a trace marker there, link-local -- never busy, no
 * multi-step gesture. A click on ground, or on nothing, just hints
 * `needLink`.
 */

import { hitTest } from "../canvas/hitTest";
import { indexDocument, worldToLinkLocal, type Id } from "../model";
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

export type MarkerToolState = { status: "idle" | "needLink" };

function reduce(
  state: MarkerToolState,
  event: ToolEvent,
  ctx: ToolContext,
): ToolReduceResult<MarkerToolState> {
  if (event.type === "pointermove") {
    return state.status === "idle"
      ? { state, effects: [], handled: false }
      : { state: { status: "idle" }, effects: [], handled: false };
  }

  if (event.type !== "pointerdown" || event.button === 2) {
    return { state, effects: [], handled: false };
  }

  const hit = hitTest(ctx.doc, event.world, ctx.radiusWorld);
  let linkId: Id | undefined;
  if (hit.kind === "link" || hit.kind === "site" || hit.kind === "joint") {
    linkId = hit.linkId;
  }

  if (linkId === undefined) {
    return { state: { status: "needLink" }, effects: [], handled: true };
  }

  const link = indexDocument(ctx.doc).links.get(linkId);
  if (!link || link.isGround) {
    return { state: { status: "needLink" }, effects: [], handled: true };
  }

  const local = worldToLinkLocal(link.pose, event.snap.point);
  return {
    state: { status: "idle" },
    effects: [{ kind: "addMarker", linkId, local }],
    handled: true,
  };
}

function isBusy(): boolean {
  return false;
}

function hint(state: MarkerToolState): HintMessage {
  return state.status === "needLink"
    ? { key: "tools.marker.hint.needLink" }
    : { key: "tools.marker.hint.idle" };
}

function preview(): PreviewShape[] {
  return [];
}

function snapAnchor(): Vec2 | undefined {
  return undefined;
}

function dynamicInput(): DynamicInputState | undefined {
  return undefined;
}

export const markerTool: ToolMachine<MarkerToolState> = {
  id: "marker",
  initial: () => ({ status: "idle" }),
  reduce,
  isBusy,
  hint,
  preview,
  snapAnchor,
  dynamicInput,
};
