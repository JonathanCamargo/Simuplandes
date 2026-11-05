/**
 * The Slider + revolute tool: adds an intermediate slider block (a new
 * rigid body, "Corredera") that slides on a rail with a prismatic joint
 * and is pinned to the anchor with a revolute joint. Click a point (or an
 * existing site) to anchor the block, then aim its sliding axis with the pointer (15deg
 * angle-snap, via the controller's `computeSnap` using `snapAnchor` as the
 * anchor) or by typing the angle directly -- the dynamic input buffer
 * starts on the ANGLE field here, unlike Bar/Plate's length-first default.
 *
 * The anchor may be a site (the block is pinned there), a point on a link's
 * body (a site is added there and pinned) or empty space (no pin).
 *
 * The rail -- the link the block slides along -- is ground unless the
 * pointer is over another moving link when the slider is committed (see
 * `sliderAim.ts`), e.g. for an inverted slider-crank.
 */

import type { Vec2 } from "../geom";
import { degToRad, radToDeg } from "../model/units";
import { parseNumberInput } from "../i18n/numberFormat";
import { aimAt } from "./sliderAim";
import { applyDynamicKey, type DynamicInputState } from "./dynamicInput";
import type {
  HintMessage,
  PreviewShape,
  ToolContext,
  ToolEffect,
  ToolEvent,
  ToolMachine,
  ToolReduceResult,
} from "./types";
import type { Id } from "../model";

export type SliderRevoluteToolState =
  | { phase: "idle" }
  | {
      phase: "aiming";
      at: Vec2;
      siteId?: Id;
      /** The anchor lies on this link's body (no site there yet): the block is pinned there. */
      linkId?: Id;
      /** The link the anchor belongs to; never offered as the rail. */
      anchorLinkId?: Id;
      axisAngle: number;
      /** The moving link the block will slide along; absent: ground. */
      railLinkId?: Id;
      /** The rail's display name, for the hint. */
      railName?: string;
      input: DynamicInputState;
    };

type Aiming = Extract<SliderRevoluteToolState, { phase: "aiming" }>;

function initialAngleInput(): DynamicInputState {
  return { field: "angle", length: "", angle: "" };
}

function commitEffect(state: Aiming, axisAngle: number, ctx: ToolContext): ToolEffect {
  return {
    kind: "commitSlider",
    at: state.at,
    axisAngle,
    siteId: state.siteId,
    blockHalfSize: 1.5 * ctx.radiusWorld,
    ...(state.linkId ? { linkId: state.linkId } : {}),
    ...(state.railLinkId ? { railLinkId: state.railLinkId } : {}),
  };
}

function reduce(
  state: SliderRevoluteToolState,
  event: ToolEvent,
  ctx: ToolContext,
): ToolReduceResult<SliderRevoluteToolState> {
  if (event.type === "cancel") {
    return { state: { phase: "idle" }, effects: [], handled: state.phase === "aiming" };
  }

  if (state.phase === "idle") {
    if (event.type === "pointerdown" && event.button !== 2) {
      const onBody = event.snap.kind === "link" && !event.snap.siteId && event.snap.linkId;
      return {
        state: {
          phase: "aiming",
          at: event.snap.point,
          siteId: event.snap.siteId,
          ...(onBody ? { linkId: event.snap.linkId } : {}),
          ...(event.snap.linkId ? { anchorLinkId: event.snap.linkId } : {}),
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
    return {
      state: { phase: "idle" },
      effects: [commitEffect(aimed, aimed.axisAngle, ctx)],
      handled: true,
    };
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
    return {
      state: { phase: "idle" },
      effects: [commitEffect(state, axisAngle, ctx)],
      handled: true,
    };
  }

  return { state, effects: [], handled: false };
}

function isBusy(state: SliderRevoluteToolState): boolean {
  return state.phase === "aiming";
}

function hint(state: SliderRevoluteToolState): HintMessage {
  if (state.phase === "idle") return { key: "tools.sliderRevolute.hint.idle" };
  const angle = radToDeg(state.axisAngle);
  if (state.railLinkId) {
    return {
      key: "tools.sliderRevolute.hint.aimRail",
      values: { angle, rail: state.railName ?? state.railLinkId },
    };
  }
  return { key: "tools.sliderRevolute.hint.aim", values: { angle } };
}

function preview(state: SliderRevoluteToolState): PreviewShape[] {
  return state.phase === "aiming" ? [{ kind: "ray", from: state.at, angle: state.axisAngle }] : [];
}

function snapAnchor(state: SliderRevoluteToolState): Vec2 | undefined {
  return state.phase === "aiming" ? state.at : undefined;
}

function dynamicInput(state: SliderRevoluteToolState): DynamicInputState | undefined {
  return state.phase === "aiming" ? state.input : undefined;
}

export const sliderRevoluteTool: ToolMachine<SliderRevoluteToolState> = {
  id: "sliderRevolute",
  initial: () => ({ phase: "idle" }),
  reduce,
  isBusy,
  hint,
  preview,
  snapAnchor,
  snapKinds: { link: true },
  dynamicInput,
};
