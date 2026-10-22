/**
 * The Pin tool: joins two links with a revolute (R) joint. A joint can go
 * on an existing site or anywhere on a link's body (a new site is added
 * there, see `attach.ts`).
 *
 * - One click where two links meet (a crossing, a bar end lying on another
 *   bar, two coincident sites) pins them there at once.
 * - A click on a single link picks it; a click on another link then joins
 *   the two points (the solver pulls them together when they are apart).
 *
 * Hovering keeps `hover` up to date, so the hint names what a click would
 * do and the preview marks a point where nothing can be pinned.
 */

import { attachmentsAt, jointPoint, type Attachment } from "../canvas/attach";
import { indexDocument, type Id, type MechanismDocument } from "../model";
import type {
  HintMessage,
  LinkEnd,
  PreviewShape,
  ToolContext,
  ToolEvent,
  ToolMachine,
  ToolReduceResult,
} from "./types";
import type { Vec2 } from "../geom";
import type { DynamicInputState } from "./dynamicInput";

/** What is under the cursor: the links a pin there could join, nearest first. */
export interface PinHover {
  at: Vec2;
  linkIds: Id[];
}

export type PinToolState =
  | { phase: "idle"; hover?: PinHover; lastMessage?: "needLink" | "alreadyPinned" }
  | {
      phase: "pickedA";
      a: LinkEnd;
      linkA: Id;
      at: Vec2;
      hover?: PinHover;
      lastMessage?: "needLink" | "differentLink" | "alreadyPinned";
    };

function endFor(candidate: Attachment, at: Vec2): LinkEnd {
  return candidate.kind === "site"
    ? { kind: "site", siteId: candidate.siteId }
    : { kind: "link", linkId: candidate.linkId, at };
}

function alreadyJoined(doc: MechanismDocument, a: LinkEnd, b: LinkEnd): boolean {
  if (a.kind !== "site" || b.kind !== "site") return false;
  const joints = indexDocument(doc).jointsBySite.get(a.siteId) ?? [];
  return joints.some((joint) => joint.siteA === b.siteId || joint.siteB === b.siteId);
}

function hoverAt(ctx: ToolContext, world: Vec2): PinHover {
  return {
    at: world,
    linkIds: attachmentsAt(ctx.doc, world, ctx.radiusWorld).map((c) => c.linkId),
  };
}

function clickIdle(world: Vec2, ctx: ToolContext): ToolReduceResult<PinToolState> {
  const hover = hoverAt(ctx, world);
  const candidates = attachmentsAt(ctx.doc, world, ctx.radiusWorld);
  if (candidates.length === 0) {
    return { state: { phase: "idle", hover, lastMessage: "needLink" }, effects: [], handled: true };
  }
  if (candidates.length === 1) {
    const only = candidates[0];
    return {
      state: { phase: "pickedA", a: endFor(only, only.point), linkA: only.linkId, at: only.point },
      effects: [],
      handled: true,
    };
  }
  // Two or more links meet here: pin the nearest pair not already pinned.
  for (let i = 0; i < candidates.length; i++) {
    for (let j = i + 1; j < candidates.length; j++) {
      const at = jointPoint(ctx.doc, candidates[i], candidates[j], world, ctx.radiusWorld);
      const a = endFor(candidates[i], at);
      const b = endFor(candidates[j], at);
      if (alreadyJoined(ctx.doc, a, b)) continue;
      return {
        state: { phase: "idle", hover },
        effects: [{ kind: "commitPin", a, b }],
        handled: true,
      };
    }
  }
  return {
    state: { phase: "idle", hover, lastMessage: "alreadyPinned" },
    effects: [],
    handled: true,
  };
}

function clickSecond(
  state: Extract<PinToolState, { phase: "pickedA" }>,
  world: Vec2,
  ctx: ToolContext,
): ToolReduceResult<PinToolState> {
  const candidates = attachmentsAt(ctx.doc, world, ctx.radiusWorld);
  const other = candidates.find((c) => c.linkId !== state.linkA);
  if (!other) {
    const lastMessage = candidates.length === 0 ? "needLink" : "differentLink";
    return { state: { ...state, lastMessage }, effects: [], handled: true };
  }
  const b = endFor(other, other.point);
  if (alreadyJoined(ctx.doc, state.a, b)) {
    return { state: { ...state, lastMessage: "alreadyPinned" }, effects: [], handled: true };
  }
  return {
    state: { phase: "idle", hover: hoverAt(ctx, world) },
    effects: [{ kind: "commitPin", a: state.a, b }],
    handled: true,
  };
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
    const hover = hoverAt(ctx, event.world);
    return { state: { ...state, hover, lastMessage: undefined }, effects: [], handled: false };
  }

  if (event.type !== "pointerdown") {
    return { state, effects: [], handled: false };
  }

  if (event.button === 2) {
    return { state: { phase: "idle" }, effects: [], handled: state.phase === "pickedA" };
  }

  return state.phase === "idle"
    ? clickIdle(event.world, ctx)
    : clickSecond(state, event.world, ctx);
}

function isBusy(state: PinToolState): boolean {
  return state.phase === "pickedA";
}

function linkName(ctx: ToolContext, linkId: Id): string {
  const link = indexDocument(ctx.doc).links.get(linkId);
  return link?.name || linkId;
}

function hint(state: PinToolState, ctx: ToolContext): HintMessage {
  if (state.phase === "idle") {
    if (state.lastMessage === "needLink") return { key: "tools.pin.hint.needLink" };
    if (state.lastMessage === "alreadyPinned") return { key: "tools.pin.hint.alreadyPinned" };
    const links = state.hover?.linkIds;
    if (!links) return { key: "tools.pin.hint.idle" };
    if (links.length === 0) return { key: "tools.pin.hint.noTarget" };
    if (links.length === 1) {
      return { key: "tools.pin.hint.oneLink", values: { link: linkName(ctx, links[0]) } };
    }
    return {
      key: "tools.pin.hint.pinHere",
      values: { a: linkName(ctx, links[0]), b: linkName(ctx, links[1]) },
    };
  }
  if (state.lastMessage === "needLink") return { key: "tools.pin.hint.needLink" };
  if (state.lastMessage === "differentLink") return { key: "tools.pin.hint.differentLink" };
  if (state.lastMessage === "alreadyPinned") return { key: "tools.pin.hint.alreadyPinned" };
  const target = state.hover?.linkIds.find((id) => id !== state.linkA);
  if (target !== undefined) {
    return {
      key: "tools.pin.hint.pinTo",
      values: { link: linkName(ctx, state.linkA), target: linkName(ctx, target) },
    };
  }
  return { key: "tools.pin.hint.pickSecond", values: { link: linkName(ctx, state.linkA) } };
}

function preview(state: PinToolState): PreviewShape[] {
  const shapes: PreviewShape[] = [];
  const hover = state.hover;
  if (state.phase === "pickedA") {
    shapes.push({ kind: "point", at: state.at });
    if (hover) shapes.push({ kind: "segment", a: state.at, b: hover.at, dashed: true });
  }
  const valid =
    hover === undefined ||
    (state.phase === "idle"
      ? hover.linkIds.length > 0
      : hover.linkIds.some((id) => id !== state.linkA));
  if (hover && !valid) shapes.push({ kind: "blocked", at: hover.at });
  return shapes;
}

function snapAnchor(): Vec2 | undefined {
  return undefined;
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
  // Only points a pin can use: no grid or angle candidates.
  snapKinds: { grid: false, angle: false, link: true },
};
