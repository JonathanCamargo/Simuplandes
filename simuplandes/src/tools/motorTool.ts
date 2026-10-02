/**
 * The Motor tool: a single click near one or more joint sites adds a motor
 * to one of the joints touching them -- never busy, no multi-step gesture.
 * When several joints touch the click point (a coincident-site pile-up),
 * this tool prefers the one touching a ground link (the "obvious" input
 * joint of a mechanism), else the first joint in document order.
 */

import { sitesNear } from "../canvas/hitTest";
import { indexDocument, type Id, type Joint, type MechanismDocument } from "../model";
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

export type MotorToolState =
  { status: "idle" } | { status: "needJoint" } | { status: "alreadyMotor"; jointId: Id };

/** Every joint touching a site within `radiusWorld` of `world`, in document order, deduped. */
function collectNearbyJoints(doc: MechanismDocument, world: Vec2, radiusWorld: number): Joint[] {
  const nearSiteIds = new Set(sitesNear(doc, world, radiusWorld).map((s) => s.siteId));
  const seen = new Set<Id>();
  const result: Joint[] = [];
  for (const joint of doc.joints) {
    if (!nearSiteIds.has(joint.siteA) && !nearSiteIds.has(joint.siteB)) continue;
    if (seen.has(joint.id)) continue;
    seen.add(joint.id);
    result.push(joint);
  }
  return result;
}

function jointTouchesGround(doc: MechanismDocument, joint: Joint): boolean {
  const index = indexDocument(doc);
  const a = index.sites.get(joint.siteA);
  const b = index.sites.get(joint.siteB);
  return Boolean(a?.link.isGround) || Boolean(b?.link.isGround);
}

/** Prefers a joint touching ground; else the first (in document order) among the nearby joints. */
function chooseJoint(doc: MechanismDocument, world: Vec2, radiusWorld: number): Joint | undefined {
  const joints = collectNearbyJoints(doc, world, radiusWorld);
  if (joints.length === 0) return undefined;
  return joints.find((joint) => jointTouchesGround(doc, joint)) ?? joints[0];
}

function reduce(
  state: MotorToolState,
  event: ToolEvent,
  ctx: ToolContext,
): ToolReduceResult<MotorToolState> {
  if (event.type === "pointermove") {
    return state.status === "idle"
      ? { state, effects: [], handled: false }
      : { state: { status: "idle" }, effects: [], handled: false };
  }

  if (event.type !== "pointerdown" || event.button === 2) {
    return { state, effects: [], handled: false };
  }

  const joint = chooseJoint(ctx.doc, event.world, ctx.radiusWorld);
  if (!joint) {
    return { state: { status: "needJoint" }, effects: [], handled: true };
  }

  const hasMotor = ctx.doc.motors.some((m) => m.jointId === joint.id);
  if (hasMotor) {
    return { state: { status: "alreadyMotor", jointId: joint.id }, effects: [], handled: true };
  }

  const motorKind = joint.type === "R" ? "rotary" : "linear";
  return {
    state: { status: "idle" },
    effects: [{ kind: "addMotor", jointId: joint.id, motorKind }],
    handled: true,
  };
}

function isBusy(): boolean {
  return false;
}

function hint(state: MotorToolState, ctx: ToolContext): HintMessage {
  if (state.status === "needJoint") return { key: "tools.motor.hint.needJoint" };
  if (state.status === "alreadyMotor") {
    const index = indexDocument(ctx.doc);
    const joint = index.joints.get(state.jointId);
    const target = joint?.name || state.jointId;
    return { key: "tools.motor.hint.alreadyMotor", values: { joint: target } };
  }
  return { key: "tools.motor.hint.idle" };
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

export const motorTool: ToolMachine<MotorToolState> = {
  id: "motor",
  initial: () => ({ status: "idle" }),
  reduce,
  isBusy,
  hint,
  preview,
  snapAnchor,
  dynamicInput,
};
