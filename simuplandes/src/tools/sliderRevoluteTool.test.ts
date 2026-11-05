import { describe, expect, it } from "vitest";
import { MechanismDocumentSchema, type MechanismDocument } from "../model";
import { degToRad } from "../model/units";
import type { SnapResult } from "../canvas/snapping";
import type { ToolContext, ToolEffect, ToolEvent } from "./types";
import { sliderRevoluteTool, type SliderRevoluteToolState } from "./sliderRevoluteTool";
import { expectHintLocalized } from "./machines.test";

function emptyDoc(): MechanismDocument {
  return MechanismDocumentSchema.parse({ schemaVersion: 2 });
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

describe("sliderRevoluteTool", () => {
  it("a click starts aiming (busy)", () => {
    const ctx = ctxFor(emptyDoc());
    const result = sliderRevoluteTool.reduce(
      sliderRevoluteTool.initial(),
      pointerdown({ x: 5, y: 5 }, noneSnap({ x: 5, y: 5 })),
      ctx,
    );
    expect(result.state).toMatchObject({ phase: "aiming", at: { x: 5, y: 5 } });
    expect(sliderRevoluteTool.isBusy(result.state)).toBe(true);
  });

  it("a click on a site carries siteId", () => {
    const ctx = ctxFor(emptyDoc());
    const result = sliderRevoluteTool.reduce(
      sliderRevoluteTool.initial(),
      pointerdown({ x: 5, y: 5 }, siteSnap({ x: 5, y: 5 }, "site-1", "link-1")),
      ctx,
    );
    expect(result.state).toMatchObject({ siteId: "site-1" });
  });

  it("pointermove sets axisAngle from the cursor direction", () => {
    const ctx = ctxFor(emptyDoc());
    let state = sliderRevoluteTool.reduce(
      sliderRevoluteTool.initial(),
      pointerdown({ x: 0, y: 0 }, noneSnap({ x: 0, y: 0 })),
      ctx,
    ).state;
    state = sliderRevoluteTool.reduce(
      state,
      pointermove({ x: 10, y: 10 }, noneSnap({ x: 10, y: 10 })),
      ctx,
    ).state;
    expect((state as { axisAngle: number }).axisAngle).toBeCloseTo(Math.atan2(10, 10));
  });

  it("an angle snap rounds axisAngle to the snapped 15deg value", () => {
    const ctx = ctxFor(emptyDoc());
    let state = sliderRevoluteTool.reduce(
      sliderRevoluteTool.initial(),
      pointerdown({ x: 0, y: 0 }, noneSnap({ x: 0, y: 0 })),
      ctx,
    ).state;
    state = sliderRevoluteTool.reduce(
      state,
      pointermove({ x: 10, y: 6 }, angleSnap({ x: 10, y: 6 }, 30)),
      ctx,
    ).state;
    expect((state as { axisAngle: number }).axisAngle).toBeCloseTo(degToRad(30));
  });

  it("a pointermove at the anchor point (zero relative distance) doesn't change the axis", () => {
    const ctx = ctxFor(emptyDoc());
    let state = sliderRevoluteTool.reduce(
      sliderRevoluteTool.initial(),
      pointerdown({ x: 0, y: 0 }, noneSnap({ x: 0, y: 0 })),
      ctx,
    ).state;
    state = sliderRevoluteTool.reduce(
      state,
      pointermove({ x: 10, y: 6 }, angleSnap({ x: 10, y: 6 }, 30)),
      ctx,
    ).state;
    const before = (state as { axisAngle: number }).axisAngle;
    state = sliderRevoluteTool.reduce(
      state,
      pointermove({ x: 0, y: 0 }, noneSnap({ x: 0, y: 0 })),
      ctx,
    ).state;
    expect((state as { axisAngle: number }).axisAngle).toBe(before);
  });

  it("a click while aiming commits with the pointer-derived axis", () => {
    const ctx = ctxFor(emptyDoc(), 4);
    let state = sliderRevoluteTool.reduce(
      sliderRevoluteTool.initial(),
      pointerdown({ x: 0, y: 0 }, noneSnap({ x: 0, y: 0 })),
      ctx,
    ).state;
    state = sliderRevoluteTool.reduce(
      state,
      pointermove({ x: 10, y: 0 }, noneSnap({ x: 10, y: 0 })),
      ctx,
    ).state;
    const result = sliderRevoluteTool.reduce(
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
    let state = sliderRevoluteTool.reduce(
      sliderRevoluteTool.initial(),
      pointerdown({ x: 0, y: 0 }, noneSnap({ x: 0, y: 0 })),
      ctx,
    ).state;
    for (const k of ["4", "5"]) {
      state = sliderRevoluteTool.reduce(state, key(k), ctx).state;
    }
    const result = sliderRevoluteTool.reduce(state, key("Enter"), ctx);
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
    let state = sliderRevoluteTool.reduce(
      sliderRevoluteTool.initial(),
      pointerdown({ x: 0, y: 0 }, noneSnap({ x: 0, y: 0 })),
      ctx,
    ).state;
    state = sliderRevoluteTool.reduce(state, key("9"), ctx).state;
    expect(sliderRevoluteTool.dynamicInput(state)).toEqual({
      field: "angle",
      length: "",
      angle: "9",
    });
  });

  it("an invalid typed angle does not commit", () => {
    const ctx = ctxFor(emptyDoc());
    let state = sliderRevoluteTool.reduce(
      sliderRevoluteTool.initial(),
      pointerdown({ x: 0, y: 0 }, noneSnap({ x: 0, y: 0 })),
      ctx,
    ).state;
    state = sliderRevoluteTool.reduce(state, key("."), ctx).state;
    state = sliderRevoluteTool.reduce(state, key("."), ctx).state;
    const result = sliderRevoluteTool.reduce(state, key("Enter"), ctx);
    // "." then "." (ignored) leaves angle "." which parseNumberInput rejects.
    expect(result.effects).toEqual([]);
  });

  it("Escape/cancel returns to idle", () => {
    const ctx = ctxFor(emptyDoc());
    const state = sliderRevoluteTool.reduce(
      sliderRevoluteTool.initial(),
      pointerdown({ x: 0, y: 0 }, noneSnap({ x: 0, y: 0 })),
      ctx,
    ).state;
    const result = sliderRevoluteTool.reduce(state, key("Escape"), ctx);
    expect(result.state).toEqual({ phase: "idle" });
    const result2 = sliderRevoluteTool.reduce(state, { type: "cancel" }, ctx);
    expect(result2.state).toEqual({ phase: "idle" });
  });

  it("right-click while aiming cancels", () => {
    const ctx = ctxFor(emptyDoc());
    const state = sliderRevoluteTool.reduce(
      sliderRevoluteTool.initial(),
      pointerdown({ x: 0, y: 0 }, noneSnap({ x: 0, y: 0 })),
      ctx,
    ).state;
    const result = sliderRevoluteTool.reduce(
      state,
      pointerdown({ x: 1, y: 1 }, noneSnap({ x: 1, y: 1 }), 2),
      ctx,
    );
    expect(result.state).toEqual({ phase: "idle" });
  });

  it("idle right-click / cancel are unhandled no-ops", () => {
    const ctx = ctxFor(emptyDoc());
    const rightClick = sliderRevoluteTool.reduce(
      sliderRevoluteTool.initial(),
      pointerdown({ x: 0, y: 0 }, noneSnap({ x: 0, y: 0 }), 2),
      ctx,
    );
    expect(rightClick.handled).toBe(false);
    const cancel = sliderRevoluteTool.reduce(sliderRevoluteTool.initial(), { type: "cancel" }, ctx);
    expect(cancel.handled).toBe(false);
  });

  it("hint reflects the current angle while aiming", () => {
    const ctx = ctxFor(emptyDoc());
    let state: SliderRevoluteToolState = sliderRevoluteTool.reduce(
      sliderRevoluteTool.initial(),
      pointerdown({ x: 0, y: 0 }, noneSnap({ x: 0, y: 0 })),
      ctx,
    ).state;
    state = sliderRevoluteTool.reduce(
      state,
      pointermove({ x: 10, y: 0 }, noneSnap({ x: 10, y: 0 })),
      ctx,
    ).state;
    const hint = sliderRevoluteTool.hint(state, ctx);
    expect(hint).toEqual({ key: "tools.sliderRevolute.hint.aim", values: { angle: 0 } });
    expectHintLocalized(hint);
  });

  it("hint is idle by default", () => {
    const ctx = ctxFor(emptyDoc());
    const hint = sliderRevoluteTool.hint(sliderRevoluteTool.initial(), ctx);
    expect(hint).toEqual({ key: "tools.sliderRevolute.hint.idle" });
    expectHintLocalized(hint);
  });

  it("preview is a ray while aiming, empty while idle", () => {
    const ctx = ctxFor(emptyDoc());
    expect(sliderRevoluteTool.preview(sliderRevoluteTool.initial())).toEqual([]);
    const state = sliderRevoluteTool.reduce(
      sliderRevoluteTool.initial(),
      pointerdown({ x: 1, y: 2 }, noneSnap({ x: 1, y: 2 })),
      ctx,
    ).state;
    expect(sliderRevoluteTool.preview(state)).toEqual([
      { kind: "ray", from: { x: 1, y: 2 }, angle: 0 },
    ]);
  });

  it("snapAnchor is the aim point while aiming, undefined while idle", () => {
    const ctx = ctxFor(emptyDoc());
    expect(sliderRevoluteTool.snapAnchor(sliderRevoluteTool.initial())).toBeUndefined();
    const state = sliderRevoluteTool.reduce(
      sliderRevoluteTool.initial(),
      pointerdown({ x: 1, y: 2 }, noneSnap({ x: 1, y: 2 })),
      ctx,
    ).state;
    expect(sliderRevoluteTool.snapAnchor(state)).toEqual({ x: 1, y: 2 });
  });

  it("an unrecognized key is unhandled", () => {
    const ctx = ctxFor(emptyDoc());
    const state = sliderRevoluteTool.reduce(
      sliderRevoluteTool.initial(),
      pointerdown({ x: 0, y: 0 }, noneSnap({ x: 0, y: 0 })),
      ctx,
    ).state;
    const result = sliderRevoluteTool.reduce(state, key("z"), ctx);
    expect(result.handled).toBe(false);
    expect(result.state).toBe(state);
  });

  describe("rail between two moving links", () => {
    // A crank with its tip site at (0, 0) and a vertical rocker bar along x = 0.
    function twoBarDoc(): MechanismDocument {
      return MechanismDocumentSchema.parse({
        schemaVersion: 2,
        links: [
          {
            id: "crank",
            name: "Crank",
            isGround: false,
            pose: { position: [0, 0], angle: 0 },
            shape: { kind: "bar", path: ["c0"] },
            sites: [{ id: "c0", local: [0, 0] }],
          },
          {
            id: "rocker",
            name: "Rocker",
            isGround: false,
            pose: { position: [0, -100], angle: Math.PI / 2 },
            shape: { kind: "bar", path: ["r0", "r1"] },
            sites: [
              { id: "r0", local: [0, 0] },
              { id: "r1", local: [200, 0] },
            ],
          },
        ],
      });
    }

    it("committing over another moving bar slides on it, axis along the bar", () => {
      const ctx = ctxFor(twoBarDoc(), 4);
      let state = sliderRevoluteTool.reduce(
        sliderRevoluteTool.initial(),
        pointerdown({ x: 0, y: 0 }, siteSnap({ x: 0, y: 0 }, "c0", "crank")),
        ctx,
      ).state;
      // Point at the rocker below the anchor (slightly off its line).
      state = sliderRevoluteTool.reduce(
        state,
        pointermove({ x: 1, y: -40 }, noneSnap({ x: 1, y: -40 })),
        ctx,
      ).state;
      expect(sliderRevoluteTool.hint(state, ctx)).toMatchObject({
        key: "tools.sliderRevolute.hint.aimRail",
        values: { rail: "Rocker" },
      });
      const result = sliderRevoluteTool.reduce(
        state,
        pointerdown({ x: 1, y: -40 }, noneSnap({ x: 1, y: -40 })),
        ctx,
      );
      expect(result.effects).toHaveLength(1);
      const effect = result.effects[0] as Extract<ToolEffect, { kind: "commitSlider" }>;
      expect(effect).toMatchObject({ kind: "commitSlider", siteId: "c0", railLinkId: "rocker" });
      // Pointing down the bar: the axis is the bar direction flipped toward the cursor.
      expect(Math.cos(effect.axisAngle)).toBeCloseTo(0);
      expect(Math.sin(effect.axisAngle)).toBeCloseTo(-1);
    });

    it("the anchor's own link is never the rail; empty space means ground", () => {
      const ctx = ctxFor(twoBarDoc(), 4);
      let state = sliderRevoluteTool.reduce(
        sliderRevoluteTool.initial(),
        pointerdown({ x: 0, y: 50 }, siteSnap({ x: 0, y: 50 }, "r0", "rocker")),
        ctx,
      ).state;
      state = sliderRevoluteTool.reduce(
        state,
        pointermove({ x: 0, y: 30 }, noneSnap({ x: 0, y: 30 })),
        ctx,
      ).state;
      expect((state as { railLinkId?: string }).railLinkId).toBeUndefined();
      const result = sliderRevoluteTool.reduce(
        state,
        pointerdown({ x: 50, y: 50 }, noneSnap({ x: 50, y: 50 })),
        ctx,
      );
      expect(result.effects[0]).not.toHaveProperty("railLinkId");
    });

    it("an anchor on a link body pins the block to that link", () => {
      const ctx = ctxFor(twoBarDoc(), 4);
      const state = sliderRevoluteTool.reduce(
        sliderRevoluteTool.initial(),
        pointerdown({ x: 0, y: 20 }, { kind: "link", point: { x: 0, y: 20 }, linkId: "rocker" }),
        ctx,
      ).state;
      expect(state).toMatchObject({ linkId: "rocker", anchorLinkId: "rocker" });
    });
  });
});
