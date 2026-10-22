/**
 * The Ground pivot tool: a single click pins a point to ground -- never
 * busy, no multi-step gesture. A click on a link (an existing site or any
 * point on its body, see `attach.ts`) pins that link there; a click in
 * empty space places a lone ground pivot to draw from. When several sites
 * coincide, it prefers a moving site that isn't already grounded over the
 * ground site itself, so clicking near a pinned joint still finds
 * something useful to pin. Hovering keeps the hint saying which of the two
 * a click would do.
 */

import { attachmentsAt } from "../canvas/attach";
import { indexDocument, type Id } from "../model";
import type {
  HintMessage,
  PreviewShape,
  ToolContext,
  ToolEvent,
  ToolMachine,
  ToolReduceResult,
} from "./types";
import type { Attachment } from "../canvas/attach";
import type { Vec2 } from "../geom";
import type { DynamicInputState } from "./dynamicInput";

export interface GroundPivotToolState {
  status: "idle" | "alreadyGround";
  /** The moving link a click at the cursor would pin, `null` over empty space; unset before any move. */
  hoverLinkId?: Id | null;
}

function isAlreadyGrounded(doc: ToolContext["doc"], siteId: Id): boolean {
  const index = indexDocument(doc);
  const joints = index.jointsBySite.get(siteId) ?? [];
  return joints.some((joint) => {
    const otherId = joint.siteA === siteId ? joint.siteB : joint.siteA;
    const other = index.sites.get(otherId);
    return other?.link.isGround === true;
  });
}

function reduce(
  state: GroundPivotToolState,
  event: ToolEvent,
  ctx: ToolContext,
): ToolReduceResult<GroundPivotToolState> {
  if (event.type === "pointermove") {
    const target = pick(ctx, event.world);
    const status = target.kind === "alreadyGround" ? "alreadyGround" : "idle";
    return {
      state: { status, hoverLinkId: target.kind === "link" ? target.linkId : null },
      effects: [],
      handled: false,
    };
  }

  if (event.type !== "pointerdown" || event.button === 2) {
    return { state, effects: [], handled: false };
  }

  const target = pick(ctx, event.world);
  const hoverLinkId = target.kind === "link" ? target.linkId : null;
  if (target.kind === "alreadyGround") {
    return { state: { status: "alreadyGround", hoverLinkId }, effects: [], handled: true };
  }
  if (target.kind === "empty") {
    return {
      state: { status: "idle", hoverLinkId },
      effects: [{ kind: "commitGroundPivot", at: event.snap.point }],
      handled: true,
    };
  }
  const { candidate } = target;
  return {
    state: { status: "idle", hoverLinkId },
    effects: [
      candidate.kind === "site"
        ? { kind: "commitGroundPivot", at: candidate.point, siteId: candidate.siteId }
        : { kind: "commitGroundPivot", at: candidate.point, linkId: candidate.linkId },
    ],
    handled: true,
  };
}

type Target =
  | { kind: "link"; linkId: Id; candidate: Attachment }
  | { kind: "alreadyGround" }
  | { kind: "empty" };

/** What a click at `world` would pin: a moving link's site or body point, nothing new, or empty space. */
function pick(ctx: ToolContext, world: Vec2): Target {
  const candidates = attachmentsAt(ctx.doc, world, ctx.radiusWorld);
  if (candidates.length === 0) return { kind: "empty" };
  const moving = candidates.filter((c) => c.kind === "link" || !c.isGround);
  const chosen = moving.find((c) => c.kind === "link" || !isAlreadyGrounded(ctx.doc, c.siteId));
  // Only ground, or only sites already pinned to ground, within radius.
  if (!chosen) return { kind: "alreadyGround" };
  return { kind: "link", linkId: chosen.linkId, candidate: chosen };
}

function isBusy(): boolean {
  return false;
}

function hint(state: GroundPivotToolState, ctx: ToolContext): HintMessage {
  if (state.status === "alreadyGround") {
    return { key: "tools.groundPivot.hint.alreadyGround" };
  }
  if (state.hoverLinkId === null) return { key: "tools.groundPivot.hint.empty" };
  if (state.hoverLinkId !== undefined) {
    const link = indexDocument(ctx.doc).links.get(state.hoverLinkId);
    return {
      key: "tools.groundPivot.hint.onLink",
      values: { link: link?.name || state.hoverLinkId },
    };
  }
  return { key: "tools.groundPivot.hint.idle" };
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

export const groundPivotTool: ToolMachine<GroundPivotToolState> = {
  id: "groundPivot",
  initial: () => ({ status: "idle" }),
  reduce,
  isBusy,
  hint,
  preview,
  snapAnchor,
  dynamicInput,
  snapKinds: { link: true },
};
