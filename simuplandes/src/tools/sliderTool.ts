/**
 * The Slider tool: click a point (or an existing site) to anchor a
 * prismatic joint, then aim its sliding axis with the pointer (15deg
 * angle-snap, via the controller's `computeSnap` using `snapAnchor` as the
 * anchor) or by typing the angle directly -- the dynamic input buffer
 * starts on the ANGLE field here, unlike Bar/Plate's length-first default.
 */

import { direction, magnitude, sub, type Vec2 } from "../geom";
import { degToRad, radToDeg } from "../model/units";
import { parseNumberInput } from "../i18n/numberFormat";
import { applyDynamicKey, type DynamicInputState } from "./dynamicInput";
import type {
  HintMessage,
  PreviewShape,
  ToolContext,
  ToolEvent,
  ToolMachine,
  ToolReduceResult,
} from "./types";
import type { Id } from "../model";

export type SliderToolState =
  | { phase: "idle" }
  | { phase: "aiming"; at: Vec2; siteId?: Id; axisAngle: number; input: DynamicInputState };

function initialAngleInput(): DynamicInputState {
  return { field: "angle", length: "", angle: "" };
}

function reduce(
  state: SliderToolState,
  event: ToolEvent,
  ctx: ToolContext,
): ToolReduceResult<SliderToolState> {
  void ctx;
  if (event.type === "cancel") {
    return { state: { phase: "idle" }, effects: [], handled: state.phase === "aiming" };
  }

  if (state.phase === "idle") {
    if (event.type === "pointerdown" && event.button !== 2) {
      return {
        state: {
          phase: "aiming",
          at: event.snap.point,
          siteId: event.snap.siteId,
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
    return {
      state: { phase: "idle" },
      effects: [
        {
          kind: "commitSlider",
          at: state.at,
          axisAngle: state.axisAngle,
          siteId: state.siteId,
          blockHalfSize: 1.5 * ctx.radiusWorld,
        },
      ],
      handled: true,
    };
  }

  if (event.type === "pointermove") {
    const rel = sub(event.world, state.at);
    let axisAngle = state.axisAngle;
    if (event.snap.kind === "angle" && event.snap.angleDeg !== undefined) {
      axisAngle = degToRad(event.snap.angleDeg);
    } else if (magnitude(rel) > 1e-9) {
      axisAngle = direction(rel);
    }
    return { state: { ...state, axisAngle }, effects: [], handled: true };
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
      effects: [
        {
          kind: "commitSlider",
          at: state.at,
          axisAngle,
          siteId: state.siteId,
          blockHalfSize: 1.5 * ctx.radiusWorld,
        },
      ],
      handled: true,
    };
  }

  return { state, effects: [], handled: false };
}

function isBusy(state: SliderToolState): boolean {
  return state.phase === "aiming";
}

function hint(state: SliderToolState): HintMessage {
  if (state.phase === "idle") return { key: "tools.slider.hint.idle" };
  return { key: "tools.slider.hint.aim", values: { angle: radToDeg(state.axisAngle) } };
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
  dynamicInput,
};
