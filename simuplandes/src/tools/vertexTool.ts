/**
 * The Edit shape tool (Draw mode): reshapes a plate's outline or bends a
 * bar. A click on a link picks it and shows its handles:
 *  - a square on every plate vertex: drag to move it, click to select it
 *    (Delete removes it; a plate keeps at least 3);
 *  - a circle on every straight edge's midpoint: drag to add a plate
 *    vertex there, Shift+drag (or any drag, on a bar) to bend the edge into
 *    an arc, click to select the edge;
 *  - a diamond on every arc's apex: drag to change its bend;
 *  - two round control points on every Bézier edge: drag to shape it.
 * A selected edge gets a floating toolbar (see `edgeMenu`): Line / Arc /
 * Curve, and Split (plates). Delete straightens it.
 *
 * Only the shape changes: a bar's vertices are its sites and never move
 * here, and no site, joint or other link is ever touched. Each drag is ONE
 * undo step: every edit in a drag shares the gesture's `gestureSeed`.
 */

import { distance, type Vec2 } from "../geom";
import { hitTest } from "../canvas/hitTest";
import {
  barPathSites,
  bezierControls,
  bulgeThrough,
  convertEdge,
  edgeAt,
  edgeMidpoint,
  remapEdges,
  siteWorldPosition,
  splitEdge,
  worldToLinkLocal,
  type Edge,
  type Id,
  type Link,
  type MechanismDocument,
  type Vec2Tuple,
} from "../model";
import type { DynamicInputState } from "./dynamicInput";
import type {
  EdgeMenu,
  HintMessage,
  PreviewShape,
  ToolContext,
  ToolEffect,
  ToolEvent,
  ToolHandle,
  ToolMachine,
  ToolReduceResult,
} from "./types";

/** A plate outline needs at least this many vertices. */
const MIN_VERTICES = 3;

/** The edge types the floating toolbar offers. */
export type EdgeKind = Edge["kind"];

/** The commands the edge toolbar sends (as `{ type: "command" }` events). */
export type EdgeCommand = `edge:${EdgeKind}` | "edge:split";

type Picked = { kind: "vertex"; index: number } | { kind: "edge"; index: number };

export type VertexToolState =
  | { phase: "idle"; linkId: Id | null; picked: Picked | null }
  /** Pressed a straight edge's midpoint; what a drag does is decided once it moves. */
  | {
      phase: "pressEdge";
      linkId: Id;
      index: number;
      start: Vec2;
      shift: boolean;
      gestureId: string;
    }
  | { phase: "dragVertex"; linkId: Id; index: number; gestureId: string }
  | {
      phase: "dragBulge";
      linkId: Id;
      index: number;
      start: Vec2;
      moved: boolean;
      gestureId: string;
    }
  | {
      phase: "dragControl";
      linkId: Id;
      index: number;
      end: "out" | "in";
      start: Vec2;
      moved: boolean;
      gestureId: string;
    };

type PointerToolEvent = Extract<ToolEvent, { world: Vec2 }>;

/**
 * The shape being edited, as one vertex list with one edge per gap: a
 * plate's outline (closed, vertices movable) or a bar's path sites (open,
 * vertices fixed -- they are the bar's sites).
 */
interface EditableShape {
  link: Link;
  closed: boolean;
  vertices: Vec2Tuple[];
  edges: Edge[];
}

function editableShape(link: Link | undefined): EditableShape | null {
  if (!link) return null;
  if (link.shape.kind === "plate") {
    const vertices = link.shape.outline;
    const edges = vertices.map((_, i) => edgeAt(link.shape.edges, i));
    return { link, closed: true, vertices, edges };
  }
  const vertices = barPathSites(link).map((site) => site.local);
  if (vertices.length < 2) return null;
  const edges = vertices.slice(1).map((_, i) => edgeAt(link.shape.edges, i));
  return { link, closed: false, vertices, edges };
}

function edgeEnds(shape: EditableShape, i: number): [Vec2Tuple, Vec2Tuple] {
  return [shape.vertices[i], shape.vertices[(i + 1) % shape.vertices.length]];
}

/**
 * The link being edited: the tool's own pick, or else a lone selected
 * link (so a link selected in Build is ready to edit on entering Draw).
 */
function currentShape(
  state: VertexToolState,
  doc: MechanismDocument,
  selection: ReadonlySet<Id>,
): EditableShape | null {
  const id = state.linkId ?? (selection.size === 1 ? [...selection][0] : null);
  if (id === null) return null;
  return editableShape(doc.links.find((l) => l.id === id));
}

/** What is selected, if it still exists in `shape` (undo can shorten it). */
function currentPicked(state: VertexToolState, shape: EditableShape): Picked | null {
  const picked = state.phase === "idle" ? state.picked : null;
  if (!picked) return null;
  const count =
    picked.kind === "vertex" ? (shape.closed ? shape.vertices.length : 0) : shape.edges.length;
  return picked.index < count ? picked : null;
}

/** The effect that stores `vertices`/`edges` back on `shape`'s link (all-straight edges are omitted). */
function commit(
  shape: EditableShape,
  vertices: Vec2Tuple[],
  edges: Edge[],
  gestureId: string,
): ToolEffect {
  const stored = edges.some((e) => e.kind !== "line") ? edges : undefined;
  return shape.closed
    ? {
        kind: "setPlateOutline",
        linkId: shape.link.id,
        outline: vertices,
        edges: stored,
        gestureId,
      }
    : { kind: "setBarEdges", linkId: shape.link.id, edges: stored, gestureId };
}

function world(shape: EditableShape, local: Vec2Tuple): Vec2 {
  return siteWorldPosition(shape.link, local);
}

function local(shape: EditableShape, p: Vec2): Vec2Tuple {
  return worldToLinkLocal(shape.link.pose, p);
}

type HandleHit =
  | { kind: "vertex" | "midpoint" | "bulge"; index: number }
  | { kind: "control"; index: number; end: "out" | "in" };

/** Every handle of `shape`, in pick priority order (vertices first). */
function shapeHandles(shape: EditableShape): (HandleHit & { at: Vec2; from?: Vec2 })[] {
  const out: (HandleHit & { at: Vec2; from?: Vec2 })[] = [];
  if (shape.closed) {
    shape.vertices.forEach((v, index) => out.push({ kind: "vertex", index, at: world(shape, v) }));
  }
  shape.edges.forEach((edge, index) => {
    if (edge.kind !== "bezier") return;
    const [a, b] = edgeEnds(shape, index);
    const [c1, c2] = bezierControls(a, b, edge);
    out.push({ kind: "control", index, end: "out", at: world(shape, c1), from: world(shape, a) });
    out.push({ kind: "control", index, end: "in", at: world(shape, c2), from: world(shape, b) });
  });
  shape.edges.forEach((edge, index) => {
    if (edge.kind === "bezier") return;
    const [a, b] = edgeEnds(shape, index);
    out.push({
      kind: edge.kind === "arc" ? "bulge" : "midpoint",
      index,
      at: world(shape, edgeMidpoint(a, b, edge)),
    });
  });
  return out;
}

/** The handle under `p`: the nearest within `radius`, earlier kinds winning ties. */
function pickHandle(shape: EditableShape, p: Vec2, radius: number): HandleHit | null {
  let best: HandleHit | null = null;
  let bestDist = radius;
  for (const handle of shapeHandles(shape)) {
    const dist = distance(p, handle.at);
    if (dist < bestDist || (best === null && dist <= bestDist)) {
      best =
        handle.kind === "control"
          ? { kind: "control", index: handle.index, end: handle.end }
          : { kind: handle.kind, index: handle.index };
      bestDist = dist;
    }
  }
  return best;
}

/**
 * Where a dragged handle goes. A midpoint snap on the link being edited is
 * ignored: its edges move with the cursor, and following one of their
 * midpoints would make the handle creep.
 */
function dragPoint(event: PointerToolEvent, linkId: Id): Vec2 {
  const { snap } = event;
  return snap.kind === "midpoint" && snap.linkId === linkId ? event.world : snap.point;
}

function withEdge(edges: Edge[], index: number, edge: Edge): Edge[] {
  return edges.map((e, i) => (i === index ? edge : e));
}

const IDLE: VertexToolState = { phase: "idle", linkId: null, picked: null };

function idle(linkId: Id, picked: Picked | null): VertexToolState {
  return { phase: "idle", linkId, picked };
}

const NOTHING = <S>(state: S, handled = false): ToolReduceResult<S> => ({
  state,
  effects: [],
  handled,
});

function reducePointerDown(
  state: VertexToolState,
  event: PointerToolEvent,
  ctx: ToolContext,
): ToolReduceResult<VertexToolState> {
  const shape = currentShape(state, ctx.doc, ctx.selection);
  const handle = shape ? pickHandle(shape, event.world, ctx.radiusWorld) : null;
  if (shape && handle) {
    const linkId = shape.link.id;
    const gestureId = ctx.gestureSeed;
    const start = event.world;
    switch (handle.kind) {
      case "vertex":
        return NOTHING({ phase: "dragVertex", linkId, index: handle.index, gestureId }, true);
      case "midpoint":
        return NOTHING(
          { phase: "pressEdge", linkId, index: handle.index, start, shift: event.shift, gestureId },
          true,
        );
      case "bulge":
        return NOTHING(
          { phase: "dragBulge", linkId, index: handle.index, start, moved: false, gestureId },
          true,
        );
      case "control":
        return NOTHING(
          {
            phase: "dragControl",
            linkId,
            index: handle.index,
            end: handle.end,
            start,
            moved: false,
            gestureId,
          },
          true,
        );
    }
  }

  const hit = hitTest(ctx.doc, event.world, ctx.radiusWorld);
  const linkId =
    hit.kind === "link" || hit.kind === "site" || hit.kind === "joint" ? hit.linkId : null;
  const picked = linkId === null ? null : editableShape(ctx.doc.links.find((l) => l.id === linkId));
  if (picked && !picked.link.isGround) {
    return {
      state: idle(picked.link.id, null),
      effects: [{ kind: "select", ids: [picked.link.id], mode: "replace" }],
      handled: true,
    };
  }
  return { state: IDLE, effects: [{ kind: "clearSelection" }], handled: true };
}

function reducePointerMove(
  state: VertexToolState,
  event: PointerToolEvent,
  ctx: ToolContext,
): ToolReduceResult<VertexToolState> {
  if (state.phase === "idle") return NOTHING(state);
  const shape = editableShape(ctx.doc.links.find((l) => l.id === state.linkId));
  if (
    !shape ||
    state.index >= (state.phase === "dragVertex" ? shape.vertices.length : shape.edges.length)
  ) {
    return NOTHING(IDLE);
  }
  const p = local(shape, dragPoint(event, shape.link.id));
  const threshold = ctx.radiusWorld / 2;

  switch (state.phase) {
    case "pressEdge": {
      if (distance(event.world, state.start) <= threshold) return NOTHING(state, true);
      const [a, b] = edgeEnds(shape, state.index);
      if (shape.closed && !state.shift) {
        // Insert a vertex on this straight edge and drag it.
        const vertices = [...shape.vertices];
        vertices.splice(state.index + 1, 0, p);
        const edges = [...shape.edges];
        edges.splice(state.index, 1, { kind: "line" }, { kind: "line" });
        return {
          state: {
            phase: "dragVertex",
            linkId: state.linkId,
            index: state.index + 1,
            gestureId: state.gestureId,
          },
          effects: [commit(shape, vertices, edges, state.gestureId)],
          handled: true,
        };
      }
      const edges = withEdge(shape.edges, state.index, {
        kind: "arc",
        bulge: bulgeThrough(a, b, p),
      });
      return {
        state: { ...state, phase: "dragBulge", moved: true },
        effects: [commit(shape, shape.vertices, edges, state.gestureId)],
        handled: true,
      };
    }
    case "dragVertex": {
      const vertices = shape.vertices.map((v, i) => (i === state.index ? p : v));
      return {
        state,
        effects: [commit(shape, vertices, shape.edges, state.gestureId)],
        handled: true,
      };
    }
    case "dragBulge": {
      if (!state.moved && distance(event.world, state.start) <= threshold)
        return NOTHING(state, true);
      const [a, b] = edgeEnds(shape, state.index);
      const edges = withEdge(shape.edges, state.index, {
        kind: "arc",
        bulge: bulgeThrough(a, b, p),
      });
      return {
        state: { ...state, moved: true },
        effects: [commit(shape, shape.vertices, edges, state.gestureId)],
        handled: true,
      };
    }
    case "dragControl": {
      const edge = shape.edges[state.index];
      if (edge.kind !== "bezier") return NOTHING(IDLE);
      if (!state.moved && distance(event.world, state.start) <= threshold)
        return NOTHING(state, true);
      const [a, b] = edgeEnds(shape, state.index);
      const from = state.end === "out" ? a : b;
      const offset: Vec2Tuple = [p[0] - from[0], p[1] - from[1]];
      const edges = withEdge(shape.edges, state.index, { ...edge, [state.end]: offset });
      return {
        state: { ...state, moved: true },
        effects: [commit(shape, shape.vertices, edges, state.gestureId)],
        handled: true,
      };
    }
  }
}

function reducePointerUp(state: VertexToolState): ToolReduceResult<VertexToolState> {
  switch (state.phase) {
    case "idle":
      return NOTHING(state);
    case "dragVertex":
      return NOTHING(idle(state.linkId, { kind: "vertex", index: state.index }), true);
    default:
      // A press that never moved is a click: it selects the edge.
      return NOTHING(idle(state.linkId, { kind: "edge", index: state.index }), true);
  }
}

function reduceKey(
  state: VertexToolState,
  event: Extract<ToolEvent, { type: "key" }>,
  ctx: ToolContext,
): ToolReduceResult<VertexToolState> {
  const shape = currentShape(state, ctx.doc, ctx.selection);
  const picked = shape ? currentPicked(state, shape) : null;

  if (event.key === "Escape") {
    if (state.phase !== "idle") return NOTHING(idle(state.linkId, null), true);
    if (shape && picked) return NOTHING(idle(shape.link.id, null), true);
    if (shape) return { state: IDLE, effects: [{ kind: "clearSelection" }], handled: true };
    return NOTHING(state);
  }

  if ((event.key === "Delete" || event.key === "Backspace") && state.phase === "idle") {
    if (!shape || !picked) return NOTHING(state);
    // Its own coalesce key, so a delete never merges into the drag before it.
    const gestureId = `${ctx.gestureSeed}:delete:${picked.kind}:${picked.index}:${shape.vertices.length}`;
    if (picked.kind === "edge") {
      if (shape.edges[picked.index].kind === "line") return NOTHING(state);
      const edges = withEdge(shape.edges, picked.index, { kind: "line" });
      return { state, effects: [commit(shape, shape.vertices, edges, gestureId)], handled: true };
    }
    if (shape.vertices.length <= MIN_VERTICES) return NOTHING(state, true);
    const keep = shape.vertices.map((_, i) => i).filter((i) => i !== picked.index);
    const vertices = keep.map((i) => shape.vertices[i]);
    const edges = remapEdges(shape.edges, shape.vertices.length, keep, true);
    return {
      state: idle(shape.link.id, null),
      effects: [commit(shape, vertices, edges, gestureId)],
      handled: true,
    };
  }

  return NOTHING(state);
}

/** The edge toolbar's commands: change the selected edge's type, or split it (plates). */
function reduceCommand(
  state: VertexToolState,
  command: string,
  ctx: ToolContext,
): ToolReduceResult<VertexToolState> {
  const shape = currentShape(state, ctx.doc, ctx.selection);
  const picked = shape ? currentPicked(state, shape) : null;
  if (!shape || picked?.kind !== "edge") return NOTHING(state);
  const i = picked.index;
  const [a, b] = edgeEnds(shape, i);
  const gestureId = `${ctx.gestureSeed}:${command}:${i}:${shape.vertices.length}`;

  if (command === "edge:split") {
    if (!shape.closed) return NOTHING(state);
    const { mid, first, second } = splitEdge(a, b, shape.edges[i]);
    const vertices = [...shape.vertices];
    vertices.splice(i + 1, 0, mid);
    const edges = [...shape.edges];
    edges.splice(i, 1, first, second);
    return {
      state: idle(shape.link.id, { kind: "vertex", index: i + 1 }),
      effects: [commit(shape, vertices, edges, gestureId)],
      handled: true,
    };
  }

  const kind = command.slice("edge:".length);
  if (kind !== "line" && kind !== "arc" && kind !== "bezier") return NOTHING(state);
  if (shape.edges[i].kind === kind) return NOTHING(state, true);
  const edges = withEdge(shape.edges, i, convertEdge(a, b, shape.edges[i], kind));
  return { state, effects: [commit(shape, shape.vertices, edges, gestureId)], handled: true };
}

function reduce(
  state: VertexToolState,
  event: ToolEvent,
  ctx: ToolContext,
): ToolReduceResult<VertexToolState> {
  switch (event.type) {
    case "cancel":
      return state.phase === "idle" ? NOTHING(state) : NOTHING(idle(state.linkId, null), true);
    case "key":
      return reduceKey(state, event, ctx);
    case "command":
      return reduceCommand(state, event.command, ctx);
    case "pointerdown":
      return event.button === 0 ? reducePointerDown(state, event, ctx) : NOTHING(state);
    case "pointermove":
      return reducePointerMove(state, event, ctx);
    case "pointerup":
      return reducePointerUp(state);
    default:
      return NOTHING(state);
  }
}

function handles(state: VertexToolState, ctx: ToolContext): ToolHandle[] {
  const shape = currentShape(state, ctx.doc, ctx.selection);
  if (!shape) return [];
  const picked = currentPicked(state, shape);
  const isActive = (h: HandleHit): boolean =>
    picked !== null &&
    h.index === picked.index &&
    (picked.kind === "vertex" ? h.kind === "vertex" : h.kind !== "vertex");
  // Drawn bottom-up: edge handles under vertex squares.
  return shapeHandles(shape)
    .reverse()
    .map((h) => ({
      kind: h.kind,
      at: h.at,
      ...(h.from ? { from: h.from } : {}),
      ...(isActive(h) ? { active: true } : {}),
    }));
}

function edgeMenu(state: VertexToolState, ctx: ToolContext): EdgeMenu | undefined {
  const shape = currentShape(state, ctx.doc, ctx.selection);
  const picked = shape ? currentPicked(state, shape) : null;
  if (!shape || picked?.kind !== "edge") return undefined;
  const [a, b] = edgeEnds(shape, picked.index);
  const edge = shape.edges[picked.index];
  return { at: world(shape, edgeMidpoint(a, b, edge)), kind: edge.kind, canSplit: shape.closed };
}

function hint(state: VertexToolState, ctx: ToolContext): HintMessage {
  switch (state.phase) {
    case "dragVertex":
      return { key: "tools.vertex.hint.dragging" };
    case "pressEdge":
    case "dragBulge":
    case "dragControl":
      return { key: "tools.vertex.hint.bending" };
    case "idle":
      break;
  }
  const shape = currentShape(state, ctx.doc, ctx.selection);
  if (!shape) return { key: "tools.vertex.hint.idle" };
  const picked = currentPicked(state, shape);
  if (picked?.kind === "edge") return { key: "tools.vertex.hint.edgeSelected" };
  if (picked?.kind === "vertex") {
    return shape.vertices.length > MIN_VERTICES
      ? { key: "tools.vertex.hint.vertexSelected" }
      : { key: "tools.vertex.hint.minVertices" };
  }
  return {
    key: shape.closed ? "tools.vertex.hint.plateSelected" : "tools.vertex.hint.barSelected",
  };
}

export const vertexTool: ToolMachine<VertexToolState> = {
  id: "vertex",
  initial: () => IDLE,
  reduce,
  isBusy: (state) => state.phase !== "idle",
  hint,
  preview: (): PreviewShape[] => [],
  snapAnchor: () => undefined,
  dynamicInput: (): DynamicInputState | undefined => undefined,
  handles,
  edgeMenu,
};
