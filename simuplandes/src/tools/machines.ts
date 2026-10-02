/**
 * `TOOL_MACHINES`: the `ToolId -> ToolMachine` map the controller looks up
 * by `studio.activeTool`. Pan is the one remaining idle placeholder (never
 * busy, no effects, hint = the registry's own `hintKey`) -- panning is
 * handled directly by `CanvasStage`, not a tool machine. Every other tool
 * (Bar/Plate/GroundPivot/Pin/Slider from 04-04; Select/Motor/Marker from
 * 04-05) is a real machine.
 */

import { barTool } from "./barTool";
import { plateTool } from "./plateTool";
import { groundPivotTool } from "./groundPivotTool";
import { pinTool } from "./pinTool";
import { sliderTool } from "./sliderTool";
import { selectTool } from "./selectTool";
import { motorTool } from "./motorTool";
import { markerTool } from "./markerTool";
import { toolById, type ToolId } from "./registry";
import type { ToolMachine } from "./types";

/** A `ToolMachine` with its state type erased -- the controller holds one
 * machine at a time, chosen at runtime by `activeTool`, so it cannot know
 * each one's concrete state type statically. */
export type AnyToolMachine = ToolMachine<unknown>;

function erase<S>(machine: ToolMachine<S>): AnyToolMachine {
  return machine;
}

function idleMachine(id: ToolId): ToolMachine<Record<string, never>> {
  return {
    id,
    initial: () => ({}),
    reduce: (state) => ({ state, effects: [], handled: false }),
    isBusy: () => false,
    hint: () => ({ key: toolById(id).hintKey }),
    preview: () => [],
    snapAnchor: () => undefined,
    dynamicInput: () => undefined,
  };
}

export const TOOL_MACHINES: Readonly<Record<ToolId, AnyToolMachine>> = {
  select: erase(selectTool),
  pan: erase(idleMachine("pan")),
  bar: erase(barTool),
  plate: erase(plateTool),
  groundPivot: erase(groundPivotTool),
  pin: erase(pinTool),
  slider: erase(sliderTool),
  motor: erase(motorTool),
  marker: erase(markerTool),
};
