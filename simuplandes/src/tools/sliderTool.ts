/**
 * The Slider tool: a pure prismatic joint between two existing parts, with
 * no extra body and no revolute -- the sliding part cannot rotate relative
 * to its guide (a telescoping arm, a piston rod in its cylinder).
 *
 * 1. Click the part that slides (a site, or any point on its body): the
 *    block glyph is drawn there.
 * 2. Aim the axis and click the guide part. Over a bar the axis snaps to
 *    the bar's direction (see `sliderAim.ts`); in empty space the guide is
 *    ground and the axis follows the 15deg angle snap or a typed angle.
 *
 * For a slider block pinned to another part (slider-crank), use the
 * Slider + revolute tool, which adds the block as its own rigid body.
 */

import type { Vec2 } from "../geom";
import { degToRad, radToDeg } from "../model/units";
import { parseNumberInput } from "../i18n/numberFormat";
import { attachmentsAt } from "../canvas/attach";
import { indexDocument, type Id } from "../model";
import { aimAt } from "./sliderAim";
import { applyDynamicKey, type DynamicInputState } from "./dynamicInput";
import type {
  HintMessage,
  LinkEnd,
  PreviewShape,
  ToolContext,
  ToolEffect,
  ToolEvent,
  ToolMachine,
  ToolReduceResult,
} from "./types";

export type SliderToolState =
  | { phase: "idle"; lastMessage?: "needLink" }
  | {
      phase: "aiming";
      at: Vec2;
      /** The sliding part: an existing site or a point on its body. */
      block: LinkEnd;
      anchorLinkId: Id;
      /** The sliding part is ground, so the guide must be a moving link. */
      anchorIsGround: boolean;
      axisAngle: number;
      railLinkId?: Id;
      railName?: string;
      input: DynamicInputState;
    };

type Aiming = Extract<SliderToolState, { phase: "aiming" }>;

function initialAngleInput(): DynamicInputState {
  return { field: "angle", length: "", angle: "" };
}

/** The sliding part under a click: the snapped site or link, else the nearest attachment. */
function blockAt(
  event: Extract<ToolEvent, { world: Vec2 }>,
  ctx: ToolContext,
): { block: LinkEnd; at: Vec2; linkId: Id } | undefined {
  const { snap } = event;
  const index = indexDocument(ctx.doc);
  if (snap.siteId) {
    const entry = index.sites.get(snap.siteId);
    if (entry)
      return {
        block: { kind: "site", siteId: snap.siteId },
        at: snap.point,
        linkId: entry.link.id,
      };
  }
  if (snap.linkId && index.links.has(snap.linkId)) {
    return {
      block: { kind: "link", linkId: snap.linkId, at: snap.point },
      at: snap.point,
      linkId: snap.linkId,
    };
  }
  const [candidate] = attachmentsAt(ctx.doc, event.world, ctx.radiusWorld);
  if (!candidate) return undefined;
  const block: LinkEnd =
    candidate.kind === "site"
      ? { kind: "site", siteId: candidate.siteId }
      : { kind: "link", linkId: candidate.linkId, at: candidate.point };
  return { block, at: candidate.point, linkId: candidate.linkId };
}

/** The commit for `state`, or `undefined` when both sides would be ground. */
function commitEffect(state: Aiming, axisAngle: number): ToolEffect | undefined {
  if (state.anchorIsGround && !state.railLinkId) return undefined;
  return {
    kind: "commitPrismatic",
    block: state.block,
    at: state.at,
    axisAngle,
    ...(state.railLinkId ? { railLinkId: state.railLinkId } : {}),
  };
}

function commit(state: Aiming, axisAngle: number): ToolReduceResult<SliderToolState> {
  const effect = commitEffect(state, axisAngle);
  if (!effect) {
    return { state: { ...state, axisAngle }, effects: [], handled: true };
  }
  return { state: { phase: "idle" }, effects: [effect], handled: true };
}

function reduce(
  state: SliderToolState,
  event: ToolEvent,
  ctx: ToolContext,
): ToolReduceResult<SliderToolState> {
  if (event.type === "cancel") {
    return { state: { phase: "idle" }, effects: [], handled: state.phase === "aiming" };
  }

  if (state.phase === "idle") {
    if (event.type === "pointerdown" && event.button !== 2) {
      const picked = blockAt(event, ctx);
      if (!picked) {
        return { state: { phase: "idle", lastMessage: "needLink" }, effects: [], handled: true };
      }
      const link = indexDocument(ctx.doc).links.get(picked.linkId);
      return {
        state: {
          phase: "aiming",
          at: picked.at,
          block: picked.block,
          anchorLinkId: picked.linkId,
          anchorIsGround: link?.isGround ?? false,
          axisAngle: 0,
          input: initialAngleInput(),
        },
        effects: [],
        handled: true,
      };
    }
    return { state, effects: [], handled: false };
  }

  // state.phase === "aiming"
  if (event.type === "pointerdown") {
    if (event.button === 2) {
      return { state: { phase: "idle" }, effects: [], handled: true };
    }
    const aimed = aimAt(state, event.world, event.snap, ctx);
    return commit(aimed, aimed.axisAngle);
  }

  if (event.type === "pointermove") {
    return { state: aimAt(state, event.world, event.snap, ctx), effects: [], handled: true };
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
    let axisAngle = state.axisAngle;
    if (state.input.angle !== "") {
      const parsedDeg = parseNumberInput(state.input.angle);
      if (parsedDeg === null) {
        return { state, effects: [], handled: true };
      }
      axisAngle = degToRad(parsedDeg);
    }
    return commit(state, axisAngle);
  }

  return { state, effects: [], handled: false };
}

function isBusy(state: SliderToolState): boolean {
  return state.phase === "aiming";
}

function hint(state: SliderToolState): HintMessage {
  if (state.phase === "idle") {
    return { key: state.lastMessage ? "tools.slider.hint.needLink" : "tools.slider.hint.idle" };
  }
  const angle = radToDeg(state.axisAngle);
  if (state.railLinkId) {
    return {
      key: "tools.slider.hint.aimRail",
      values: { angle, rail: state.railName ?? state.railLinkId },
    };
  }
  if (state.anchorIsGround) return { key: "tools.slider.hint.needRail" };
  return { key: "tools.slider.hint.aim", values: { angle } };
}

function preview(state: SliderToolState): PreviewShape[] {
  return state.phase === "aiming" ? [{ kind: "ray", from: state.at, angle: state.axisAngle }] : [];
}

function snapAnchor(state: SliderToolState): Vec2 | undefined {
  return state.phase === "aiming" ? state.at : undefined;
}

function dynamicInput(state: SliderToolState): DynamicInputState | undefined {
  return state.phase === "aiming" ? state.input : undefined;
}

export const sliderTool: ToolMachine<SliderToolState> = {
  id: "slider",
  initial: () => ({ phase: "idle" }),
  reduce,
  isBusy,
  hint,
  preview,
  snapAnchor,
  snapKinds: { link: true },
  dynamicInput,
};
