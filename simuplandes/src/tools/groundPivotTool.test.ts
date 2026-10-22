import { describe, expect, it } from "vitest";
import { MechanismDocumentSchema, type MechanismDocument } from "../model";
import type { ToolContext, ToolEvent } from "./types";
import { groundPivotTool } from "./groundPivotTool";
import { expectHintLocalized } from "./machines.test";

function emptyDoc(): MechanismDocument {
  return MechanismDocumentSchema.parse({ schemaVersion: 2 });
}

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

/** One bar from (0,0) to (100,0). */
function barDoc(): MechanismDocument {
  return MechanismDocumentSchema.parse({
    schemaVersion: 2,
    links: [
      {
        id: "bar",
        name: "Bar",
        isGround: false,
        pose: { position: [0, 0], angle: 0 },
        shape: { kind: "bar" },
        sites: [
          { id: "s1", local: [0, 0] },
          { id: "s2", local: [100, 0] },
        ],
      },
    ],
  });
}

describe("groundPivotTool", () => {
  it("a click on empty space creates a ground pivot there", () => {
    const ctx = ctxFor(emptyDoc());
    const result = groundPivotTool.reduce(
      groundPivotTool.initial(),
      pointerdown({ x: 5, y: 5 }),
      ctx,
    );
    expect(result.effects).toEqual([{ kind: "commitGroundPivot", at: { x: 5, y: 5 } }]);
    expect(result.state).toEqual({ status: "idle", hoverLinkId: null });
  });

  it("is never busy", () => {
    const ctx = ctxFor(emptyDoc());
    const result = groundPivotTool.reduce(
      groundPivotTool.initial(),
      pointerdown({ x: 5, y: 5 }),
      ctx,
    );
    expect(groundPivotTool.isBusy(result.state)).toBe(false);
    expect(groundPivotTool.isBusy(groundPivotTool.initial())).toBe(false);
  });

  it("a click near a moving-link site pins that site to ground", () => {
    const doc = MechanismDocumentSchema.parse({
      schemaVersion: 2,
      links: [
        {
          id: "moving",
          name: "M",
          isGround: false,
          pose: { position: [10, 0], angle: 0 },
          shape: { kind: "bar" },
          sites: [{ id: "site-1", local: [0, 0] }],
        },
      ],
    });
    const ctx = ctxFor(doc);
    const result = groundPivotTool.reduce(
      groundPivotTool.initial(),
      pointerdown({ x: 10.1, y: 0 }),
      ctx,
    );
    expect(result.effects).toEqual([
      { kind: "commitGroundPivot", at: { x: 10, y: 0 }, siteId: "site-1" },
    ]);
  });

  it("prefers a non-ground, not-already-grounded site over a coincident ground site", () => {
    const doc = MechanismDocumentSchema.parse({
      schemaVersion: 2,
      links: [
        {
          id: "ground",
          name: "Ground",
          isGround: true,
          pose: { position: [0, 0], angle: 0 },
          shape: { kind: "bar" },
          sites: [{ id: "g1", local: [0, 0] }],
        },
        {
          id: "moving",
          name: "M",
          isGround: false,
          pose: { position: [0, 0], angle: 0 },
          shape: { kind: "bar" },
          sites: [{ id: "m1", local: [0, 0] }],
        },
      ],
    });
    const ctx = ctxFor(doc);
    const result = groundPivotTool.reduce(
      groundPivotTool.initial(),
      pointerdown({ x: 0, y: 0 }),
      ctx,
    );
    expect(result.effects).toEqual([
      { kind: "commitGroundPivot", at: { x: 0, y: 0 }, siteId: "m1" },
    ]);
  });

  it("prefers a not-yet-grounded non-ground site over an already-grounded one", () => {
    const doc = MechanismDocumentSchema.parse({
      schemaVersion: 2,
      links: [
        {
          id: "ground",
          name: "Ground",
          isGround: true,
          pose: { position: [0, 0], angle: 0 },
          shape: { kind: "bar" },
          sites: [{ id: "g1", local: [0, 0] }],
        },
        {
          id: "grounded-already",
          name: "A",
          isGround: false,
          pose: { position: [0, 0], angle: 0 },
          shape: { kind: "bar" },
          sites: [{ id: "a1", local: [0, 0] }],
        },
        {
          id: "free",
          name: "B",
          isGround: false,
          pose: { position: [0, 0], angle: 0 },
          shape: { kind: "bar" },
          sites: [{ id: "b1", local: [0, 0] }],
        },
      ],
      joints: [{ id: "j1", type: "R", siteA: "g1", siteB: "a1" }],
    });
    const ctx = ctxFor(doc);
    const result = groundPivotTool.reduce(
      groundPivotTool.initial(),
      pointerdown({ x: 0, y: 0 }),
      ctx,
    );
    expect(result.effects[0]).toMatchObject({ siteId: "b1" });
  });

  it("a click exactly on an existing ground site does nothing, hints alreadyGround", () => {
    const doc = MechanismDocumentSchema.parse({
      schemaVersion: 2,
      links: [
        {
          id: "ground",
          name: "Ground",
          isGround: true,
          pose: { position: [0, 0], angle: 0 },
          shape: { kind: "bar" },
          sites: [{ id: "g1", local: [0, 0] }],
        },
      ],
    });
    const ctx = ctxFor(doc);
    const result = groundPivotTool.reduce(
      groundPivotTool.initial(),
      pointerdown({ x: 0, y: 0 }),
      ctx,
    );
    expect(result.effects).toEqual([]);
    const hint = groundPivotTool.hint(result.state, ctx);
    expect(hint).toEqual({
      key: "tools.groundPivot.hint.alreadyGround",
    });
    expectHintLocalized(hint);
  });

  it("moving the pointer off ground clears the alreadyGround hint", () => {
    const ctx = ctxFor(emptyDoc());
    const afterClick: ReturnType<typeof groundPivotTool.reduce> = {
      state: { status: "alreadyGround" },
      effects: [],
      handled: true,
    };
    const result = groundPivotTool.reduce(afterClick.state, pointermove({ x: 1, y: 1 }), ctx);
    expect(result.state).toEqual({ status: "idle", hoverLinkId: null });
  });

  it("a click on a bar's body pins that point of the bar to ground", () => {
    const ctx = ctxFor(barDoc());
    const result = groundPivotTool.reduce(
      groundPivotTool.initial(),
      pointerdown({ x: 30, y: 4 }),
      ctx,
    );
    expect(result.effects).toEqual([
      { kind: "commitGroundPivot", at: { x: 30, y: 0 }, linkId: "bar" },
    ]);
  });

  it("hovering says whether a click pins a link or places a lone pivot", () => {
    const ctx = ctxFor(barDoc());
    const onBar = groundPivotTool.reduce(
      groundPivotTool.initial(),
      pointermove({ x: 30, y: 2 }),
      ctx,
    ).state;
    const onBarHint = groundPivotTool.hint(onBar, ctx);
    expect(onBarHint).toEqual({ key: "tools.groundPivot.hint.onLink", values: { link: "Bar" } });
    expectHintLocalized(onBarHint);

    const empty = groundPivotTool.reduce(onBar, pointermove({ x: 30, y: 60 }), ctx).state;
    const emptyHint = groundPivotTool.hint(empty, ctx);
    expect(emptyHint).toEqual({ key: "tools.groundPivot.hint.empty" });
    expectHintLocalized(emptyHint);
  });

  it("a site already pinned to ground (and nothing else) hints alreadyGround, on hover and click", () => {
    const doc = MechanismDocumentSchema.parse({
      ...barDoc(),
      links: [
        ...barDoc().links,
        {
          id: "ground",
          name: "Ground",
          isGround: true,
          pose: { position: [0, 0], angle: 0 },
          shape: { kind: "bar" },
          sites: [{ id: "g1", local: [0, 0] }],
        },
      ],
      joints: [{ id: "j1", name: "", type: "R", siteA: "g1", siteB: "s1" }],
    });
    const ctx = ctxFor(doc);
    const hovered = groundPivotTool.reduce(
      groundPivotTool.initial(),
      pointermove({ x: 1, y: 0 }),
      ctx,
    );
    expect(hovered.state.status).toBe("alreadyGround");
    const clicked = groundPivotTool.reduce(hovered.state, pointerdown({ x: 1, y: 0 }), ctx);
    expect(clicked.effects).toEqual([]);
    expect(clicked.state.status).toBe("alreadyGround");
  });

  it("snaps to points on links as well as sites and the grid", () => {
    expect(groundPivotTool.snapKinds).toEqual({ link: true });
  });

  it("right-click is a no-op", () => {
    const ctx = ctxFor(emptyDoc());
    const result = groundPivotTool.reduce(
      groundPivotTool.initial(),
      pointerdown({ x: 0, y: 0 }, 2),
      ctx,
    );
    expect(result.effects).toEqual([]);
    expect(result.handled).toBe(false);
  });

  it("hint is idle by default", () => {
    const ctx = ctxFor(emptyDoc());
    const hint = groundPivotTool.hint(groundPivotTool.initial(), ctx);
    expect(hint).toEqual({
      key: "tools.groundPivot.hint.idle",
    });
    expectHintLocalized(hint);
  });

  it("preview/snapAnchor/dynamicInput are all empty/undefined", () => {
    const state = groundPivotTool.initial();
    expect(groundPivotTool.preview(state)).toEqual([]);
    expect(groundPivotTool.snapAnchor(state)).toBeUndefined();
    expect(groundPivotTool.dynamicInput(state)).toBeUndefined();
  });

  it("key/cancel events are unhandled no-ops", () => {
    const ctx = ctxFor(emptyDoc());
    const result = groundPivotTool.reduce(
      groundPivotTool.initial(),
      { type: "key", key: "g", shift: false, mod: false, alt: false },
      ctx,
    );
    expect(result.handled).toBe(false);
    const cancelResult = groundPivotTool.reduce(groundPivotTool.initial(), { type: "cancel" }, ctx);
    expect(cancelResult.handled).toBe(false);
  });
});
