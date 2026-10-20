import { describe, expect, it } from "vitest";
import {
  MechanismDocumentSchema,
  computedMassProperties,
  edgeMidpoint,
  type Edge,
  type LinkShape,
  type Vec2Tuple,
} from "../model";
import { createMechanismStore, type MechanismStore } from "../store";
import { applyToolEffects } from "./effects";
import { expectHintLocalized } from "./machines.test";
import { vertexTool, type VertexToolState } from "./vertexTool";
import type { ToolContext, ToolEvent } from "./types";

const NAMES = {
  bar: "Barra",
  plate: "Placa",
  ground: "Bancada",
  slider: "Corredera",
  marker: "Punto",
  spring: "Resorte",
};

/** A 100 x 100 square plate posed at (10, 0), with one site, beside a bar. */
function makeStore(): MechanismStore {
  const doc = MechanismDocumentSchema.parse({
    schemaVersion: 2,
    links: [
      {
        id: "plate",
        name: "Plate",
        isGround: false,
        pose: { position: [10, 0], angle: 0 },
        shape: {
          kind: "plate",
          outline: [
            [0, 0],
            [100, 0],
            [100, 100],
            [0, 100],
          ],
        },
        sites: [{ id: "p0", local: [50, 50] }],
      },
      {
        id: "bar",
        name: "Bar",
        isGround: false,
        pose: { position: [300, 0], angle: 0 },
        shape: { kind: "bar" },
        sites: [
          { id: "b0", local: [0, 0] },
          { id: "b1", local: [50, 0] },
        ],
      },
    ],
  });
  return createMechanismStore({ initialDocument: doc, validate: true });
}

type PointerType = "pointerdown" | "pointermove" | "pointerup";

function pointer(type: PointerType, x: number, y: number, shift = false): ToolEvent {
  const world = { x, y };
  return {
    type,
    world,
    snap: { kind: "none", point: world },
    button: 0,
    shift,
    mod: false,
    alt: false,
  };
}

function key(k: string): ToolEvent {
  return { type: "key", key: k, shift: false, mod: false, alt: false };
}

/** Drives the machine like the controller: a fresh gesture per pointerdown, effects applied to `store`. */
class Driver {
  state: VertexToolState = vertexTool.initial();
  private gesture = 0;
  constructor(readonly store: MechanismStore) {}

  ctx(): ToolContext {
    const { document, selection } = this.store.getState();
    return { doc: document, selection, radiusWorld: 4, gestureSeed: `g${this.gesture}` };
  }

  send(event: ToolEvent): boolean {
    if (event.type === "pointerdown") this.gesture += 1;
    const result = vertexTool.reduce(this.state, event, this.ctx());
    this.state = result.state;
    applyToolEffects(this.store, result.effects, { defaultNames: NAMES });
    return result.handled;
  }

  drag(from: [number, number], to: [number, number], shift = false): void {
    this.send(pointer("pointerdown", ...from, shift));
    this.send(pointer("pointermove", (from[0] + to[0]) / 2, (from[1] + to[1]) / 2));
    this.send(pointer("pointermove", ...to));
    this.send(pointer("pointerup", ...to));
  }

  click(at: [number, number]): void {
    this.send(pointer("pointerdown", ...at));
    this.send(pointer("pointerup", ...at));
  }

  command(command: string): boolean {
    return this.send({ type: "command", command });
  }

  shape(id = "plate"): LinkShape {
    return this.store.getState().document.links.find((l) => l.id === id)!.shape;
  }

  edges(id = "plate"): Edge[] | undefined {
    return this.shape(id).edges;
  }

  outline(): Vec2Tuple[] {
    const link = this.store.getState().document.links.find((l) => l.id === "plate")!;
    if (link.shape.kind !== "plate") throw new Error("not a plate");
    return link.shape.outline;
  }
}

describe("vertexTool", () => {
  it("a click on a plate picks and selects it, and shows vertex + midpoint handles", () => {
    const d = new Driver(makeStore());
    expect(vertexTool.handles!(d.state, d.ctx())).toEqual([]);
    d.send(pointer("pointerdown", 40, 40));
    expect([...d.store.getState().selection]).toEqual(["plate"]);
    const handles = vertexTool.handles!(d.state, d.ctx());
    // Drawn bottom-up (vertex squares last, on top), so read them reversed.
    expect(
      handles
        .filter((h) => h.kind === "vertex")
        .map((h) => h.at)
        .reverse(),
    ).toEqual([
      { x: 10, y: 0 },
      { x: 110, y: 0 },
      { x: 110, y: 100 },
      { x: 10, y: 100 },
    ]);
    expect(handles.filter((h) => h.kind === "midpoint")).toHaveLength(4);
    expectHintLocalized(vertexTool.hint(d.state, d.ctx()));
  });

  it("dragging a vertex moves it (link-local) as ONE undo step, leaving sites alone", () => {
    const store = makeStore();
    const before = store.getState().document;
    const d = new Driver(store);
    d.send(pointer("pointerdown", 40, 40));
    d.drag([110, 100], [130, 120]);
    expect(d.outline()[2]).toEqual([120, 120]);
    expect(store.getState().document.links[0].sites).toEqual(before.links[0].sites);
    expect(vertexTool.isBusy(d.state)).toBe(false);

    store.getState().undo();
    expect(store.getState().document).toEqual(before);
  });

  it("dragging an edge midpoint inserts a vertex there in one undo step", () => {
    const store = makeStore();
    const d = new Driver(store);
    d.send(pointer("pointerdown", 40, 40));
    d.drag([60, 0], [60, -30]);
    expect(d.outline()).toEqual([
      [0, 0],
      [50, -30],
      [100, 0],
      [100, 100],
      [0, 100],
    ]);
    store.getState().undo();
    expect(d.outline()).toHaveLength(4);
    expect(store.getState().canUndo).toBe(false);
  });

  it("Delete removes the selected vertex, but never below 3", () => {
    const store = makeStore();
    const d = new Driver(store);
    d.send(pointer("pointerdown", 40, 40));
    d.send(pointer("pointerdown", 110, 100));
    d.send(pointer("pointerup", 110, 100));
    expect(d.send(key("Delete"))).toBe(true);
    expect(d.outline()).toEqual([
      [0, 0],
      [100, 0],
      [0, 100],
    ]);
    // Mass properties follow the new outline (a right triangle, not the square).
    const { com } = computedMassProperties(
      store.getState().document.links[0],
      store.getState().document,
    );
    expect(com[0]).toBeCloseTo(100 / 3);
    expect(com[1]).toBeCloseTo(100 / 3);

    d.send(pointer("pointerdown", 10, 0));
    d.send(pointer("pointerup", 10, 0));
    expect(d.send(key("Backspace"))).toBe(true);
    expect(d.outline()).toHaveLength(3);
    expectHintLocalized(vertexTool.hint(d.state, d.ctx()));
    expect(vertexTool.hint(d.state, d.ctx()).key).toBe("tools.vertex.hint.minVertices");
  });

  it("two deletes are two undo steps", () => {
    const store = makeStore();
    const d = new Driver(store);
    d.send(pointer("pointerdown", 40, 40));
    // Add a 5th vertex, then delete two vertices with no click in between selecting each.
    d.drag([60, 0], [60, -30]);
    d.send(key("Delete")); // removes the inserted vertex (still selected)
    d.send(pointer("pointerdown", 10, 0));
    d.send(pointer("pointerup", 10, 0));
    d.send(key("Delete"));
    expect(d.outline()).toHaveLength(3);
    store.getState().undo();
    expect(d.outline()).toHaveLength(4);
  });

  it("clears on empty space, and Escape steps back", () => {
    const d = new Driver(makeStore());
    d.send(pointer("pointerdown", 40, 40));
    d.send(pointer("pointerdown", 10, 0));
    d.send(pointer("pointerup", 10, 0));
    expect(vertexTool.handles!(d.state, d.ctx()).some((h) => h.active)).toBe(true);
    d.send(key("Escape"));
    expect(vertexTool.handles!(d.state, d.ctx()).some((h) => h.active)).toBe(false);
    d.send(key("Escape"));
    expect(d.store.getState().selection.size).toBe(0);
    expect(d.send(key("Escape"))).toBe(false);

    d.send(pointer("pointerdown", 40, 40));
    d.send(pointer("pointerdown", 500, 500));
    expect(vertexTool.handles!(d.state, d.ctx())).toEqual([]);
  });

  it("edits a plate already selected in Build without a first click", () => {
    const store = makeStore();
    store.getState().select(["plate"]);
    const d = new Driver(store);
    expect(vertexTool.handles!(d.state, d.ctx())).toHaveLength(8);
    d.drag([10, 0], [0, -10]);
    expect(d.outline()[0]).toEqual([-10, -10]);
  });

  it("drops a selected vertex that undo removed", () => {
    const store = makeStore();
    const d = new Driver(store);
    d.send(pointer("pointerdown", 40, 40));
    d.drag([60, 0], [60, -30]); // 5 vertices
    d.send(pointer("pointerdown", 10, 100)); // the last one, index 4
    d.send(pointer("pointerup", 10, 100));
    store.getState().undo(); // back to 4: index 4 is gone
    expect(vertexTool.handles!(d.state, d.ctx()).some((h) => h.active)).toBe(false);
    expect(d.send(key("Delete"))).toBe(false);
    expect(d.outline()).toHaveLength(4);
  });

  it("dragging a bar segment's midpoint bends it into an arc, leaving its sites alone", () => {
    const store = makeStore();
    const before = store.getState().document;
    const d = new Driver(store);
    d.click([325, 0]);
    expect([...store.getState().selection]).toEqual(["bar"]);
    expect(vertexTool.hint(d.state, d.ctx()).key).toBe("tools.vertex.hint.barSelected");
    const handles = vertexTool.handles!(d.state, d.ctx());
    expect(handles).toEqual([{ kind: "midpoint", at: { x: 325, y: 0 } }]);

    d.drag([325, 0], [325, 10]);
    expect(d.edges("bar")).toEqual([{ kind: "arc", bulge: 0.4 }]);
    const bar = store.getState().document.links.find((l) => l.id === "bar")!;
    expect(bar.sites).toEqual(before.links[1].sites);
    // The arc is longer than the chord, so the bar is heavier.
    const doc = store.getState().document;
    expect(computedMassProperties(bar, doc).mass).toBeGreaterThan(
      computedMassProperties(before.links[1], before).mass,
    );
    // The arc's apex handle now sits on the curve.
    const apex = vertexTool.handles!(d.state, d.ctx()).find((h) => h.kind === "bulge")!;
    expect(apex.at.x).toBeCloseTo(325);
    expect(apex.at.y).toBeCloseTo(10);

    store.getState().undo();
    expect(store.getState().document).toEqual(before);
  });

  it("Shift+dragging a plate edge's midpoint bends it instead of adding a vertex", () => {
    const d = new Driver(makeStore());
    d.click([40, 40]);
    d.drag([60, 0], [60, -20], true);
    expect(d.outline()).toHaveLength(4);
    expect(d.edges()).toEqual([
      { kind: "arc", bulge: -0.4 },
      { kind: "line" },
      { kind: "line" },
      { kind: "line" },
    ]);
  });

  it("the edge toolbar switches an edge between Line, Arc and Curve", () => {
    const d = new Driver(makeStore());
    d.click([40, 40]);
    expect(vertexTool.edgeMenu!(d.state, d.ctx())).toBeUndefined();
    d.click([60, 0]);
    expect(vertexTool.edgeMenu!(d.state, d.ctx())).toEqual({
      at: { x: 60, y: 0 },
      kind: "line",
      canSplit: true,
    });
    expect(vertexTool.hint(d.state, d.ctx()).key).toBe("tools.vertex.hint.edgeSelected");

    expect(d.command("edge:arc")).toBe(true);
    const arc = d.edges()![0];
    expect(arc.kind).toBe("arc");

    d.command("edge:bezier");
    const curve = d.edges()![0];
    expect(curve.kind).toBe("bezier");
    // The curve keeps the arc's apex.
    const arcApex = edgeMidpoint([0, 0], [100, 0], arc);
    const curveApex = edgeMidpoint([0, 0], [100, 0], curve);
    expect(curveApex[0]).toBeCloseTo(arcApex[0], 3);
    expect(curveApex[1]).toBeCloseTo(arcApex[1], 3);
    expect(vertexTool.handles!(d.state, d.ctx()).filter((h) => h.kind === "control")).toHaveLength(
      2,
    );

    d.command("edge:line");
    expect(d.edges()).toBeUndefined();
    expect(vertexTool.edgeMenu!(d.state, d.ctx())?.kind).toBe("line");
  });

  it("dragging a curve's control point reshapes it, as one undo step", () => {
    const store = makeStore();
    const d = new Driver(store);
    d.click([40, 40]);
    d.click([60, 0]);
    d.command("edge:bezier");
    const before = store.getState().document;
    const control = vertexTool.handles!(d.state, d.ctx()).find((h) => h.kind === "control")!;
    d.drag([control.at.x, control.at.y], [control.at.x + 10, control.at.y - 10]);
    const edge = d.edges()![0];
    if (edge.kind !== "bezier") throw new Error("expected a curve");
    const was = before.links[0].shape.edges![0];
    if (was.kind !== "bezier") throw new Error("expected a curve");
    const moved = edge.out[0] !== was.out[0] ? edge.out : edge.in;
    const original = edge.out[0] !== was.out[0] ? was.out : was.in;
    expect(moved[0] - original[0]).toBeCloseTo(10);
    expect(moved[1] - original[1]).toBeCloseTo(-10);
    store.getState().undo();
    expect(store.getState().document).toEqual(before);
  });

  it("Split adds a vertex on a curved edge without changing its shape", () => {
    const d = new Driver(makeStore());
    d.click([40, 40]);
    d.click([60, 0]);
    d.command("edge:arc");
    const arc = d.edges()![0];
    const apex = edgeMidpoint([0, 0], [100, 0], arc);
    d.command("edge:split");
    expect(d.outline()).toHaveLength(5);
    expect(d.outline()[1][0]).toBeCloseTo(apex[0]);
    expect(d.outline()[1][1]).toBeCloseTo(apex[1]);
    const [first, second] = d.edges()!;
    expect(first.kind).toBe("arc");
    expect(second).toEqual(first);
    // The new vertex is selected.
    expect(vertexTool.hint(d.state, d.ctx()).key).toBe("tools.vertex.hint.vertexSelected");
  });

  it("bars get no Split; Delete straightens a selected curved edge", () => {
    const d = new Driver(makeStore());
    d.click([325, 0]);
    d.drag([325, 0], [325, 10]);
    expect(vertexTool.edgeMenu!(d.state, d.ctx())).toMatchObject({ kind: "arc", canSplit: false });
    expect(d.command("edge:split")).toBe(false);
    expect(d.send(key("Delete"))).toBe(true);
    expect(d.edges("bar")).toBeUndefined();
    expect(d.send(key("Delete"))).toBe(false);
  });

  it("deleting a vertex keeps the curves of edges that stay intact", () => {
    const d = new Driver(makeStore());
    d.click([40, 40]);
    d.drag([60, 0], [60, -20], true); // edge 0 (v0 -> v1) becomes an arc
    d.click([110, 100]); // vertex 2
    d.send(key("Delete"));
    expect(d.outline()).toEqual([
      [0, 0],
      [100, 0],
      [0, 100],
    ]);
    expect(d.edges()).toEqual([{ kind: "arc", bulge: -0.4 }, { kind: "line" }, { kind: "line" }]);
  });
});
