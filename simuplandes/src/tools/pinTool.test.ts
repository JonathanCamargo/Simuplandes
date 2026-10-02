import { describe, expect, it } from "vitest";
import { MechanismDocumentSchema, type MechanismDocument } from "../model";
import type { SnapResult } from "../canvas/snapping";
import type { ToolContext, ToolEvent } from "./types";
import { pinTool, type PinToolState } from "./pinTool";
import { expectHintLocalized } from "./machines.test";

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

function twoLinkDoc(): MechanismDocument {
  return MechanismDocumentSchema.parse({
    schemaVersion: 1,
    links: [
      {
        id: "link-a",
        name: "A",
        isGround: false,
        pose: { position: [0, 0], angle: 0 },
        shape: { kind: "bar" },
        sites: [
          { id: "a1", local: [0, 0] },
          { id: "a2", local: [10, 0] },
        ],
      },
      {
        id: "link-b",
        name: "B",
        isGround: false,
        pose: { position: [0, 0], angle: 0 },
        shape: { kind: "bar" },
        sites: [{ id: "b1", local: [0, 0] }],
      },
    ],
  });
}

describe("pinTool", () => {
  it("click site A moves to pickedA (busy)", () => {
    const ctx = ctxFor(twoLinkDoc());
    const result = pinTool.reduce(
      pinTool.initial(),
      pointerdown({ x: 0, y: 0 }, siteSnap({ x: 0, y: 0 }, "a1", "link-a")),
      ctx,
    );
    expect(result.state).toEqual({
      phase: "pickedA",
      siteA: "a1",
      linkA: "link-a",
      at: { x: 0, y: 0 },
    });
    expect(pinTool.isBusy(result.state)).toBe(true);
  });

  it("click on empty space (no site) hints needSite, stays idle, not busy", () => {
    const ctx = ctxFor(twoLinkDoc());
    const result = pinTool.reduce(
      pinTool.initial(),
      pointerdown({ x: 999, y: 999 }, noneSnap({ x: 999, y: 999 })),
      ctx,
    );
    expect(pinTool.isBusy(result.state)).toBe(false);
    const hint = pinTool.hint(result.state, ctx);
    expect(hint).toEqual({ key: "tools.pin.hint.needSite" });
    expectHintLocalized(hint);
  });

  it("picking a site on a different link commits an R joint", () => {
    const ctx = ctxFor(twoLinkDoc());
    const pickedA = pinTool.reduce(
      pinTool.initial(),
      pointerdown({ x: 0, y: 0 }, siteSnap({ x: 0, y: 0 }, "a1", "link-a")),
      ctx,
    ).state;
    const result = pinTool.reduce(
      pickedA,
      pointerdown({ x: 0, y: 0 }, siteSnap({ x: 0, y: 0 }, "b1", "link-b")),
      ctx,
    );
    expect(result.effects).toEqual([{ kind: "commitPin", siteA: "a1", siteB: "b1" }]);
    expect(result.state).toEqual({ phase: "idle" });
  });

  it("a same-link-only candidate hints differentLink and stays pickedA", () => {
    const ctx = ctxFor(twoLinkDoc());
    const pickedA = pinTool.reduce(
      pinTool.initial(),
      pointerdown({ x: 0, y: 0 }, siteSnap({ x: 0, y: 0 }, "a1", "link-a")),
      ctx,
    ).state;
    const result = pinTool.reduce(
      pickedA,
      pointerdown({ x: 10, y: 0 }, siteSnap({ x: 10, y: 0 }, "a2", "link-a")),
      ctx,
    );
    expect(result.effects).toEqual([]);
    const hint = pinTool.hint(result.state, ctx);
    expect(hint).toEqual({ key: "tools.pin.hint.differentLink" });
    expectHintLocalized(hint);
    expect(pinTool.isBusy(result.state)).toBe(true);
  });

  it("an already-joined pair hints alreadyPinned", () => {
    const doc: MechanismDocument = {
      ...twoLinkDoc(),
      joints: [{ id: "j1", name: "", type: "R", siteA: "a1", siteB: "b1" }],
    };
    const ctx = ctxFor(doc);
    const pickedA = pinTool.reduce(
      pinTool.initial(),
      pointerdown({ x: 0, y: 0 }, siteSnap({ x: 0, y: 0 }, "a1", "link-a")),
      ctx,
    ).state;
    const result = pinTool.reduce(
      pickedA,
      pointerdown({ x: 0, y: 0 }, siteSnap({ x: 0, y: 0 }, "b1", "link-b")),
      ctx,
    );
    expect(result.effects).toEqual([]);
    const hint = pinTool.hint(result.state, ctx);
    expect(hint).toEqual({ key: "tools.pin.hint.alreadyPinned" });
    expectHintLocalized(hint);
  });

  it("a click with no candidates near it keeps pickedA, clears the message", () => {
    const ctx = ctxFor(twoLinkDoc());
    let state: PinToolState = pinTool.reduce(
      pinTool.initial(),
      pointerdown({ x: 0, y: 0 }, siteSnap({ x: 0, y: 0 }, "a1", "link-a")),
      ctx,
    ).state;
    state = pinTool.reduce(
      state,
      pointerdown({ x: 10, y: 0 }, siteSnap({ x: 10, y: 0 }, "a2", "link-a")),
      ctx,
    ).state; // sets differentLink message
    const result = pinTool.reduce(
      state,
      pointerdown({ x: 999, y: 999 }, noneSnap({ x: 999, y: 999 })),
      ctx,
    );
    expect(result.state).toMatchObject({ phase: "pickedA", lastMessage: undefined });
  });

  it("Escape from pickedA cancels to idle", () => {
    const ctx = ctxFor(twoLinkDoc());
    const pickedA = pinTool.reduce(
      pinTool.initial(),
      pointerdown({ x: 0, y: 0 }, siteSnap({ x: 0, y: 0 }, "a1", "link-a")),
      ctx,
    ).state;
    const result = pinTool.reduce(pickedA, { type: "cancel" }, ctx);
    expect(result.state).toEqual({ phase: "idle" });
    expect(result.handled).toBe(true);
  });

  it("right-click from pickedA cancels to idle", () => {
    const ctx = ctxFor(twoLinkDoc());
    const pickedA = pinTool.reduce(
      pinTool.initial(),
      pointerdown({ x: 0, y: 0 }, siteSnap({ x: 0, y: 0 }, "a1", "link-a")),
      ctx,
    ).state;
    const result = pinTool.reduce(
      pickedA,
      pointerdown({ x: 5, y: 5 }, noneSnap({ x: 5, y: 5 }), 2),
      ctx,
    );
    expect(result.state).toEqual({ phase: "idle" });
  });

  it("cancel/right-click while idle are unhandled no-ops", () => {
    const ctx = ctxFor(twoLinkDoc());
    const cancelResult = pinTool.reduce(pinTool.initial(), { type: "cancel" }, ctx);
    expect(cancelResult.handled).toBe(false);
    const rightClick = pinTool.reduce(
      pinTool.initial(),
      pointerdown({ x: 0, y: 0 }, noneSnap({ x: 0, y: 0 }), 2),
      ctx,
    );
    expect(rightClick.handled).toBe(false);
  });

  it("pointermove clears a stale needSite message while idle", () => {
    const ctx = ctxFor(twoLinkDoc());
    const withMessage: PinToolState = { phase: "idle", lastMessage: "needSite" };
    const result = pinTool.reduce(
      withMessage,
      pointermove({ x: 1, y: 1 }, noneSnap({ x: 1, y: 1 })),
      ctx,
    );
    expect(result.state).toEqual({ phase: "idle" });
  });

  it("hint is pickSecond while pickedA with no message", () => {
    const ctx = ctxFor(twoLinkDoc());
    const pickedA = pinTool.reduce(
      pinTool.initial(),
      pointerdown({ x: 0, y: 0 }, siteSnap({ x: 0, y: 0 }, "a1", "link-a")),
      ctx,
    ).state;
    const hint = pinTool.hint(pickedA, ctx);
    expect(hint).toEqual({ key: "tools.pin.hint.pickSecond" });
    expectHintLocalized(hint);
  });

  it("hint is idle by default", () => {
    const ctx = ctxFor(twoLinkDoc());
    const hint = pinTool.hint(pinTool.initial(), ctx);
    expect(hint).toEqual({ key: "tools.pin.hint.idle" });
    expectHintLocalized(hint);
  });

  it("preview/snapAnchor are undefined/empty while idle, populated while pickedA", () => {
    const ctx = ctxFor(twoLinkDoc());
    expect(pinTool.preview(pinTool.initial())).toEqual([]);
    expect(pinTool.snapAnchor(pinTool.initial())).toBeUndefined();
    const pickedA = pinTool.reduce(
      pinTool.initial(),
      pointerdown({ x: 0, y: 0 }, siteSnap({ x: 0, y: 0 }, "a1", "link-a")),
      ctx,
    ).state;
    expect(pinTool.preview(pickedA)).toEqual([{ kind: "point", at: { x: 0, y: 0 } }]);
    expect(pinTool.snapAnchor(pickedA)).toEqual({ x: 0, y: 0 });
  });

  it("dynamicInput is always undefined", () => {
    expect(pinTool.dynamicInput(pinTool.initial())).toBeUndefined();
  });

  it("key events are unhandled no-ops", () => {
    const ctx = ctxFor(twoLinkDoc());
    const result = pinTool.reduce(
      pinTool.initial(),
      { type: "key", key: "j", shift: false, mod: false, alt: false },
      ctx,
    );
    expect(result.handled).toBe(false);
  });
});
