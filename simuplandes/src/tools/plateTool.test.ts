import { describe, expect, it } from "vitest";
import { MechanismDocumentSchema, type MechanismDocument } from "../model";
import type { SnapResult } from "../canvas/snapping";
import type { ToolContext, ToolEvent } from "./types";
import { plateTool, type PlateToolState } from "./plateTool";
import { expectHintLocalized } from "./machines.test";

function emptyDoc(): MechanismDocument {
  return MechanismDocumentSchema.parse({ schemaVersion: 1 });
}

function ctxFor(doc: MechanismDocument, radiusWorld = 8): ToolContext {
  return { doc, selection: new Set(), radiusWorld, gestureSeed: "test-gesture" };
}

function noneSnap(point: { x: number; y: number }): SnapResult {
  return { kind: "none", point };
}

function siteSnap(point: { x: number; y: number }, siteId: string, linkId: string): SnapResult {
  return { kind: "site", point, siteId, linkId };
}

function pointerdown(world: { x: number; y: number }, snap: SnapResult, button = 0): ToolEvent {
  return { type: "pointerdown", world, snap, button, shift: false, mod: false, alt: false };
}

function pointermove(world: { x: number; y: number }, snap: SnapResult): ToolEvent {
  return { type: "pointermove", world, snap, button: -1, shift: false, mod: false, alt: false };
}

function key(k: string): ToolEvent {
  return { type: "key", key: k, shift: false, mod: false, alt: false };
}

function clickAt(
  state: PlateToolState,
  ctx: ToolContext,
  p: { x: number; y: number },
): PlateToolState {
  return plateTool.reduce(state, pointerdown(p, noneSnap(p)), ctx).state;
}

describe("plateTool", () => {
  it("three clicks then Enter commits a plate with 3 vertices", () => {
    const ctx = ctxFor(emptyDoc());
    let state = plateTool.initial();
    state = clickAt(state, ctx, { x: 0, y: 0 });
    state = clickAt(state, ctx, { x: 100, y: 0 });
    state = clickAt(state, ctx, { x: 50, y: 80 });
    const result = plateTool.reduce(state, key("Enter"), ctx);
    expect(result.effects).toEqual([
      {
        kind: "commitPlate",
        vertices: [
          { x: 0, y: 0 },
          { x: 100, y: 0 },
          { x: 50, y: 80 },
        ],
        vertexSiteIds: [undefined, undefined, undefined],
      },
    ]);
    expect(result.state).toEqual({ phase: "idle" });
  });

  it("carries vertexSiteIds from the snaps", () => {
    const ctx = ctxFor(emptyDoc());
    let state = plateTool.reduce(
      plateTool.initial(),
      pointerdown({ x: 0, y: 0 }, siteSnap({ x: 0, y: 0 }, "site-a", "link-a")),
      ctx,
    ).state;
    state = clickAt(state, ctx, { x: 100, y: 0 });
    state = clickAt(state, ctx, { x: 50, y: 80 });
    const result = plateTool.reduce(state, key("Enter"), ctx);
    expect(result.effects[0]).toMatchObject({ vertexSiteIds: ["site-a", undefined, undefined] });
  });

  it("a click within radiusWorld of vertex 0 (>= 3 vertices) closes the plate", () => {
    const ctx = ctxFor(emptyDoc(), 5);
    let state = plateTool.initial();
    state = clickAt(state, ctx, { x: 0, y: 0 });
    state = clickAt(state, ctx, { x: 100, y: 0 });
    state = clickAt(state, ctx, { x: 50, y: 80 });
    const result = plateTool.reduce(
      state,
      pointerdown({ x: 2, y: 1 }, noneSnap({ x: 2, y: 1 })),
      ctx,
    );
    expect(result.effects).toHaveLength(1);
    expect(result.effects[0].kind).toBe("commitPlate");
    expect(result.state).toEqual({ phase: "idle" });
  });

  it("Enter with fewer than 3 vertices does not commit, and hints needThree", () => {
    const ctx = ctxFor(emptyDoc());
    let state = plateTool.initial();
    state = clickAt(state, ctx, { x: 0, y: 0 });
    state = clickAt(state, ctx, { x: 100, y: 0 });
    const result = plateTool.reduce(state, key("Enter"), ctx);
    expect(result.effects).toEqual([]);
    const hint = plateTool.hint(result.state, ctx);
    expect(hint).toEqual({ key: "tools.plate.hint.needThree" });
    expectHintLocalized(hint);
  });

  it("Backspace (no typed text) removes the last vertex", () => {
    const ctx = ctxFor(emptyDoc());
    let state = plateTool.initial();
    state = clickAt(state, ctx, { x: 0, y: 0 });
    state = clickAt(state, ctx, { x: 100, y: 0 });
    const result = plateTool.reduce(state, key("Backspace"), ctx);
    expect(result.state).toMatchObject({ phase: "drawing", vertices: [{ x: 0, y: 0 }] });
  });

  it("Backspace on the only vertex returns to idle", () => {
    const ctx = ctxFor(emptyDoc());
    let state = plateTool.initial();
    state = clickAt(state, ctx, { x: 0, y: 0 });
    const result = plateTool.reduce(state, key("Backspace"), ctx);
    expect(result.state).toEqual({ phase: "idle" });
  });

  it("Backspace with typed text edits the text instead of removing a vertex", () => {
    const ctx = ctxFor(emptyDoc());
    let state = plateTool.initial();
    state = clickAt(state, ctx, { x: 0, y: 0 });
    state = plateTool.reduce(state, key("5"), ctx).state;
    const result = plateTool.reduce(state, key("Backspace"), ctx);
    expect(result.state).toMatchObject({ phase: "drawing", vertices: [{ x: 0, y: 0 }] });
    expect((result.state as { input: { length: string } }).input.length).toBe("");
  });

  it("typed length/angle places the next vertex relative to the last one", () => {
    const ctx = ctxFor(emptyDoc());
    let state = plateTool.initial();
    state = clickAt(state, ctx, { x: 0, y: 0 });
    for (const k of ["1", "0", "0", "Tab", "9", "0"]) {
      state = plateTool.reduce(state, key(k), ctx).state;
    }
    const result = plateTool.reduce(state, key("Enter"), ctx);
    expect(result.effects).toEqual([]);
    expect(result.state.phase).toBe("drawing");
    const drawing = result.state as Extract<PlateToolState, { phase: "drawing" }>;
    expect(drawing.vertices).toHaveLength(2);
    expect(drawing.vertices[0]).toEqual({ x: 0, y: 0 });
    expect(drawing.vertices[1].x).toBeCloseTo(0, 9);
    expect(drawing.vertices[1].y).toBeCloseTo(100, 9);
  });

  it("Escape cancels to idle", () => {
    const ctx = ctxFor(emptyDoc());
    let state = plateTool.initial();
    state = clickAt(state, ctx, { x: 0, y: 0 });
    const result = plateTool.reduce(state, key("Escape"), ctx);
    expect(result.state).toEqual({ phase: "idle" });
  });

  it("right-click cancels to idle", () => {
    const ctx = ctxFor(emptyDoc());
    let state = plateTool.initial();
    state = clickAt(state, ctx, { x: 0, y: 0 });
    const result = plateTool.reduce(
      state,
      pointerdown({ x: 5, y: 5 }, noneSnap({ x: 5, y: 5 }), 2),
      ctx,
    );
    expect(result.state).toEqual({ phase: "idle" });
  });

  it("hint reports drawingPin when hovering a named site", () => {
    const doc = MechanismDocumentSchema.parse({
      schemaVersion: 1,
      links: [
        {
          id: "link-1",
          name: "L",
          isGround: false,
          pose: { position: [0, 0], angle: 0 },
          shape: { kind: "bar" },
          sites: [{ id: "site-1", name: "S1", local: [0, 0] }],
        },
      ],
    });
    const ctx = ctxFor(doc);
    let state = plateTool.initial();
    state = clickAt(state, ctx, { x: 0, y: 0 });
    state = plateTool.reduce(
      state,
      pointermove({ x: 100, y: 0 }, siteSnap({ x: 100, y: 0 }, "site-1", "link-1")),
      ctx,
    ).state;
    const hint = plateTool.hint(state, ctx);
    expect(hint).toEqual({
      key: "tools.plate.hint.drawingPin",
      values: { target: "S1" },
    });
    expectHintLocalized(hint);
  });

  it("hint reports the vertex count once at least 3 vertices are placed", () => {
    const ctx = ctxFor(emptyDoc());
    let state = plateTool.initial();
    state = clickAt(state, ctx, { x: 0, y: 0 });
    state = clickAt(state, ctx, { x: 100, y: 0 });
    state = clickAt(state, ctx, { x: 50, y: 80 });
    const hint = plateTool.hint(state, ctx);
    expect(hint).toEqual({
      key: "tools.plate.hint.drawing",
      values: { count: 3 },
    });
    expectHintLocalized(hint);
  });

  it("hint is idle before any click", () => {
    const ctx = ctxFor(emptyDoc());
    const hint = plateTool.hint(plateTool.initial(), ctx);
    expect(hint).toEqual({ key: "tools.plate.hint.idle" });
    expectHintLocalized(hint);
  });

  it("preview is a polyline while drawing, empty while idle", () => {
    const ctx = ctxFor(emptyDoc());
    expect(plateTool.preview(plateTool.initial())).toEqual([]);
    const state = clickAt(plateTool.initial(), ctx, { x: 0, y: 0 });
    expect(plateTool.preview(state)).toEqual([
      {
        kind: "polyline",
        points: [
          { x: 0, y: 0 },
          { x: 0, y: 0 },
        ],
        closed: false,
      },
    ]);
  });

  it("snapAnchor is the last vertex while drawing, undefined while idle", () => {
    const ctx = ctxFor(emptyDoc());
    expect(plateTool.snapAnchor(plateTool.initial())).toBeUndefined();
    let state = clickAt(plateTool.initial(), ctx, { x: 0, y: 0 });
    state = clickAt(state, ctx, { x: 100, y: 0 });
    expect(plateTool.snapAnchor(state)).toEqual({ x: 100, y: 0 });
  });

  it("dynamicInput is the buffer while drawing, undefined while idle", () => {
    const ctx = ctxFor(emptyDoc());
    expect(plateTool.dynamicInput(plateTool.initial())).toBeUndefined();
    const state = clickAt(plateTool.initial(), ctx, { x: 0, y: 0 });
    expect(plateTool.dynamicInput(state)).toEqual({ field: "length", length: "", angle: "" });
  });

  it("an unrecognized key is unhandled", () => {
    const ctx = ctxFor(emptyDoc());
    const state = clickAt(plateTool.initial(), ctx, { x: 0, y: 0 });
    const result = plateTool.reduce(state, key("p"), ctx);
    expect(result.handled).toBe(false);
    expect(result.state).toBe(state);
  });

  it("idle + right-click is a no-op, unhandled", () => {
    const ctx = ctxFor(emptyDoc());
    const result = plateTool.reduce(
      plateTool.initial(),
      pointerdown({ x: 0, y: 0 }, noneSnap({ x: 0, y: 0 }), 2),
      ctx,
    );
    expect(result.handled).toBe(false);
    expect(result.state).toEqual({ phase: "idle" });
  });

  it("cancel event while idle is unhandled", () => {
    const ctx = ctxFor(emptyDoc());
    const result = plateTool.reduce(plateTool.initial(), { type: "cancel" }, ctx);
    expect(result.handled).toBe(false);
  });

  it("an invalid typed length does not add a vertex", () => {
    const ctx = ctxFor(emptyDoc());
    let state = clickAt(plateTool.initial(), ctx, { x: 0, y: 0 });
    state = plateTool.reduce(state, key("0"), ctx).state;
    const result = plateTool.reduce(state, key("Enter"), ctx);
    expect(result.effects).toEqual([]);
    expect(result.state).toBe(state);
  });
});
