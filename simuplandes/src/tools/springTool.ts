/**
 * The Spring tool: two clicks connect two links with a linear
 * spring-damper. Each click picks an end: an existing site or joint (its
 * site is reused), a point on a moving link's body (a new site is added
 * there), or empty space (anchored to ground). The two ends must be on
 * different links. The free length is the distance between the ends, so
 * the spring starts unstretched.
 */

import { hitTest } from "../canvas/hitTest";
import { distance, type Vec2 } from "../geom";
import { indexDocument, siteWorldPosition, type Id, type MechanismDocument } from "../model";
import type {
  HintMessage,
  PreviewShape,
  SpringEnd,
  ToolContext,
  ToolEvent,
  ToolMachine,
  ToolReduceResult,
} from "./types";
import type { DynamicInputState } from "./dynamicInput";

export type SpringToolState =
  | { status: "idle" | "needLink" }
  | {
      status: "first" | "differentLink";
      first: SpringEnd;
      firstWorld: Vec2;
      firstLinkId: Id | null;
      pointer: Vec2;
    };

/** The end a click at `world` picks, its world point and the link it is on (`null` for ground anchors). */
function pickEnd(
  doc: MechanismDocument,
  world: Vec2,
  snapped: Vec2,
  radius: number,
): { end: SpringEnd; point: Vec2; linkId: Id | null } {
  const hit = hitTest(doc, world, radius);
  const index = indexDocument(doc);
  if (hit.kind === "site" || hit.kind === "joint") {
    const entry = index.sites.get(hit.siteId)!;
    return {
      end: { kind: "site", siteId: hit.siteId },
      point: siteWorldPosition(entry.link, entry.site.local),
      linkId: entry.link.isGround ? null : entry.link.id,
    };
  }
  let linkId: Id | undefined;
  if (hit.kind === "link") linkId = hit.linkId;
  if (hit.kind === "marker") linkId = index.markers.get(hit.markerId)!.linkId;
  if (linkId !== undefined && !index.links.get(linkId)!.isGround) {
    return { end: { kind: "link", linkId, at: snapped }, point: snapped, linkId };
  }
  return { end: { kind: "ground", at: snapped }, point: snapped, linkId: null };
}

function reduce(
  state: SpringToolState,
  event: ToolEvent,
  ctx: ToolContext,
): ToolReduceResult<SpringToolState> {
  if (event.type === "cancel" || (event.type === "key" && event.key === "Escape")) {
    const busy = state.status === "first" || state.status === "differentLink";
    return { state: { status: "idle" }, effects: [], handled: busy };
  }

  if (event.type === "pointermove") {
    if (state.status === "first" || state.status === "differentLink") {
      return { state: { ...state, pointer: event.snap.point }, effects: [], handled: false };
    }
    return state.status === "idle"
      ? { state, effects: [], handled: false }
      : { state: { status: "idle" }, effects: [], handled: false };
  }

  if (event.type !== "pointerdown" || event.button === 2) {
    return { state, effects: [], handled: false };
  }

  const picked = pickEnd(ctx.doc, event.world, event.snap.point, ctx.radiusWorld);

  if (state.status !== "first" && state.status !== "differentLink") {
    return {
      state: {
        status: "first",
        first: picked.end,
        firstWorld: picked.point,
        firstLinkId: picked.linkId,
        pointer: picked.point,
      },
      effects: [],
      handled: true,
    };
  }

  // Ground anchors all count as one link; so do two picks on the same link.
  if (picked.linkId === state.firstLinkId) {
    return { state: { ...state, status: "differentLink" }, effects: [], handled: true };
  }

  return {
    state: { status: "idle" },
    effects: [
      {
        kind: "commitSpring",
        a: state.first,
        b: picked.end,
        freeLength: distance(state.firstWorld, picked.point),
      },
    ],
    handled: true,
  };
}

function isBusy(state: SpringToolState): boolean {
  return state.status === "first" || state.status === "differentLink";
}

function hint(state: SpringToolState): HintMessage {
  switch (state.status) {
    case "first":
      return { key: "tools.spring.hint.pickSecond" };
    case "differentLink":
      return { key: "tools.spring.hint.differentLink" };
    default:
      return { key: "tools.spring.hint.idle" };
  }
}

function preview(state: SpringToolState): PreviewShape[] {
  if (state.status !== "first" && state.status !== "differentLink") return [];
  return [
    { kind: "point", at: state.firstWorld },
    { kind: "segment", a: state.firstWorld, b: state.pointer, dashed: true },
  ];
}

function snapAnchor(state: SpringToolState): Vec2 | undefined {
  return state.status === "first" || state.status === "differentLink"
    ? state.firstWorld
    : undefined;
}

function dynamicInput(): DynamicInputState | undefined {
  return undefined;
}

export const springTool: ToolMachine<SpringToolState> = {
  id: "spring",
  initial: () => ({ status: "idle" }),
  reduce,
  isBusy,
  hint,
  preview,
  snapAnchor,
  dynamicInput,
};
