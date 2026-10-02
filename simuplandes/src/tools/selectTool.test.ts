import { describe, expect, it } from "vitest";
import {
  MechanismDocumentSchema,
  jointClusterSiteIds,
  siteWorldPosition,
  type MechanismDocument,
} from "../model";
import { distance } from "../geom";
import { createMechanismStore } from "../store";
import { buildExampleFourBar } from "../store/examples";
import { applyToolEffects } from "./effects";
import { selectTool, type SelectToolState } from "./selectTool";
import { expectHintLocalized } from "./machines.test";
import type { ToolContext, ToolEvent } from "./types";
import type { SnapResult } from "../canvas/snapping";

/** Overridable fields for the `down`/`move`/`up` pointer-event builders below
 * (deliberately NOT `Partial<ToolEvent>`: that would let a caller's `opts`
 * smuggle in an unrelated union member's fields, e.g. a `"key"` event's
 * `key` field, past the type checker). */
interface PointerOverrides {
  shift?: boolean;
  mod?: boolean;
  alt?: boolean;
  button?: number;
  snap?: SnapResult;
}

function emptyDoc(): MechanismDocument {
  return MechanismDocumentSchema.parse({ schemaVersion: 1 });
}

const TWO_LINKS_DOC: MechanismDocument = MechanismDocumentSchema.parse({
  schemaVersion: 1,
  links: [
    {
      id: "link-crank",
      name: "Crank",
      isGround: false,
      pose: { position: [0, 0], angle: 0 },
      shape: { kind: "bar" },
      sites: [
        { id: "site-o2", local: [0, 0] },
        { id: "site-a", local: [40, 0] },
      ],
    },
    {
      id: "link-ground",
      name: "Ground",
      isGround: true,
      pose: { position: [0, 0], angle: 0 },
      shape: { kind: "bar" },
      sites: [{ id: "site-g", local: [0, 0] }],
    },
  ],
  joints: [{ id: "joint-o2", type: "R", siteA: "site-o2", siteB: "site-g" }],
});

/** Like `TWO_LINKS_DOC`, but with a marker far from every other click point used below. */
const MARKER_DOC: MechanismDocument = MechanismDocumentSchema.parse({
  ...TWO_LINKS_DOC,
  markers: [{ id: "marker-1", linkId: "link-crank", local: [500, 500] }],
});

function ctxFor(
  doc: MechanismDocument,
  overrides: Partial<ToolContext> = {},
  radiusWorld = 8,
): ToolContext {
  return {
    doc,
    selection: new Set(),
    radiusWorld,
    gestureSeed: "gesture-1",
    ...overrides,
  };
}

function down(world: { x: number; y: number }, opts: PointerOverrides = {}): ToolEvent {
  return {
    type: "pointerdown",
    world,
    snap: { kind: "none", point: world },
    button: 0,
    shift: false,
    mod: false,
    alt: false,
    ...opts,
  };
}

function move(world: { x: number; y: number }, opts: PointerOverrides = {}): ToolEvent {
  return {
    type: "pointermove",
    world,
    snap: { kind: "none", point: world },
    button: -1,
    shift: false,
    mod: false,
    alt: false,
    ...opts,
  };
}

function up(world: { x: number; y: number }, opts: PointerOverrides = {}): ToolEvent {
  return {
    type: "pointerup",
    world,
    snap: { kind: "none", point: world },
    button: 0,
    shift: false,
    mod: false,
    alt: false,
    ...opts,
  };
}

describe("selectTool: click select", () => {
  it("click on the crank body (no movement) selects it (replace)", () => {
    const ctx = ctxFor(TWO_LINKS_DOC);
    let state = selectTool.initial();
    let result = selectTool.reduce(state, down({ x: 20, y: 0 }), ctx);
    state = result.state;
    result = selectTool.reduce(state, up({ x: 20, y: 0 }), ctx);
    expect(result.effects).toEqual([{ kind: "select", ids: ["link-crank"], mode: "replace" }]);
    expect(result.state).toEqual({ phase: "idle" });
    expect(result.handled).toBe(true);
  });

  it("shift+click on the crank body toggles it", () => {
    const ctx = ctxFor(TWO_LINKS_DOC);
    let result = selectTool.reduce(
      selectTool.initial(),
      down({ x: 20, y: 0 }, { shift: true }),
      ctx,
    );
    result = selectTool.reduce(result.state, up({ x: 20, y: 0 }, { shift: true }), ctx);
    expect(result.effects).toEqual([{ kind: "select", ids: ["link-crank"], mode: "toggle" }]);
  });

  it("click on empty space clears the selection", () => {
    const ctx = ctxFor(TWO_LINKS_DOC);
    let result = selectTool.reduce(selectTool.initial(), down({ x: 500, y: 500 }), ctx);
    result = selectTool.reduce(result.state, up({ x: 500, y: 500 }), ctx);
    expect(result.effects).toEqual([{ kind: "clearSelection" }]);
  });

  it("shift+click on empty space does nothing", () => {
    const ctx = ctxFor(TWO_LINKS_DOC);
    let result = selectTool.reduce(
      selectTool.initial(),
      down({ x: 500, y: 500 }, { shift: true }),
      ctx,
    );
    result = selectTool.reduce(result.state, up({ x: 500, y: 500 }, { shift: true }), ctx);
    expect(result.effects).toEqual([]);
    expect(result.handled).toBe(true);
  });

  it("click on joint O2 selects the joint id", () => {
    const ctx = ctxFor(TWO_LINKS_DOC);
    let result = selectTool.reduce(selectTool.initial(), down({ x: 0, y: 0 }), ctx);
    result = selectTool.reduce(result.state, up({ x: 0, y: 0 }), ctx);
    expect(result.effects).toEqual([{ kind: "select", ids: ["joint-o2"], mode: "replace" }]);
  });

  it("click on a free site selects the site id", () => {
    const doc = MechanismDocumentSchema.parse({
      schemaVersion: 1,
      links: [
        {
          id: "link-a",
          name: "A",
          isGround: false,
          pose: { position: [0, 0], angle: 0 },
          shape: { kind: "bar" },
          sites: [{ id: "site-free", local: [0, 0] }],
        },
      ],
    });
    const ctx = ctxFor(doc);
    let result = selectTool.reduce(selectTool.initial(), down({ x: 0, y: 0 }), ctx);
    result = selectTool.reduce(result.state, up({ x: 0, y: 0 }), ctx);
    expect(result.effects).toEqual([{ kind: "select", ids: ["site-free"], mode: "replace" }]);
  });

  it("click on a marker selects the marker id", () => {
    const ctx = ctxFor(MARKER_DOC);
    let result = selectTool.reduce(selectTool.initial(), down({ x: 500, y: 500 }), ctx);
    result = selectTool.reduce(result.state, up({ x: 500, y: 500 }), ctx);
    expect(result.effects).toEqual([{ kind: "select", ids: ["marker-1"], mode: "replace" }]);
  });
});

describe("selectTool: box select", () => {
  it("down on empty space + move beyond the threshold enters boxing with a live rect preview", () => {
    const ctx = ctxFor(emptyDoc());
    let result = selectTool.reduce(selectTool.initial(), down({ x: 0, y: 0 }), ctx);
    result = selectTool.reduce(result.state, move({ x: 100, y: 100 }), ctx);
    expect(result.state).toEqual({
      phase: "boxing",
      start: { x: 0, y: 0 },
      current: { x: 100, y: 100 },
      shift: false,
    });
    expect(selectTool.preview(result.state)).toEqual([
      { kind: "rect", min: { x: 0, y: 0 }, max: { x: 100, y: 100 } },
    ]);
    expect(selectTool.isBusy(result.state)).toBe(true);
  });

  it("a tiny move under the threshold stays a pending click (no boxing yet)", () => {
    const ctx = ctxFor(emptyDoc(), {}, 8);
    let result = selectTool.reduce(selectTool.initial(), down({ x: 0, y: 0 }), ctx);
    result = selectTool.reduce(result.state, move({ x: 1, y: 0 }), ctx); // threshold = radiusWorld/2 = 4
    expect(result.state.phase).toBe("pressing");
  });

  it("releasing a box selects entitiesInBox, replace (or add with shift)", () => {
    // The box also encloses `site-o2` (the crank's own pivot site, shared
    // with `joint-o2`), so the joint is fair game too -- `entitiesInBox`
    // includes a joint whenever either of its sites falls inside the box.
    const ctx = ctxFor(TWO_LINKS_DOC);
    let result = selectTool.reduce(selectTool.initial(), down({ x: -10, y: -10 }), ctx);
    result = selectTool.reduce(result.state, move({ x: 50, y: 10 }), ctx);
    result = selectTool.reduce(result.state, up({ x: 50, y: 10 }), ctx);
    expect(result.effects).toEqual([
      { kind: "select", ids: ["link-crank", "joint-o2"], mode: "replace" },
    ]);
    expect(result.state).toEqual({ phase: "idle" });
  });

  it("shift+box-select uses mode add", () => {
    const ctx = ctxFor(TWO_LINKS_DOC);
    let result = selectTool.reduce(
      selectTool.initial(),
      down({ x: -10, y: -10 }, { shift: true }),
      ctx,
    );
    result = selectTool.reduce(result.state, move({ x: 50, y: 10 }, { shift: true }), ctx);
    result = selectTool.reduce(result.state, up({ x: 50, y: 10 }, { shift: true }), ctx);
    expect(result.effects).toEqual([
      { kind: "select", ids: ["link-crank", "joint-o2"], mode: "add" },
    ]);
  });
});

describe("selectTool: live move drag", () => {
  it("down on an unselected link + move selects it then moves it, incremental deltas share one gestureId", () => {
    const ctx = ctxFor(TWO_LINKS_DOC, { gestureSeed: "drag-1" });
    let result = selectTool.reduce(selectTool.initial(), down({ x: 20, y: 0 }), ctx);
    result = selectTool.reduce(result.state, move({ x: 30, y: 0 }), ctx);
    expect(result.effects).toEqual([
      { kind: "select", ids: ["link-crank"], mode: "replace" },
      {
        kind: "moveEntities",
        ids: ["link-crank"],
        delta: { x: 10, y: 0 },
        gestureId: "drag-1",
        label: "move-selection",
      },
    ]);
    expect(result.state).toMatchObject({ phase: "moving", gestureId: "drag-1" });

    // A second move: incremental delta from the new `last`, same gestureId, no re-select.
    result = selectTool.reduce(result.state, move({ x: 35, y: 0 }), ctx);
    expect(result.effects).toEqual([
      {
        kind: "moveEntities",
        ids: ["link-crank"],
        delta: { x: 5, y: 0 },
        gestureId: "drag-1",
        label: "move-selection",
      },
    ]);
  });

  it("down on an ALREADY-selected link + move does not re-emit a select effect", () => {
    const ctx = ctxFor(TWO_LINKS_DOC, { selection: new Set(["link-crank"]) });
    let result = selectTool.reduce(selectTool.initial(), down({ x: 20, y: 0 }), ctx);
    result = selectTool.reduce(result.state, move({ x: 30, y: 0 }), ctx);
    expect(result.effects).toEqual([
      {
        kind: "moveEntities",
        ids: ["link-crank"],
        delta: { x: 10, y: 0 },
        gestureId: "gesture-1",
        label: "move-selection",
      },
    ]);
  });

  it("pointerup ends the move gesture with no further effects", () => {
    const ctx = ctxFor(TWO_LINKS_DOC);
    let result = selectTool.reduce(selectTool.initial(), down({ x: 20, y: 0 }), ctx);
    result = selectTool.reduce(result.state, move({ x: 30, y: 0 }), ctx);
    result = selectTool.reduce(result.state, up({ x: 30, y: 0 }), ctx);
    expect(result.state).toEqual({ phase: "idle" });
    expect(result.effects).toEqual([]);
  });
});

describe("selectTool: live joint drag", () => {
  it("down on joint O2 + move drags the R-joint cluster with a snapped delta", () => {
    const ctx = ctxFor(TWO_LINKS_DOC, { gestureSeed: "joint-drag-1" });
    let result = selectTool.reduce(selectTool.initial(), down({ x: 0, y: 0 }), ctx);
    expect(result.state).toMatchObject({
      phase: "pressing",
      jointClusterIds: new Set(["site-o2", "site-g"]),
    });

    result = selectTool.reduce(
      result.state,
      move({ x: 5, y: 0 }, { snap: { kind: "grid", point: { x: 5, y: 0 } } }),
      ctx,
    );
    expect(result.effects).toEqual([
      {
        kind: "moveEntities",
        ids: ["site-o2", "site-g"],
        delta: { x: 5, y: 0 },
        gestureId: "joint-drag-1",
        label: "move-joint",
      },
    ]);
    expect(result.state).toMatchObject({ phase: "draggingJoint", gestureId: "joint-drag-1" });

    // The next move uses the SNAPPED point as `last`, not the raw world point.
    result = selectTool.reduce(
      result.state,
      move({ x: 8, y: 0 }, { snap: { kind: "grid", point: { x: 10, y: 0 } } }),
      ctx,
    );
    expect(result.effects).toEqual([
      {
        kind: "moveEntities",
        ids: ["site-o2", "site-g"],
        delta: { x: 5, y: 0 },
        gestureId: "joint-drag-1",
        label: "move-joint",
      },
    ]);
  });

  it("snapExclude returns the cluster's own sites while pressing on a joint and while dragging it", () => {
    const ctx = ctxFor(TWO_LINKS_DOC);
    const cluster = jointClusterSiteIds(TWO_LINKS_DOC, "site-o2");
    let result = selectTool.reduce(selectTool.initial(), down({ x: 0, y: 0 }), ctx);
    expect(selectTool.snapExclude?.(result.state)).toEqual(cluster);

    result = selectTool.reduce(result.state, move({ x: 5, y: 0 }), ctx);
    expect(result.state.phase).toBe("draggingJoint");
    expect(selectTool.snapExclude?.(result.state)).toEqual(cluster);
  });

  it("snapExclude is undefined when idle or pressing on something other than a joint", () => {
    expect(selectTool.snapExclude?.(selectTool.initial())).toBeUndefined();
    const ctx = ctxFor(TWO_LINKS_DOC);
    const result = selectTool.reduce(selectTool.initial(), down({ x: 20, y: 0 }), ctx);
    expect(selectTool.snapExclude?.(result.state)).toBeUndefined();
  });
});

describe("selectTool: keyboard", () => {
  it("Delete with a non-empty selection emits deleteSelection, handled", () => {
    const ctx = ctxFor(TWO_LINKS_DOC, { selection: new Set(["link-crank"]) });
    const result = selectTool.reduce(
      selectTool.initial(),
      { type: "key", key: "Delete", shift: false, mod: false, alt: false },
      ctx,
    );
    expect(result.effects).toEqual([{ kind: "deleteSelection" }]);
    expect(result.handled).toBe(true);
  });

  it("Backspace with an empty selection is unhandled, no effect", () => {
    const ctx = ctxFor(TWO_LINKS_DOC);
    const result = selectTool.reduce(
      selectTool.initial(),
      { type: "key", key: "Backspace", shift: false, mod: false, alt: false },
      ctx,
    );
    expect(result.effects).toEqual([]);
    expect(result.handled).toBe(false);
  });

  it("mod+d emits duplicateSelection with a fixed offset, handled", () => {
    const ctx = ctxFor(TWO_LINKS_DOC, { selection: new Set(["link-crank"]) });
    const result = selectTool.reduce(
      selectTool.initial(),
      { type: "key", key: "d", shift: false, mod: true, alt: false },
      ctx,
    );
    expect(result.effects).toHaveLength(1);
    expect(result.effects[0].kind).toBe("duplicateSelection");
    expect(result.handled).toBe(true);
  });

  it("mod+a selects every non-ground link", () => {
    const ctx = ctxFor(TWO_LINKS_DOC);
    const result = selectTool.reduce(
      selectTool.initial(),
      { type: "key", key: "a", shift: false, mod: true, alt: false },
      ctx,
    );
    expect(result.effects).toEqual([{ kind: "select", ids: ["link-crank"], mode: "replace" }]);
  });

  it("Escape while idle with a selection clears it", () => {
    const ctx = ctxFor(TWO_LINKS_DOC, { selection: new Set(["link-crank"]) });
    const result = selectTool.reduce(
      selectTool.initial(),
      { type: "key", key: "Escape", shift: false, mod: false, alt: false },
      ctx,
    );
    expect(result.effects).toEqual([{ kind: "clearSelection" }]);
    expect(result.handled).toBe(true);
  });

  it("Escape while idle with no selection is unhandled", () => {
    const ctx = ctxFor(TWO_LINKS_DOC);
    const result = selectTool.reduce(
      selectTool.initial(),
      { type: "key", key: "Escape", shift: false, mod: false, alt: false },
      ctx,
    );
    expect(result.effects).toEqual([]);
    expect(result.handled).toBe(false);
  });

  it("Escape mid-drag/box ends the gesture without further effects", () => {
    const ctx = ctxFor(TWO_LINKS_DOC);
    let result = selectTool.reduce(selectTool.initial(), down({ x: 20, y: 0 }), ctx);
    result = selectTool.reduce(result.state, move({ x: 30, y: 0 }), ctx);
    expect(result.state.phase).toBe("moving");
    result = selectTool.reduce(
      result.state,
      { type: "key", key: "Escape", shift: false, mod: false, alt: false },
      ctx,
    );
    expect(result.state).toEqual({ phase: "idle" });
    expect(result.effects).toEqual([]);
    expect(result.handled).toBe(true);
  });

  it("cancel event resets to idle", () => {
    const ctx = ctxFor(TWO_LINKS_DOC);
    let result = selectTool.reduce(selectTool.initial(), down({ x: 20, y: 0 }), ctx);
    result = selectTool.reduce(result.state, { type: "cancel" }, ctx);
    expect(result.state).toEqual({ phase: "idle" });
  });
});

describe("selectTool: hints", () => {
  it("idle/boxing/movingSelection/draggingJoint each have a localized hint", () => {
    const ctx = ctxFor(TWO_LINKS_DOC);
    const idle: SelectToolState = { phase: "idle" };
    expectHintLocalized(selectTool.hint(idle, ctx));

    const boxing: SelectToolState = {
      phase: "boxing",
      start: { x: 0, y: 0 },
      current: { x: 1, y: 1 },
      shift: false,
    };
    expectHintLocalized(selectTool.hint(boxing, ctx));

    const moving: SelectToolState = {
      phase: "moving",
      ids: ["a"],
      last: { x: 0, y: 0 },
      gestureId: "g",
    };
    expectHintLocalized(selectTool.hint(moving, ctx));

    const draggingJoint: SelectToolState = {
      phase: "draggingJoint",
      siteIds: ["a"],
      last: { x: 1.5, y: 2.5 },
      gestureId: "g",
    };
    const hint = selectTool.hint(draggingJoint, ctx);
    expectHintLocalized(hint);
    expect(hint.values).toEqual({ x: 1.5, y: 2.5 });
  });
});

describe("selectTool: misc", () => {
  it("right-click at idle is a no-op", () => {
    const ctx = ctxFor(TWO_LINKS_DOC);
    const result = selectTool.reduce(
      selectTool.initial(),
      down({ x: 0, y: 0 }, { button: 2 }),
      ctx,
    );
    expect(result.effects).toEqual([]);
    expect(result.handled).toBe(false);
  });

  it("dynamicInput is always undefined; isBusy is false at idle/pressing", () => {
    expect(selectTool.dynamicInput(selectTool.initial())).toBeUndefined();
    expect(selectTool.isBusy(selectTool.initial())).toBe(false);
    const ctx = ctxFor(TWO_LINKS_DOC);
    const pressing = selectTool.reduce(selectTool.initial(), down({ x: 20, y: 0 }), ctx).state;
    expect(selectTool.isBusy(pressing)).toBe(false);
  });

  it("a committed event is a no-op", () => {
    const ctx = ctxFor(TWO_LINKS_DOC);
    const result = selectTool.reduce(
      selectTool.initial(),
      { type: "committed", siteIds: [], createdIds: [] },
      ctx,
    );
    expect(result.effects).toEqual([]);
    expect(result.handled).toBe(false);
  });
});

const DEFAULT_NAMES = {
  bar: "Barra",
  plate: "Placa",
  ground: "Bancada",
  slider: "Corredera",
  marker: "Punto",
};

describe("selectTool: integration with a real store", () => {
  it("a multi-move link drag is exactly ONE undo step; undo restores the pre-drag document", () => {
    const store = createMechanismStore({ validate: true });
    const link = store.getState().addLink({
      name: "A",
      shape: { kind: "bar" },
      sites: [{ local: [0, 0] }, { local: [40, 0] }],
    });
    const before = store.getState().document;

    const machine = selectTool;
    let state = machine.initial();
    const gestureSeed = "real-drag-1";
    const radiusWorld = 8;

    function ctx(): ToolContext {
      return {
        doc: store.getState().document,
        selection: store.getState().selection,
        radiusWorld,
        gestureSeed,
      };
    }

    const startPoint = { x: 20, y: 0 }; // on the bar's body, midway between its two sites
    let result = machine.reduce(state, down(startPoint), ctx());
    state = result.state;
    applyToolEffects(store, result.effects, { defaultNames: DEFAULT_NAMES });

    let lastWorld = startPoint;
    for (let i = 1; i <= 30; i++) {
      lastWorld = { x: startPoint.x + i, y: startPoint.y };
      result = machine.reduce(state, move(lastWorld), ctx());
      state = result.state;
      applyToolEffects(store, result.effects, { defaultNames: DEFAULT_NAMES });
    }
    result = machine.reduce(state, up(lastWorld), ctx());
    applyToolEffects(store, result.effects, { defaultNames: DEFAULT_NAMES });

    const moved = store.getState().document.links.find((l) => l.id === link.linkId);
    expect(moved?.pose.position).toEqual([30, 0]); // 20 + 30 (frames 1..30)

    expect(store.getState().canUndo).toBe(true);
    store.getState().undo();
    expect(store.getState().document).toEqual(before);
  });

  it("a joint drag keeps the cluster coincident and is exactly ONE undo step", () => {
    const store = createMechanismStore({ validate: true });
    const ids = buildExampleFourBar(store);
    const before = store.getState().document;

    const jointA = before.joints.find((j) => j.name === "A")!;
    const cluster = jointClusterSiteIds(before, jointA.siteA);
    const clusterSiteWorld = (doc: MechanismDocument, siteId: string): { x: number; y: number } => {
      const entry = doc.links
        .flatMap((l) => l.sites.map((s) => ({ site: s, link: l })))
        .find((e) => e.site.id === siteId)!;
      return siteWorldPosition(entry.link, entry.site.local);
    };
    const worldStart = clusterSiteWorld(before, jointA.siteA);

    const machine = selectTool;
    let state = machine.initial();
    const gestureSeed = "real-joint-drag-1";

    function ctx(): ToolContext {
      return {
        doc: store.getState().document,
        selection: store.getState().selection,
        radiusWorld: 8,
        gestureSeed,
      };
    }

    let result = machine.reduce(state, down(worldStart), ctx());
    state = result.state;
    expect(state).toMatchObject({ phase: "pressing", jointClusterIds: cluster });

    let lastWorld = worldStart;
    for (let i = 1; i <= 10; i++) {
      lastWorld = { x: worldStart.x + i, y: worldStart.y + i };
      result = machine.reduce(
        state,
        move(lastWorld, { snap: { kind: "none", point: lastWorld } }),
        ctx(),
      );
      state = result.state;
      applyToolEffects(store, result.effects, { defaultNames: DEFAULT_NAMES });

      const doc = store.getState().document;
      const worldPoints = Array.from(cluster).map((siteId) => clusterSiteWorld(doc, siteId));
      for (let j = 1; j < worldPoints.length; j++) {
        expect(distance(worldPoints[0], worldPoints[j])).toBeLessThan(1e-9);
      }
    }
    result = machine.reduce(state, up(lastWorld), ctx());
    applyToolEffects(store, result.effects, { defaultNames: DEFAULT_NAMES });

    expect(store.getState().canUndo).toBe(true);
    store.getState().undo();
    expect(store.getState().document).toEqual(before);
    void ids;
  });

  it("two consecutive drags produce two distinct history entries", () => {
    const store = createMechanismStore({ validate: true });
    store.getState().addLink({ name: "A", sites: [{ local: [0, 0] }, { local: [10, 0] }] });
    const machine = selectTool;
    const defaultNames = {
      bar: "Barra",
      plate: "Placa",
      ground: "Bancada",
      slider: "Corredera",
      marker: "Punto",
    };

    function drag(
      gestureSeed: string,
      from: { x: number; y: number },
      to: { x: number; y: number },
    ): void {
      function ctx(): ToolContext {
        return {
          doc: store.getState().document,
          selection: store.getState().selection,
          radiusWorld: 8,
          gestureSeed,
        };
      }
      let state = machine.initial();
      let result = machine.reduce(state, down(from), ctx());
      state = result.state;
      result = machine.reduce(state, move(to), ctx());
      state = result.state;
      applyToolEffects(store, result.effects, { defaultNames });
      result = machine.reduce(state, up(to), ctx());
      applyToolEffects(store, result.effects, { defaultNames });
    }

    drag("g-1", { x: 5, y: 0 }, { x: 20, y: 0 });
    drag("g-2", { x: 20, y: 0 }, { x: 40, y: 0 });

    let undoSteps = 0;
    while (store.getState().canUndo) {
      store.getState().undo();
      undoSteps += 1;
    }
    // 1 for addLink + 2 for the two distinct-gesture drags.
    expect(undoSteps).toBe(3);
  });
});
