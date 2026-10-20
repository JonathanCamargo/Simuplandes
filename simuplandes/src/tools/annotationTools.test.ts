import { describe, expect, it } from "vitest";
import { createMechanismStore, type MechanismStore } from "../store";
import { applyToolEffects } from "./effects";
import { brushTool, simplifyStroke, type BrushToolState } from "./brushTool";
import { eraserTool, type EraserToolState } from "./eraserTool";
import { expectHintLocalized } from "./machines.test";
import type { BrushSettings, ToolContext, ToolEvent, ToolMachine } from "./types";

const NAMES = {
  bar: "Barra",
  plate: "Placa",
  ground: "Bancada",
  slider: "Corredera",
  marker: "Punto",
  spring: "Resorte",
};

function pointer(
  type: "pointerdown" | "pointermove" | "pointerup",
  x: number,
  y: number,
): ToolEvent {
  const world = { x, y };
  return {
    type,
    world,
    snap: { kind: "grid", point: { x: Math.round(x / 10) * 10, y: Math.round(y / 10) * 10 } },
    button: 0,
    shift: false,
    mod: false,
    alt: false,
  };
}

const ESC: ToolEvent = { type: "key", key: "Escape", shift: false, mod: false, alt: false };

/** Drives a machine like the controller: a fresh gesture per pointerdown, effects applied. Zoom 1: 1 px = 1 unit. */
class Driver<S> {
  private gesture = 0;
  state: S;
  constructor(
    readonly machine: ToolMachine<S>,
    readonly store: MechanismStore = createMechanismStore({ validate: true }),
    readonly brush?: BrushSettings,
  ) {
    this.state = machine.initial();
  }
  ctx(): ToolContext {
    const { document, selection } = this.store.getState();
    return {
      doc: document,
      selection,
      radiusWorld: 8,
      gestureSeed: `g${this.gesture}`,
      ...(this.brush ? { brush: this.brush } : {}),
    };
  }
  send(event: ToolEvent): boolean {
    if (event.type === "pointerdown") this.gesture += 1;
    const result = this.machine.reduce(this.state, event, this.ctx());
    this.state = result.state;
    applyToolEffects(this.store, result.effects, { defaultNames: NAMES });
    return result.handled;
  }
  stroke(points: [number, number][]): void {
    const [first, ...rest] = points;
    this.send(pointer("pointerdown", ...first));
    for (const p of rest) this.send(pointer("pointermove", ...p));
    const last = points[points.length - 1];
    this.send(pointer("pointerup", ...last));
  }
}

describe("brushTool", () => {
  it("one drag paints one annotation at the raw pointer (no snapping), one undo step", () => {
    const d = new Driver<BrushToolState>(brushTool, undefined, { color: "red", widthPx: 4 });
    d.stroke([
      [0, 0],
      [3, 1],
      [6, 4],
      [9, 9],
    ]);
    const [stroke] = d.store.getState().document.annotations;
    expect(stroke).toMatchObject({ kind: "stroke", color: "red", width: 4 });
    expect(stroke.points[0]).toEqual([0, 0]);
    expect(stroke.points[stroke.points.length - 1]).toEqual([9, 9]);
    expect(d.store.getState().document.links).toHaveLength(0);
    d.store.getState().undo();
    expect(d.store.getState().document.annotations).toHaveLength(0);
  });

  it("shows the stroke while painting and is busy until release", () => {
    const d = new Driver<BrushToolState>(brushTool);
    d.send(pointer("pointerdown", 0, 0));
    d.send(pointer("pointermove", 5, 0));
    expect(brushTool.isBusy(d.state)).toBe(true);
    expect(brushTool.preview(d.state)).toEqual([
      {
        kind: "stroke",
        points: [
          { x: 0, y: 0 },
          { x: 5, y: 0 },
        ],
        color: "ink",
        width: 3,
      },
    ]);
    expectHintLocalized(brushTool.hint(d.state, d.ctx()));
  });

  it("width follows zoom: 4 px at zoom 2 is 2 model units", () => {
    const d = new Driver<BrushToolState>(brushTool, undefined, { color: "blue", widthPx: 4 });
    const ctx = { ...d.ctx(), radiusWorld: 4 };
    const down = brushTool.reduce(d.state, pointer("pointerdown", 0, 0), ctx);
    const up = brushTool.reduce(down.state, pointer("pointerup", 1, 0), ctx);
    expect(up.effects[0]).toMatchObject({ kind: "addAnnotation", width: 2 });
  });

  it("a click with no movement leaves a dot; Escape discards a stroke", () => {
    const d = new Driver<BrushToolState>(brushTool);
    d.stroke([[4, 4]]);
    expect(d.store.getState().document.annotations[0].points).toEqual([[4, 4]]);

    d.send(pointer("pointerdown", 0, 0));
    d.send(pointer("pointermove", 20, 0));
    expect(d.send(ESC)).toBe(true);
    d.send(pointer("pointerup", 20, 0));
    expect(d.store.getState().document.annotations).toHaveLength(1);
  });

  it("simplifyStroke drops points within tolerance of the line, keeping corners", () => {
    const pts = [
      { x: 0, y: 0 },
      { x: 1, y: 0.1 },
      { x: 2, y: 0 },
      { x: 2, y: 5 },
    ];
    expect(simplifyStroke(pts, 0.5)).toEqual([pts[0], pts[2], pts[3]]);
  });
});

describe("eraserTool", () => {
  function withStrokes(): MechanismStore {
    const store = createMechanismStore({ validate: true });
    const brush = new Driver<BrushToolState>(brushTool, store);
    brush.stroke([
      [0, 0],
      [100, 0],
    ]);
    brush.stroke([
      [0, 50],
      [100, 50],
    ]);
    brush.stroke([[200, 200]]);
    return store;
  }

  it("a click removes the stroke under the pointer only", () => {
    const store = withStrokes();
    const d = new Driver<EraserToolState>(eraserTool, store);
    d.send(pointer("pointerdown", 50, 3));
    d.send(pointer("pointerup", 50, 3));
    const left = store.getState().document.annotations;
    expect(left).toHaveLength(2);
    expect(left[0].points[0]).toEqual([0, 50]);
  });

  it("a drag removes every stroke it crosses, even between samples, as one undo step", () => {
    const store = withStrokes();
    const d = new Driver<EraserToolState>(eraserTool, store);
    // One sample above both lines, one below: the sweep between them crosses both.
    d.stroke([
      [30, 80],
      [30, -30],
    ]);
    expect(store.getState().document.annotations.map((a) => a.points)).toEqual([[[200, 200]]]);
    store.getState().undo();
    expect(store.getState().document.annotations).toHaveLength(3);
  });

  it("reaches dots by their width and ignores the mechanism", () => {
    const store = withStrokes();
    const { linkId } = store
      .getState()
      .addLink({ name: "B", sites: [{ local: [200, 205] }, { local: [300, 205] }] });
    const d = new Driver<EraserToolState>(eraserTool, store);
    d.stroke([[205, 205]]);
    expect(store.getState().document.annotations).toHaveLength(2);
    expect(store.getState().document.links.map((l) => l.id)).toEqual([linkId]);
  });

  it("says when there is nothing to erase", () => {
    const d = new Driver<EraserToolState>(eraserTool);
    expect(eraserTool.hint(d.state, d.ctx()).key).toBe("tools.eraser.hint.empty");
    expectHintLocalized(eraserTool.hint(d.state, d.ctx()));
  });
});
