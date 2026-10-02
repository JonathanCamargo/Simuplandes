import { describe, expect, it } from "vitest";
import { degToRad } from "../model/units";
import { MechanismDocumentSchema, type MechanismDocument } from "../model";
import type { SnapResult } from "../canvas/snapping";
import type { ToolContext, ToolEvent } from "./types";
import { barTool, type BarToolState } from "./barTool";
import { expectHintLocalized } from "./machines.test";

function emptyDoc(): MechanismDocument {
  return MechanismDocumentSchema.parse({ schemaVersion: 1 });
}

function docWithSite(): { doc: MechanismDocument; siteId: string; linkId: string } {
  const doc = MechanismDocumentSchema.parse({
    schemaVersion: 1,
    links: [
      {
        id: "link-1",
        name: "Coupler",
        isGround: false,
        pose: { position: [50, 0], angle: 0 },
        shape: { kind: "bar" },
        sites: [{ id: "site-b", name: "B", local: [0, 0] }],
      },
    ],
  });
  return { doc, siteId: "site-b", linkId: "link-1" };
}

function ctxFor(doc: MechanismDocument): ToolContext {
  return { doc, selection: new Set(), radiusWorld: 8, gestureSeed: "test-gesture" };
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

describe("barTool", () => {
  it("idle + pointerdown -> drawing, no effect, busy", () => {
    const ctx = ctxFor(emptyDoc());
    const result = barTool.reduce(
      barTool.initial(),
      pointerdown({ x: 0, y: 0 }, noneSnap({ x: 0, y: 0 })),
      ctx,
    );
    expect(result.effects).toEqual([]);
    expect(result.handled).toBe(true);
    expect(barTool.isBusy(result.state)).toBe(true);
    expect(result.state).toMatchObject({ phase: "drawing", start: { x: 0, y: 0 } });
  });

  it("idle + right-click does nothing", () => {
    const ctx = ctxFor(emptyDoc());
    const result = barTool.reduce(
      barTool.initial(),
      pointerdown({ x: 0, y: 0 }, noneSnap({ x: 0, y: 0 }), 2),
      ctx,
    );
    expect(result.state).toEqual({ phase: "idle" });
    expect(result.effects).toEqual([]);
    expect(result.handled).toBe(false);
  });

  it("idle + pointerdown on a site carries the site id as startSiteId", () => {
    const { doc, siteId, linkId } = docWithSite();
    const ctx = ctxFor(doc);
    const result = barTool.reduce(
      barTool.initial(),
      pointerdown({ x: 50, y: 0 }, siteSnap({ x: 50, y: 0 }, siteId, linkId)),
      ctx,
    );
    expect(result.state).toMatchObject({ phase: "drawing", startSiteId: siteId });
  });

  it("drawing + pointerdown at a different point commits a bar and continues the chain", () => {
    const ctx = ctxFor(emptyDoc());
    const drawing = barTool.reduce(
      barTool.initial(),
      pointerdown({ x: 0, y: 0 }, noneSnap({ x: 0, y: 0 })),
      ctx,
    ).state;
    const result = barTool.reduce(
      drawing,
      pointerdown({ x: 100, y: 0 }, noneSnap({ x: 100, y: 0 })),
      ctx,
    );
    expect(result.effects).toEqual([
      {
        kind: "commitBar",
        start: { x: 0, y: 0 },
        angle: 0,
        length: 100,
        startSiteId: undefined,
        endSiteId: undefined,
      },
    ]);
    expect(result.state).toMatchObject({
      phase: "drawing",
      start: { x: 100, y: 0 },
      chainPendingEndSiteId: true,
    });
    expect(barTool.isBusy(result.state)).toBe(true);
  });

  it("an auto-pin end carries endSiteId on the commit effect", () => {
    const { doc, siteId, linkId } = docWithSite();
    const ctx = ctxFor(doc);
    const drawing = barTool.reduce(
      barTool.initial(),
      pointerdown({ x: 0, y: 0 }, noneSnap({ x: 0, y: 0 })),
      ctx,
    ).state;
    const result = barTool.reduce(
      drawing,
      pointerdown({ x: 50, y: 0 }, siteSnap({ x: 50, y: 0 }, siteId, linkId)),
      ctx,
    );
    expect(result.effects[0]).toMatchObject({ endSiteId: siteId });
  });

  it("drawing + pointerdown at the start point commits nothing and hints zeroLength", () => {
    const ctx = ctxFor(emptyDoc());
    const drawing = barTool.reduce(
      barTool.initial(),
      pointerdown({ x: 10, y: 10 }, noneSnap({ x: 10, y: 10 })),
      ctx,
    ).state;
    const result = barTool.reduce(
      drawing,
      pointerdown({ x: 10, y: 10 }, noneSnap({ x: 10, y: 10 })),
      ctx,
    );
    expect(result.effects).toEqual([]);
    const hint = barTool.hint(result.state, ctx);
    expect(hint).toEqual({ key: "tools.bar.hint.zeroLength" });
    expectHintLocalized(hint);
  });

  it("typing 120 then Enter commits a bar of EXACTLY length 120 in the cursor's direction", () => {
    const ctx = ctxFor(emptyDoc());
    let state: BarToolState = barTool.reduce(
      barTool.initial(),
      pointerdown({ x: 0, y: 0 }, noneSnap({ x: 0, y: 0 })),
      ctx,
    ).state;
    state = barTool.reduce(state, pointermove({ x: 5, y: 5 }, noneSnap({ x: 5, y: 5 })), ctx).state;
    for (const k of ["1", "2", "0"]) {
      state = barTool.reduce(state, key(k), ctx).state;
    }
    const result = barTool.reduce(state, key("Enter"), ctx);
    expect(result.effects).toEqual([
      {
        kind: "commitBar",
        start: { x: 0, y: 0 },
        angle: Math.atan2(5, 5),
        length: 120,
        startSiteId: undefined,
        endSiteId: undefined,
      },
    ]);
  });

  it("typing 120 Tab 30 Enter commits length 120 at exactly 30 degrees", () => {
    const ctx = ctxFor(emptyDoc());
    let state: BarToolState = barTool.reduce(
      barTool.initial(),
      pointerdown({ x: 0, y: 0 }, noneSnap({ x: 0, y: 0 })),
      ctx,
    ).state;
    for (const k of ["1", "2", "0", "Tab", "3", "0"]) {
      state = barTool.reduce(state, key(k), ctx).state;
    }
    const result = barTool.reduce(state, key("Enter"), ctx);
    expect(result.effects).toEqual([
      {
        kind: "commitBar",
        start: { x: 0, y: 0 },
        angle: degToRad(30),
        length: 120,
        startSiteId: undefined,
        endSiteId: undefined,
      },
    ]);
  });

  it("an invalid typed length (0) does not commit", () => {
    const ctx = ctxFor(emptyDoc());
    let state: BarToolState = barTool.reduce(
      barTool.initial(),
      pointerdown({ x: 0, y: 0 }, noneSnap({ x: 0, y: 0 })),
      ctx,
    ).state;
    state = barTool.reduce(state, key("0"), ctx).state;
    const result = barTool.reduce(state, key("Enter"), ctx);
    expect(result.effects).toEqual([]);
    expect(result.state).toBe(state);
  });

  it("committed while chaining sets startSiteId to the new bar's end site", () => {
    const ctx = ctxFor(emptyDoc());
    let state: BarToolState = barTool.reduce(
      barTool.initial(),
      pointerdown({ x: 0, y: 0 }, noneSnap({ x: 0, y: 0 })),
      ctx,
    ).state;
    state = barTool.reduce(
      state,
      pointerdown({ x: 100, y: 0 }, noneSnap({ x: 100, y: 0 })),
      ctx,
    ).state;
    expect(state).toMatchObject({ chainPendingEndSiteId: true, startSiteId: undefined });
    const result = barTool.reduce(
      state,
      { type: "committed", linkId: "link-1", siteIds: ["site-a", "site-b"], createdIds: [] },
      ctx,
    );
    expect(result.state).toMatchObject({ startSiteId: "site-b", chainPendingEndSiteId: false });
  });

  it("committed while NOT chaining-pending is a no-op", () => {
    const ctx = ctxFor(emptyDoc());
    const state: BarToolState = barTool.reduce(
      barTool.initial(),
      pointerdown({ x: 0, y: 0 }, noneSnap({ x: 0, y: 0 })),
      ctx,
    ).state;
    const result = barTool.reduce(
      state,
      { type: "committed", linkId: "link-1", siteIds: ["site-a", "site-b"], createdIds: [] },
      ctx,
    );
    expect(result.state).toBe(state);
  });

  it("Escape while drawing cancels to idle", () => {
    const ctx = ctxFor(emptyDoc());
    const state: BarToolState = barTool.reduce(
      barTool.initial(),
      pointerdown({ x: 0, y: 0 }, noneSnap({ x: 0, y: 0 })),
      ctx,
    ).state;
    const result = barTool.reduce(state, key("Escape"), ctx);
    expect(result.state).toEqual({ phase: "idle" });
    expect(barTool.isBusy(result.state)).toBe(false);
  });

  it("cancel event while drawing goes to idle", () => {
    const ctx = ctxFor(emptyDoc());
    const state: BarToolState = barTool.reduce(
      barTool.initial(),
      pointerdown({ x: 0, y: 0 }, noneSnap({ x: 0, y: 0 })),
      ctx,
    ).state;
    const result = barTool.reduce(state, { type: "cancel" }, ctx);
    expect(result.state).toEqual({ phase: "idle" });
  });

  it("cancel event while idle is a no-op, unhandled", () => {
    const ctx = ctxFor(emptyDoc());
    const result = barTool.reduce(barTool.initial(), { type: "cancel" }, ctx);
    expect(result.state).toEqual({ phase: "idle" });
    expect(result.handled).toBe(false);
  });

  it("right-click while drawing cancels to idle", () => {
    const ctx = ctxFor(emptyDoc());
    const state: BarToolState = barTool.reduce(
      barTool.initial(),
      pointerdown({ x: 0, y: 0 }, noneSnap({ x: 0, y: 0 })),
      ctx,
    ).state;
    const result = barTool.reduce(
      state,
      pointerdown({ x: 10, y: 10 }, noneSnap({ x: 10, y: 10 }), 2),
      ctx,
    );
    expect(result.state).toEqual({ phase: "idle" });
  });

  it("an unrecognized key while drawing is unhandled and doesn't change state", () => {
    const ctx = ctxFor(emptyDoc());
    const state: BarToolState = barTool.reduce(
      barTool.initial(),
      pointerdown({ x: 0, y: 0 }, noneSnap({ x: 0, y: 0 })),
      ctx,
    ).state;
    const result = barTool.reduce(state, key("l"), ctx);
    expect(result.handled).toBe(false);
    expect(result.state).toBe(state);
  });

  describe("hint", () => {
    it("idle", () => {
      const ctx = ctxFor(emptyDoc());
      const hint = barTool.hint(barTool.initial(), ctx);
      expect(hint).toEqual({ key: "tools.bar.hint.idle" });
      expectHintLocalized(hint);
    });

    it("right after the FIRST pointerdown (cursor still at start), hint is drawing, not zeroLength", () => {
      const ctx = ctxFor(emptyDoc());
      const state = barTool.reduce(
        barTool.initial(),
        pointerdown({ x: 0, y: 0 }, noneSnap({ x: 0, y: 0 })),
        ctx,
      ).state;
      const hint = barTool.hint(state, ctx);
      expect(hint).toEqual({ key: "tools.bar.hint.drawing", values: { length: 0, angle: 0 } });
      expectHintLocalized(hint);
    });

    it("drawing, snap on a named site names the target", () => {
      const { doc, siteId, linkId } = docWithSite();
      const ctx = ctxFor(doc);
      let state: BarToolState = barTool.reduce(
        barTool.initial(),
        pointerdown({ x: 0, y: 0 }, noneSnap({ x: 0, y: 0 })),
        ctx,
      ).state;
      state = barTool.reduce(
        state,
        pointermove({ x: 50, y: 0 }, siteSnap({ x: 50, y: 0 }, siteId, linkId)),
        ctx,
      ).state;
      const hint = barTool.hint(state, ctx);
      expect(hint).toEqual({
        key: "tools.bar.hint.drawingPin",
        values: { target: "B" },
      });
      expectHintLocalized(hint);
    });

    it("drawing, plain cursor reports length/angle", () => {
      const ctx = ctxFor(emptyDoc());
      let state: BarToolState = barTool.reduce(
        barTool.initial(),
        pointerdown({ x: 0, y: 0 }, noneSnap({ x: 0, y: 0 })),
        ctx,
      ).state;
      state = barTool.reduce(
        state,
        pointermove({ x: 100, y: 0 }, noneSnap({ x: 100, y: 0 })),
        ctx,
      ).state;
      const hint = barTool.hint(state, ctx);
      expect(hint).toEqual({
        key: "tools.bar.hint.drawing",
        values: { length: 100, angle: 0 },
      });
      expectHintLocalized(hint);
    });
  });

  it("preview is empty while idle, a dashed segment while drawing", () => {
    const ctx = ctxFor(emptyDoc());
    expect(barTool.preview(barTool.initial())).toEqual([]);
    const state = barTool.reduce(
      barTool.initial(),
      pointerdown({ x: 0, y: 0 }, noneSnap({ x: 0, y: 0 })),
      ctx,
    ).state;
    expect(barTool.preview(state)).toEqual([
      { kind: "segment", a: { x: 0, y: 0 }, b: { x: 0, y: 0 }, dashed: true },
    ]);
  });

  it("snapAnchor is undefined while idle, the start point while drawing", () => {
    const ctx = ctxFor(emptyDoc());
    expect(barTool.snapAnchor(barTool.initial())).toBeUndefined();
    const state = barTool.reduce(
      barTool.initial(),
      pointerdown({ x: 1, y: 2 }, noneSnap({ x: 1, y: 2 })),
      ctx,
    ).state;
    expect(barTool.snapAnchor(state)).toEqual({ x: 1, y: 2 });
  });

  it("dynamicInput is undefined while idle, the buffer while drawing", () => {
    const ctx = ctxFor(emptyDoc());
    expect(barTool.dynamicInput(barTool.initial())).toBeUndefined();
    let state: BarToolState = barTool.reduce(
      barTool.initial(),
      pointerdown({ x: 0, y: 0 }, noneSnap({ x: 0, y: 0 })),
      ctx,
    ).state;
    state = barTool.reduce(state, key("1"), ctx).state;
    expect(barTool.dynamicInput(state)).toEqual({ field: "length", length: "1", angle: "" });
  });

  it("pointerup is a no-op (not handled)", () => {
    const ctx = ctxFor(emptyDoc());
    const state: BarToolState = barTool.reduce(
      barTool.initial(),
      pointerdown({ x: 0, y: 0 }, noneSnap({ x: 0, y: 0 })),
      ctx,
    ).state;
    const result = barTool.reduce(
      state,
      {
        type: "pointerup",
        world: { x: 0, y: 0 },
        snap: noneSnap({ x: 0, y: 0 }),
        button: 0,
        shift: false,
        mod: false,
        alt: false,
      },
      ctx,
    );
    expect(result.handled).toBe(false);
    expect(result.state).toBe(state);
  });
});
