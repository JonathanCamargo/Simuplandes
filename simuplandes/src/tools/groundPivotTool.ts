/**
 * The Ground pivot tool: a single click pins a point (or an existing site)
 * to ground -- never busy, no multi-step gesture. When several sites
 * coincide at the click point, `sitesNear` (not `computeSnap`, which only
 * ever resolves ONE candidate) lets this tool prefer a moving site that
 * isn't already grounded over the ground site itself, so clicking near an
 * already-pinned joint still finds something useful to pin.
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

export interface GroundPivotToolState {
  status: "idle" | "alreadyGround";
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
    return state.status === "idle"
      ? { state, effects: [], handled: false }
      : { state: { status: "idle" }, effects: [], handled: false };
  }

  if (event.type !== "pointerdown" || event.button === 2) {
    return { state, effects: [], handled: false };
  }

  const candidates = sitesNear(ctx.doc, event.world, ctx.radiusWorld);
  if (candidates.length === 0) {
    return {
      state: { status: "idle" },
      effects: [{ kind: "commitGroundPivot", at: event.snap.point }],
      handled: true,
    };
  }

  const nonGround = candidates.filter((c) => !c.isGround);
  const chosen = nonGround.find((c) => !isAlreadyGrounded(ctx.doc, c.siteId)) ?? nonGround[0];

  if (!chosen) {
    // Only ground sites are within radius: clicking directly on ground.
    return { state: { status: "alreadyGround" }, effects: [], handled: true };
  }

  return {
    state: { status: "idle" },
    effects: [{ kind: "commitGroundPivot", at: chosen.point, siteId: chosen.siteId }],
    handled: true,
  };
}

function isBusy(): boolean {
  return false;
}

function hint(state: GroundPivotToolState): HintMessage {
  if (state.status === "alreadyGround") {
    return { key: "tools.groundPivot.hint.alreadyGround" };
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
};
