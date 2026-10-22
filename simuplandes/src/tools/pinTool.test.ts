import { describe, expect, it } from "vitest";
import { MechanismDocumentSchema, type MechanismDocument } from "../model";
import type { ToolContext, ToolEvent } from "./types";
import { pinTool, type PinToolState } from "./pinTool";
import { expectHintLocalized } from "./machines.test";

function ctxFor(doc: MechanismDocument, radiusWorld = 8): ToolContext {
  return { doc, selection: new Set(), radiusWorld, gestureSeed: "test-gesture" };
}

function pointerdown(world: { x: number; y: number }, button = 0): ToolEvent {
  return {
    type: "pointerdown",
    world,
    snap: { kind: "none", point: world },
    button,
    shift: false,
    mod: false,
    alt: false,
  };
}

function pointermove(world: { x: number; y: number }): ToolEvent {
  return {
    type: "pointermove",
    world,
    snap: { kind: "none", point: world },
    button: -1,
    shift: false,
    mod: false,
    alt: false,
  };
}

function bar(id: string, from: [number, number], to: [number, number]) {
  const angle = Math.atan2(to[1] - from[1], to[0] - from[0]);
  const length = Math.hypot(to[0] - from[0], to[1] - from[1]);
  return {
    id,
    name: id.toUpperCase(),
    isGround: false,
    pose: { position: from, angle },
    shape: { kind: "bar" },
    sites: [
      { id: `${id}1`, local: [0, 0] },
      { id: `${id}2`, local: [length, 0] },
    ],
  };
}

/** A horizontal bar `h` (0,0)-(100,0) and a vertical bar `v` (50,-50)-(50,50) crossing it at (50,0). */
function crossDoc(extra: object[] = []): MechanismDocument {
  return MechanismDocumentSchema.parse({
    schemaVersion: 2,
    links: [bar("h", [0, 0], [100, 0]), bar("v", [50, -50], [50, 50]), ...extra],
  });
}

function closeTo(p: { x: number; y: number }, x: number, y: number): void {
  expect(p.x).toBeCloseTo(x, 9);
  expect(p.y).toBeCloseTo(y, 9);
}

describe("pinTool: one click where two links meet", () => {
  it("pins two crossing bars at their crossing, adding a site on each", () => {
    const ctx = ctxFor(crossDoc());
    const result = pinTool.reduce(pinTool.initial(), pointerdown({ x: 52, y: 3 }), ctx);
    expect(result.effects).toHaveLength(1);
    const effect = result.effects[0];
    if (effect.kind !== "commitPin") throw new Error("expected commitPin");
    expect(effect.a.kind).toBe("link");
    expect(effect.b.kind).toBe("link");
    if (effect.a.kind !== "link" || effect.b.kind !== "link") return;
    expect(new Set([effect.a.linkId, effect.b.linkId])).toEqual(new Set(["h", "v"]));
    closeTo(effect.a.at, 50, 0);
    closeTo(effect.b.at, 50, 0);
    expect(pinTool.isBusy(result.state)).toBe(false);
  });

  it("pins a bar's end site to the body of the bar it lies on, at the site", () => {
    const ctx = ctxFor(crossDoc([bar("b", [70, 0], [70, 80])]));
    const result = pinTool.reduce(pinTool.initial(), pointerdown({ x: 71, y: 2 }), ctx);
    expect(result.effects).toEqual([
      {
        kind: "commitPin",
        a: { kind: "site", siteId: "b1" },
        b: { kind: "link", linkId: "h", at: { x: 70, y: 0 } },
      },
    ]);
  });

  it("pins two coincident sites of different links", () => {
    const ctx = ctxFor(crossDoc([bar("b", [0, 0], [0, 80])]));
    const result = pinTool.reduce(pinTool.initial(), pointerdown({ x: 1, y: 1 }), ctx);
    expect(result.effects).toEqual([
      { kind: "commitPin", a: { kind: "site", siteId: "h1" }, b: { kind: "site", siteId: "b1" } },
    ]);
  });

  it("an already-pinned pair hints alreadyPinned and commits nothing", () => {
    const doc: MechanismDocument = {
      ...crossDoc([bar("b", [0, 0], [0, 80])]),
      joints: [{ id: "j1", name: "", type: "R", siteA: "h1", siteB: "b1" }],
    };
    const ctx = ctxFor(doc);
    const result = pinTool.reduce(pinTool.initial(), pointerdown({ x: 0, y: 0 }), ctx);
    expect(result.effects).toEqual([]);
    const hint = pinTool.hint(result.state, ctx);
    expect(hint).toEqual({ key: "tools.pin.hint.alreadyPinned" });
    expectHintLocalized(hint);
  });
});

describe("pinTool: two clicks", () => {
  function pickOnH(ctx: ToolContext): PinToolState {
    return pinTool.reduce(pinTool.initial(), pointerdown({ x: 20, y: 3 }), ctx).state;
  }

  it("a click on one link's body picks that point (busy)", () => {
    const ctx = ctxFor(crossDoc());
    const state = pickOnH(ctx);
    expect(state).toMatchObject({
      phase: "pickedA",
      a: { kind: "link", linkId: "h" },
      linkA: "h",
    });
    if (state.phase !== "pickedA") return;
    closeTo(state.at, 20, 0);
    expect(pinTool.isBusy(state)).toBe(true);
  });

  it("a second click on another link commits the pin between the two points", () => {
    const ctx = ctxFor(crossDoc());
    const result = pinTool.reduce(pickOnH(ctx), pointerdown({ x: 48, y: 30 }), ctx);
    expect(result.effects).toHaveLength(1);
    const effect = result.effects[0];
    if (effect.kind !== "commitPin" || effect.b.kind !== "link") throw new Error("bad effect");
    expect(effect.a).toMatchObject({ kind: "link", linkId: "h" });
    expect(effect.b.linkId).toBe("v");
    closeTo(effect.b.at, 50, 30);
    expect(result.state.phase).toBe("idle");
  });

  it("a second click on the same link hints differentLink", () => {
    const ctx = ctxFor(crossDoc());
    const result = pinTool.reduce(pickOnH(ctx), pointerdown({ x: 90, y: 0 }), ctx);
    expect(result.effects).toEqual([]);
    const hint = pinTool.hint(result.state, ctx);
    expect(hint).toEqual({ key: "tools.pin.hint.differentLink" });
    expectHintLocalized(hint);
    expect(pinTool.isBusy(result.state)).toBe(true);
  });

  it("a second click on empty space hints needLink and stays picked", () => {
    const ctx = ctxFor(crossDoc());
    const result = pinTool.reduce(pickOnH(ctx), pointerdown({ x: 300, y: 300 }), ctx);
    expect(result.effects).toEqual([]);
    expect(pinTool.hint(result.state, ctx)).toEqual({ key: "tools.pin.hint.needLink" });
    expect(pinTool.isBusy(result.state)).toBe(true);
  });

  it("Escape (cancel) and right-click from pickedA return to idle", () => {
    const ctx = ctxFor(crossDoc());
    const cancelled = pinTool.reduce(pickOnH(ctx), { type: "cancel" }, ctx);
    expect(cancelled.state).toEqual({ phase: "idle" });
    expect(cancelled.handled).toBe(true);
    const rightClick = pinTool.reduce(pickOnH(ctx), pointerdown({ x: 5, y: 5 }, 2), ctx);
    expect(rightClick.state).toEqual({ phase: "idle" });
  });

  it("while picked, the hint names the link under the cursor and a dashed line follows it", () => {
    const ctx = ctxFor(crossDoc());
    const state = pinTool.reduce(pickOnH(ctx), pointermove({ x: 50, y: 30 }), ctx).state;
    const hint = pinTool.hint(state, ctx);
    expect(hint).toEqual({ key: "tools.pin.hint.pinTo", values: { link: "H", target: "V" } });
    expectHintLocalized(hint);
    const preview = pinTool.preview(state);
    expect(preview[0].kind).toBe("point");
    expect(preview[1]).toMatchObject({ kind: "segment", b: { x: 50, y: 30 }, dashed: true });
    expect(preview.some((shape) => shape.kind === "blocked")).toBe(false);

    const away = pinTool.reduce(state, pointermove({ x: 300, y: 300 }), ctx).state;
    expect(pinTool.hint(away, ctx)).toEqual({
      key: "tools.pin.hint.pickSecond",
      values: { link: "H" },
    });
    expect(pinTool.preview(away).at(-1)).toEqual({ kind: "blocked", at: { x: 300, y: 300 } });
  });
});

describe("pinTool: hover cues while idle", () => {
  it("empty space: noTarget hint and a blocked mark", () => {
    const ctx = ctxFor(crossDoc());
    const state = pinTool.reduce(pinTool.initial(), pointermove({ x: 300, y: 300 }), ctx).state;
    const hint = pinTool.hint(state, ctx);
    expect(hint).toEqual({ key: "tools.pin.hint.noTarget" });
    expectHintLocalized(hint);
    expect(pinTool.preview(state)).toEqual([{ kind: "blocked", at: { x: 300, y: 300 } }]);
  });

  it("one link: oneLink hint, no blocked mark", () => {
    const ctx = ctxFor(crossDoc());
    const state = pinTool.reduce(pinTool.initial(), pointermove({ x: 20, y: 2 }), ctx).state;
    const hint = pinTool.hint(state, ctx);
    expect(hint).toEqual({ key: "tools.pin.hint.oneLink", values: { link: "H" } });
    expectHintLocalized(hint);
    expect(pinTool.preview(state)).toEqual([]);
  });

  it("a crossing: pinHere hint naming both links", () => {
    const ctx = ctxFor(crossDoc());
    const state = pinTool.reduce(pinTool.initial(), pointermove({ x: 50, y: 1 }), ctx).state;
    const hint = pinTool.hint(state, ctx);
    expect(hint).toEqual({ key: "tools.pin.hint.pinHere", values: { a: "V", b: "H" } });
    expectHintLocalized(hint);
  });

  it("a click on empty space hints needLink; moving clears it", () => {
    const ctx = ctxFor(crossDoc());
    const clicked = pinTool.reduce(pinTool.initial(), pointerdown({ x: 300, y: 300 }), ctx);
    expect(clicked.effects).toEqual([]);
    const hint = pinTool.hint(clicked.state, ctx);
    expect(hint).toEqual({ key: "tools.pin.hint.needLink" });
    expectHintLocalized(hint);
    const moved = pinTool.reduce(clicked.state, pointermove({ x: 301, y: 300 }), ctx).state;
    expect(pinTool.hint(moved, ctx)).toEqual({ key: "tools.pin.hint.noTarget" });
  });

  it("the idle hint before any move", () => {
    const ctx = ctxFor(crossDoc());
    const hint = pinTool.hint(pinTool.initial(), ctx);
    expect(hint).toEqual({ key: "tools.pin.hint.idle" });
    expectHintLocalized(hint);
    expect(pinTool.preview(pinTool.initial())).toEqual([]);
  });
});

describe("pinTool: contract", () => {
  it("snaps only to points a pin can use", () => {
    expect(pinTool.snapKinds).toEqual({ grid: false, angle: false, link: true });
    expect(pinTool.snapAnchor(pinTool.initial())).toBeUndefined();
  });

  it("cancel/right-click while idle are unhandled no-ops", () => {
    const ctx = ctxFor(crossDoc());
    expect(pinTool.reduce(pinTool.initial(), { type: "cancel" }, ctx).handled).toBe(false);
    expect(pinTool.reduce(pinTool.initial(), pointerdown({ x: 0, y: 0 }, 2), ctx).handled).toBe(
      false,
    );
  });

  it("key events are unhandled and dynamicInput is always undefined", () => {
    const ctx = ctxFor(crossDoc());
    const result = pinTool.reduce(
      pinTool.initial(),
      { type: "key", key: "j", shift: false, mod: false, alt: false },
      ctx,
    );
    expect(result.handled).toBe(false);
    expect(pinTool.dynamicInput(pinTool.initial())).toBeUndefined();
  });
});
