import { describe, expect, it } from "vitest";
import { MechanismDocumentSchema, type MechanismDocument } from "../model";
import { degToRad } from "../model/units";
import type { SnapResult } from "../canvas/snapping";
import type { ToolContext, ToolEvent } from "./types";
import { sliderTool, type SliderToolState } from "./sliderTool";
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

function angleSnap(point: { x: number; y: number }, angleDeg: number): SnapResult {
  return { kind: "angle", point, angleDeg };
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

describe("sliderTool", () => {
  it("a click starts aiming (busy)", () => {
    const ctx = ctxFor(emptyDoc());
    const result = sliderTool.reduce(
      sliderTool.initial(),
      pointerdown({ x: 5, y: 5 }, noneSnap({ x: 5, y: 5 })),
      ctx,
    );
    expect(result.state).toMatchObject({ phase: "aiming", at: { x: 5, y: 5 } });
    expect(sliderTool.isBusy(result.state)).toBe(true);
  });

  it("a click on a site carries siteId", () => {
    const ctx = ctxFor(emptyDoc());
    const result = sliderTool.reduce(
      sliderTool.initial(),
      pointerdown({ x: 5, y: 5 }, siteSnap({ x: 5, y: 5 }, "site-1", "link-1")),
      ctx,
    );
    expect(result.state).toMatchObject({ siteId: "site-1" });
  });

  it("pointermove sets axisAngle from the cursor direction", () => {
    const ctx = ctxFor(emptyDoc());
    let state = sliderTool.reduce(
      sliderTool.initial(),
      pointerdown({ x: 0, y: 0 }, noneSnap({ x: 0, y: 0 })),
      ctx,
    ).state;
    state = sliderTool.reduce(
      state,
      pointermove({ x: 10, y: 10 }, noneSnap({ x: 10, y: 10 })),
      ctx,
    ).state;
    expect((state as { axisAngle: number }).axisAngle).toBeCloseTo(Math.atan2(10, 10));
  });

  it("an angle snap rounds axisAngle to the snapped 15deg value", () => {
    const ctx = ctxFor(emptyDoc());
    let state = sliderTool.reduce(
      sliderTool.initial(),
      pointerdown({ x: 0, y: 0 }, noneSnap({ x: 0, y: 0 })),
      ctx,
    ).state;
    state = sliderTool.reduce(
      state,
      pointermove({ x: 10, y: 6 }, angleSnap({ x: 10, y: 6 }, 30)),
      ctx,
    ).state;
    expect((state as { axisAngle: number }).axisAngle).toBeCloseTo(degToRad(30));
  });

  it("a pointermove at the anchor point (zero relative distance) doesn't change the axis", () => {
    const ctx = ctxFor(emptyDoc());
    let state = sliderTool.reduce(
      sliderTool.initial(),
      pointerdown({ x: 0, y: 0 }, noneSnap({ x: 0, y: 0 })),
      ctx,
    ).state;
    state = sliderTool.reduce(
      state,
      pointermove({ x: 10, y: 6 }, angleSnap({ x: 10, y: 6 }, 30)),
      ctx,
    ).state;
    const before = (state as { axisAngle: number }).axisAngle;
    state = sliderTool.reduce(
      state,
      pointermove({ x: 0, y: 0 }, noneSnap({ x: 0, y: 0 })),
      ctx,
    ).state;
    expect((state as { axisAngle: number }).axisAngle).toBe(before);
  });

  it("a click while aiming commits with the pointer-derived axis", () => {
    const ctx = ctxFor(emptyDoc(), 4);
    let state = sliderTool.reduce(
      sliderTool.initial(),
      pointerdown({ x: 0, y: 0 }, noneSnap({ x: 0, y: 0 })),
      ctx,
    ).state;
    state = sliderTool.reduce(
      state,
      pointermove({ x: 10, y: 0 }, noneSnap({ x: 10, y: 0 })),
      ctx,
    ).state;
    const result = sliderTool.reduce(
      state,
      pointerdown({ x: 10, y: 0 }, noneSnap({ x: 10, y: 0 })),
      ctx,
    );
    expect(result.effects).toEqual([
      {
        kind: "commitSlider",
        at: { x: 0, y: 0 },
        axisAngle: 0,
        siteId: undefined,
        blockHalfSize: 6,
      },
    ]);
    expect(result.state).toEqual({ phase: "idle" });
  });

  it("Enter commits with a typed angle exactly", () => {
    const ctx = ctxFor(emptyDoc(), 4);
    let state = sliderTool.reduce(
      sliderTool.initial(),
      pointerdown({ x: 0, y: 0 }, noneSnap({ x: 0, y: 0 })),
      ctx,
    ).state;
    for (const k of ["4", "5"]) {
      state = sliderTool.reduce(state, key(k), ctx).state;
    }
    const result = sliderTool.reduce(state, key("Enter"), ctx);
    expect(result.effects).toEqual([
      {
        kind: "commitSlider",
        at: { x: 0, y: 0 },
        axisAngle: degToRad(45),
        siteId: undefined,
        blockHalfSize: 6,
      },
    ]);
  });

  it("digits go straight to the angle field (no Tab needed)", () => {
    const ctx = ctxFor(emptyDoc());
    let state = sliderTool.reduce(
      sliderTool.initial(),
      pointerdown({ x: 0, y: 0 }, noneSnap({ x: 0, y: 0 })),
      ctx,
    ).state;
    state = sliderTool.reduce(state, key("9"), ctx).state;
    expect(sliderTool.dynamicInput(state)).toEqual({ field: "angle", length: "", angle: "9" });
  });

  it("an invalid typed angle does not commit", () => {
    const ctx = ctxFor(emptyDoc());
    let state = sliderTool.reduce(
      sliderTool.initial(),
      pointerdown({ x: 0, y: 0 }, noneSnap({ x: 0, y: 0 })),
      ctx,
    ).state;
    state = sliderTool.reduce(state, key("."), ctx).state;
    state = sliderTool.reduce(state, key("."), ctx).state;
    const result = sliderTool.reduce(state, key("Enter"), ctx);
    // "." then "." (ignored) leaves angle "." which parseNumberInput rejects.
    expect(result.effects).toEqual([]);
  });

  it("Escape/cancel returns to idle", () => {
    const ctx = ctxFor(emptyDoc());
    const state = sliderTool.reduce(
      sliderTool.initial(),
      pointerdown({ x: 0, y: 0 }, noneSnap({ x: 0, y: 0 })),
      ctx,
    ).state;
    const result = sliderTool.reduce(state, key("Escape"), ctx);
    expect(result.state).toEqual({ phase: "idle" });
    const result2 = sliderTool.reduce(state, { type: "cancel" }, ctx);
    expect(result2.state).toEqual({ phase: "idle" });
  });

  it("right-click while aiming cancels", () => {
    const ctx = ctxFor(emptyDoc());
    const state = sliderTool.reduce(
      sliderTool.initial(),
      pointerdown({ x: 0, y: 0 }, noneSnap({ x: 0, y: 0 })),
      ctx,
    ).state;
    const result = sliderTool.reduce(
      state,
      pointerdown({ x: 1, y: 1 }, noneSnap({ x: 1, y: 1 }), 2),
      ctx,
    );
    expect(result.state).toEqual({ phase: "idle" });
  });

  it("idle right-click / cancel are unhandled no-ops", () => {
    const ctx = ctxFor(emptyDoc());
    const rightClick = sliderTool.reduce(
      sliderTool.initial(),
      pointerdown({ x: 0, y: 0 }, noneSnap({ x: 0, y: 0 }), 2),
      ctx,
    );
    expect(rightClick.handled).toBe(false);
    const cancel = sliderTool.reduce(sliderTool.initial(), { type: "cancel" }, ctx);
    expect(cancel.handled).toBe(false);
  });

  it("hint reflects the current angle while aiming", () => {
    const ctx = ctxFor(emptyDoc());
    let state: SliderToolState = sliderTool.reduce(
      sliderTool.initial(),
      pointerdown({ x: 0, y: 0 }, noneSnap({ x: 0, y: 0 })),
      ctx,
    ).state;
    state = sliderTool.reduce(
      state,
      pointermove({ x: 10, y: 0 }, noneSnap({ x: 10, y: 0 })),
      ctx,
    ).state;
    const hint = sliderTool.hint(state, ctx);
    expect(hint).toEqual({ key: "tools.slider.hint.aim", values: { angle: 0 } });
    expectHintLocalized(hint);
  });

  it("hint is idle by default", () => {
    const ctx = ctxFor(emptyDoc());
    const hint = sliderTool.hint(sliderTool.initial(), ctx);
    expect(hint).toEqual({ key: "tools.slider.hint.idle" });
    expectHintLocalized(hint);
  });

  it("preview is a ray while aiming, empty while idle", () => {
    const ctx = ctxFor(emptyDoc());
    expect(sliderTool.preview(sliderTool.initial())).toEqual([]);
    const state = sliderTool.reduce(
      sliderTool.initial(),
      pointerdown({ x: 1, y: 2 }, noneSnap({ x: 1, y: 2 })),
      ctx,
    ).state;
    expect(sliderTool.preview(state)).toEqual([{ kind: "ray", from: { x: 1, y: 2 }, angle: 0 }]);
  });

  it("snapAnchor is the aim point while aiming, undefined while idle", () => {
    const ctx = ctxFor(emptyDoc());
    expect(sliderTool.snapAnchor(sliderTool.initial())).toBeUndefined();
    const state = sliderTool.reduce(
      sliderTool.initial(),
      pointerdown({ x: 1, y: 2 }, noneSnap({ x: 1, y: 2 })),
      ctx,
    ).state;
    expect(sliderTool.snapAnchor(state)).toEqual({ x: 1, y: 2 });
  });

  it("an unrecognized key is unhandled", () => {
    const ctx = ctxFor(emptyDoc());
    const state = sliderTool.reduce(
      sliderTool.initial(),
      pointerdown({ x: 0, y: 0 }, noneSnap({ x: 0, y: 0 })),
      ctx,
    ).state;
    const result = sliderTool.reduce(state, key("z"), ctx);
    expect(result.handled).toBe(false);
    expect(result.state).toBe(state);
  });
});
