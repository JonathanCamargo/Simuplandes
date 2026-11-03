import { describe, expect, it } from "vitest";
import { createMechanismStore, setBackgroundImage, type MechanismStore } from "../store";
import { MechanismDocumentSchema, type BackgroundImage } from "../model";
import { applyToolEffects } from "./effects";
import { imageTool, type ImageToolState } from "./imageTool";
import { expectHintLocalized } from "./machines.test";
import type { ToolContext, ToolEvent } from "./types";

const NAMES = {
  bar: "Bar",
  plate: "Plate",
  ground: "Ground",
  slider: "Slider",
  marker: "Marker",
  spring: "Spring",
};

/** A 1x1 transparent PNG. */
const PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";

const IMAGE: BackgroundImage = { src: PNG, center: [0, 0], width: 200, height: 100, opacity: 0.5 };

function pointer(
  type: "pointerdown" | "pointermove" | "pointerup",
  x: number,
  y: number,
): ToolEvent {
  return {
    type,
    world: { x, y },
    snap: { kind: "none", point: { x, y } },
    button: 0,
    shift: false,
    mod: false,
    alt: false,
  };
}

class Driver {
  private gesture = 0;
  state: ImageToolState = imageTool.initial();
  constructor(readonly store: MechanismStore = createMechanismStore({ validate: true })) {}
  ctx(): ToolContext {
    const { document, selection } = this.store.getState();
    return { doc: document, selection, radiusWorld: 8, gestureSeed: `g${this.gesture}` };
  }
  send(event: ToolEvent): boolean {
    if (event.type === "pointerdown") this.gesture += 1;
    const result = imageTool.reduce(this.state, event, this.ctx());
    this.state = result.state;
    applyToolEffects(this.store, result.effects, { defaultNames: NAMES });
    return result.handled;
  }
  drag(points: [number, number][]): void {
    const [first, ...rest] = points;
    this.send(pointer("pointerdown", ...first));
    for (const p of rest) this.send(pointer("pointermove", ...p));
    this.send(pointer("pointerup", ...points[points.length - 1]));
  }
  background(): BackgroundImage | undefined {
    return this.store.getState().document.background;
  }
}

function withImage(): Driver {
  const d = new Driver();
  d.store.getState().execute("edit-background", setBackgroundImage(IMAGE));
  return d;
}

describe("imageTool", () => {
  it("does nothing without an image, and says how to import one", () => {
    const d = new Driver();
    expect(d.send(pointer("pointerdown", 0, 0))).toBe(false);
    const hint = imageTool.hint(d.state, d.ctx());
    expect(hint.key).toBe("tools.image.hint.empty");
    expect(imageTool.handles?.(d.state, d.ctx())).toEqual([]);
  });

  it("moves the image by the drag, as one undo step", () => {
    const d = withImage();
    d.drag([
      [10, 10],
      [20, 15],
      [40, 30],
    ]);
    expect(d.background()?.center).toEqual([30, 20]);
    expect(d.background()).toMatchObject({ width: 200, height: 100 });
    d.store.getState().undo();
    expect(d.background()?.center).toEqual([0, 0]);
  });

  it("ignores a press outside the image", () => {
    const d = withImage();
    d.drag([
      [500, 500],
      [600, 600],
    ]);
    expect(d.background()).toEqual(IMAGE);
  });

  it("scales from a corner about the opposite corner, keeping proportions", () => {
    const d = withImage();
    // Top-right corner (100, 50) dragged out; bottom-left (-100, -50) stays.
    d.drag([
      [101, 49],
      [200, 60],
      [300, 80],
    ]);
    const bg = d.background();
    expect(bg?.width).toBeCloseTo(400);
    expect(bg?.height).toBeCloseTo(200);
    expect(bg?.center[0]).toBeCloseTo(100);
    expect(bg?.center[1]).toBeCloseTo(50);
    d.store.getState().undo();
    expect(d.background()).toEqual(IMAGE);
  });

  it("never scales through the fixed corner", () => {
    const d = withImage();
    d.drag([
      [100, 50],
      [-500, -500],
    ]);
    const bg = d.background();
    expect(bg?.width).toBeGreaterThan(0);
    expect(bg?.height).toBeCloseTo((bg?.width ?? 0) / 2);
  });

  it("shows a handle on each corner and localized hints", () => {
    const d = withImage();
    expect(imageTool.handles?.(d.state, d.ctx())).toHaveLength(4);
    expectHintLocalized(imageTool.hint(d.state, d.ctx()));
    d.send(pointer("pointerdown", 0, 0));
    expectHintLocalized(imageTool.hint(d.state, d.ctx()));
    expect(imageTool.isBusy(d.state)).toBe(true);
    expect(d.send({ type: "key", key: "Escape", shift: false, mod: false, alt: false })).toBe(true);
    expect(imageTool.isBusy(d.state)).toBe(false);
  });
});

describe("setBackgroundImage", () => {
  it("rejects a non-image source and a non-positive size", () => {
    const store = createMechanismStore({ validate: true });
    expect(() =>
      store
        .getState()
        .execute("x", setBackgroundImage({ ...IMAGE, src: "https://example.com/a.png" })),
    ).toThrow();
    expect(() =>
      store.getState().execute("x", setBackgroundImage({ ...IMAGE, width: 0 })),
    ).toThrow();
  });

  it("removes the image with undefined", () => {
    const store = createMechanismStore({ validate: true });
    store.getState().execute("x", setBackgroundImage(IMAGE));
    store.getState().execute("y", setBackgroundImage(undefined));
    expect(store.getState().document.background).toBeUndefined();
    expect(MechanismDocumentSchema.safeParse(store.getState().document).success).toBe(true);
  });
});
