/**
 * The Image tool (Draw mode): places the background reference image. A
 * drag inside the image moves it; a drag on one of its corner handles
 * scales it about the opposite corner, keeping its proportions. Each drag
 * is ONE undo step (every edit shares the gesture's `gestureSeed`).
 * Importing, the exact width, opacity and removal live in the tool's
 * toolbar (`BackgroundToolbar`).
 */

import type { Vec2 } from "../geom";
import type { BackgroundImage } from "../model";
import type { DynamicInputState } from "./dynamicInput";
import type {
  HintMessage,
  PreviewShape,
  ToolContext,
  ToolEvent,
  ToolHandle,
  ToolMachine,
  ToolReduceResult,
} from "./types";

export type ImageToolState =
  | { phase: "idle" }
  | { phase: "moving"; grabOffset: Vec2; gestureId: string }
  | {
      phase: "scaling";
      /** The corner that stays put. */
      anchor: Vec2;
      /** +1/-1: which side of `anchor` the dragged corner is on, per axis. */
      sign: Vec2;
      gestureId: string;
    };

/** The smallest size a drag can scale the image to, in screen-independent pick radii. */
const MIN_SIZE_RADII = 2;

/** The image's four corners: bottom-left, bottom-right, top-right, top-left (world, y-up). */
export function backgroundCorners(bg: BackgroundImage): Vec2[] {
  const [cx, cy] = bg.center;
  const hw = bg.width / 2;
  const hh = bg.height / 2;
  return [
    { x: cx - hw, y: cy - hh },
    { x: cx + hw, y: cy - hh },
    { x: cx + hw, y: cy + hh },
    { x: cx - hw, y: cy + hh },
  ];
}

function insideImage(bg: BackgroundImage, p: Vec2): boolean {
  return (
    Math.abs(p.x - bg.center[0]) <= bg.width / 2 && Math.abs(p.y - bg.center[1]) <= bg.height / 2
  );
}

const IDLE: ImageToolState = { phase: "idle" };

function ignore(state: ImageToolState): ToolReduceResult<ImageToolState> {
  return { state, effects: [], handled: false };
}

function pointerDown(world: Vec2, ctx: ToolContext): ToolReduceResult<ImageToolState> {
  const bg = ctx.doc.background;
  if (!bg) return ignore(IDLE);
  const gestureId = ctx.gestureSeed;
  const corners = backgroundCorners(bg);
  let nearest = -1;
  let nearestDistance = Infinity;
  corners.forEach((corner, i) => {
    const d = Math.hypot(world.x - corner.x, world.y - corner.y);
    if (d < nearestDistance) {
      nearest = i;
      nearestDistance = d;
    }
  });
  if (nearest >= 0 && nearestDistance <= ctx.radiusWorld) {
    const grabbed = corners[nearest];
    const anchor = corners[(nearest + 2) % 4];
    return {
      state: {
        phase: "scaling",
        anchor,
        sign: { x: Math.sign(grabbed.x - anchor.x), y: Math.sign(grabbed.y - anchor.y) },
        gestureId,
      },
      effects: [],
      handled: true,
    };
  }
  if (insideImage(bg, world)) {
    return {
      state: {
        phase: "moving",
        grabOffset: { x: world.x - bg.center[0], y: world.y - bg.center[1] },
        gestureId,
      },
      effects: [],
      handled: true,
    };
  }
  return ignore(IDLE);
}

function pointerMove(
  state: Exclude<ImageToolState, { phase: "idle" }>,
  world: Vec2,
  ctx: ToolContext,
): ToolReduceResult<ImageToolState> {
  const bg = ctx.doc.background;
  if (!bg) return { state: IDLE, effects: [], handled: true };
  let next: BackgroundImage;
  if (state.phase === "moving") {
    next = { ...bg, center: [world.x - state.grabOffset.x, world.y - state.grabOffset.y] };
  } else {
    // The pointer's reach from the fixed corner, along the dragged corner's
    // own direction; the larger of the two (in proportion) sets the size.
    const aspect = bg.height / bg.width;
    const reachX = Math.max(0, (world.x - state.anchor.x) * state.sign.x);
    const reachY = Math.max(0, (world.y - state.anchor.y) * state.sign.y);
    const minWidth = (MIN_SIZE_RADII * ctx.radiusWorld) / Math.min(1, aspect);
    const width = Math.max(minWidth, reachX, reachY / aspect);
    const height = width * aspect;
    next = {
      ...bg,
      width,
      height,
      center: [
        state.anchor.x + (state.sign.x * width) / 2,
        state.anchor.y + (state.sign.y * height) / 2,
      ],
    };
  }
  return {
    state,
    effects: [{ kind: "setBackground", background: next, gestureId: state.gestureId }],
    handled: true,
  };
}

function reduce(
  state: ImageToolState,
  event: ToolEvent,
  ctx: ToolContext,
): ToolReduceResult<ImageToolState> {
  const busy = state.phase !== "idle";
  switch (event.type) {
    case "cancel":
      return { state: IDLE, effects: [], handled: busy };
    case "key":
      return event.key === "Escape" && busy
        ? { state: IDLE, effects: [], handled: true }
        : ignore(state);
    case "pointerdown":
      if (event.button !== 0) return ignore(state);
      return pointerDown(event.world, ctx);
    case "pointermove":
      return busy ? pointerMove(state, event.world, ctx) : ignore(state);
    case "pointerup":
      return { state: IDLE, effects: [], handled: busy };
    default:
      return ignore(state);
  }
}

function hint(state: ImageToolState, ctx: ToolContext): HintMessage {
  if (!ctx.doc.background) return { key: "tools.image.hint.empty" };
  if (state.phase === "moving") return { key: "tools.image.hint.moving" };
  if (state.phase === "scaling") return { key: "tools.image.hint.scaling" };
  return { key: "tools.image.hint.idle" };
}

export const imageTool: ToolMachine<ImageToolState> = {
  id: "image",
  initial: () => IDLE,
  reduce,
  isBusy: (state) => state.phase !== "idle",
  hint,
  preview: (): PreviewShape[] => [],
  snapAnchor: () => undefined,
  // The image follows the pointer freely: no snap ring.
  snapKinds: { site: false, midpoint: false, link: false, grid: false, angle: false },
  dynamicInput: (): DynamicInputState | undefined => undefined,
  handles: (state, ctx): ToolHandle[] => {
    const bg = ctx.doc.background;
    if (!bg) return [];
    return backgroundCorners(bg).map((at) => ({
      kind: "vertex",
      at,
      active: state.phase === "scaling",
    }));
  },
};
