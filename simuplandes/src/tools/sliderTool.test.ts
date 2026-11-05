import { describe, expect, it } from "vitest";
import { MechanismDocumentSchema, type MechanismDocument } from "../model";
import type { SnapResult } from "../canvas/snapping";
import type { ToolContext, ToolEffect, ToolEvent } from "./types";
import { sliderTool, type SliderToolState } from "./sliderTool";
import { expectHintLocalized } from "./machines.test";

// A rod (horizontal bar, sites at (0,0) and (100,0)) and a vertical
// cylinder bar along x = 200, plus a ground pivot site at (-50, 0).
function doc(): MechanismDocument {
  return MechanismDocumentSchema.parse({
    schemaVersion: 2,
    links: [
      {
        id: "ground",
        name: "Ground",
        isGround: true,
        pose: { position: [0, 0], angle: 0 },
        shape: { kind: "bar", path: ["g0"] },
        sites: [{ id: "g0", local: [-50, 0] }],
      },
      {
        id: "rod",
        name: "Rod",
        isGround: false,
        pose: { position: [0, 0], angle: 0 },
        shape: { kind: "bar", path: ["r0", "r1"] },
        sites: [
          { id: "r0", local: [0, 0] },
          { id: "r1", local: [100, 0] },
        ],
      },
      {
        id: "cyl",
        name: "Cylinder",
        isGround: false,
        pose: { position: [200, -100], angle: Math.PI / 2 },
        shape: { kind: "bar", path: ["c0", "c1"] },
        sites: [
          { id: "c0", local: [0, 0] },
          { id: "c1", local: [200, 0] },
        ],
      },
    ],
  });
}

function ctxFor(d: MechanismDocument = doc()): ToolContext {
  return { doc: d, selection: new Set(), radiusWorld: 4, gestureSeed: "test-gesture" };
}

const none = (p: { x: number; y: number }): SnapResult => ({ kind: "none", point: p });
const site = (p: { x: number; y: number }, siteId: string, linkId: string): SnapResult => ({
  kind: "site",
  point: p,
  siteId,
  linkId,
});

function down(
  world: { x: number; y: number },
  snap: SnapResult = none(world),
  button = 0,
): ToolEvent {
  return { type: "pointerdown", world, snap, button, shift: false, mod: false, alt: false };
}

function move(world: { x: number; y: number }, snap: SnapResult = none(world)): ToolEvent {
  return { type: "pointermove", world, snap, button: -1, shift: false, mod: false, alt: false };
}

function key(k: string): ToolEvent {
  return { type: "key", key: k, shift: false, mod: false, alt: false };
}

function run(events: ToolEvent[], ctx = ctxFor()) {
  let state: SliderToolState = sliderTool.initial();
  let effects: ToolEffect[] = [];
  for (const event of events) {
    const result = sliderTool.reduce(state, event, ctx);
    state = result.state;
    effects = result.effects;
  }
  return { state, effects };
}

describe("sliderTool (pure prismatic)", () => {
  it("a click in empty space does nothing but asks for a part", () => {
    const { state, effects } = run([down({ x: 500, y: 500 })]);
    expect(state).toEqual({ phase: "idle", lastMessage: "needLink" });
    expect(effects).toEqual([]);
    expect(sliderTool.hint(state, ctxFor()).key).toBe("tools.slider.hint.needLink");
    expectHintLocalized(sliderTool.hint(state, ctxFor()));
  });

  it("site on one part, then click on another bar: P joint between them, axis along the bar", () => {
    const { state, effects } = run([
      down({ x: 100, y: 0 }, site({ x: 100, y: 0 }, "r1", "rod")),
      move({ x: 201, y: 50 }),
      down({ x: 201, y: 50 }),
    ]);
    expect(state).toEqual({ phase: "idle" });
    expect(effects).toHaveLength(1);
    const effect = effects[0] as Extract<ToolEffect, { kind: "commitPrismatic" }>;
    expect(effect).toMatchObject({
      kind: "commitPrismatic",
      block: { kind: "site", siteId: "r1" },
      at: { x: 100, y: 0 },
      railLinkId: "cyl",
    });
    // The cylinder is vertical; the cursor is above the anchor, so the axis points +y.
    expect(Math.cos(effect.axisAngle)).toBeCloseTo(0);
    expect(Math.sin(effect.axisAngle)).toBeCloseTo(1);
  });

  it("a click on a part's body anchors the block there", () => {
    const { state } = run([
      down({ x: 40, y: 1 }, { kind: "link", point: { x: 40, y: 0 }, linkId: "rod" }),
    ]);
    expect(state).toMatchObject({
      phase: "aiming",
      at: { x: 40, y: 0 },
      block: { kind: "link", linkId: "rod", at: { x: 40, y: 0 } },
      anchorLinkId: "rod",
    });
  });

  it("a commit in empty space slides on ground at the aimed angle", () => {
    const { effects } = run([
      down({ x: 0, y: 0 }, site({ x: 0, y: 0 }, "r0", "rod")),
      move({ x: -30, y: 0 }),
      down({ x: -30, y: 0 }),
    ]);
    expect(effects[0]).toMatchObject({
      kind: "commitPrismatic",
      block: { kind: "site", siteId: "r0" },
    });
    expect(effects[0]).not.toHaveProperty("railLinkId");
    expect((effects[0] as { axisAngle: number }).axisAngle).toBeCloseTo(Math.PI);
  });

  it("the anchor's own part is never the guide", () => {
    const { state } = run([
      down({ x: 0, y: 0 }, site({ x: 0, y: 0 }, "r0", "rod")),
      move({ x: 60, y: 0 }),
    ]);
    expect(state).toMatchObject({ phase: "aiming" });
    expect(state).not.toHaveProperty("railLinkId", "rod");
    expect((state as { railLinkId?: string }).railLinkId).toBeUndefined();
  });

  it("a ground anchor needs a moving guide: empty-space commit is refused", () => {
    const ctx = ctxFor();
    const { state, effects } = run(
      [down({ x: -50, y: 0 }, site({ x: -50, y: 0 }, "g0", "ground")), down({ x: -50, y: 80 })],
      ctx,
    );
    expect(effects).toEqual([]);
    expect(state.phase).toBe("aiming");
    expect(sliderTool.hint(state, ctx).key).toBe("tools.slider.hint.needRail");
    expectHintLocalized(sliderTool.hint(state, ctx));

    const result = sliderTool.reduce(
      state,
      down({ x: 0, y: 0 }, site({ x: 0, y: 0 }, "r0", "rod")),
      ctx,
    );
    expect(result.effects[0]).toMatchObject({
      kind: "commitPrismatic",
      block: { kind: "site", siteId: "g0" },
      railLinkId: "rod",
    });
  });

  it("Enter commits a typed angle with the last hovered guide", () => {
    const { effects } = run([
      down({ x: 100, y: 0 }, site({ x: 100, y: 0 }, "r1", "rod")),
      move({ x: 200, y: 20 }),
      key("4"),
      key("5"),
      key("Enter"),
    ]);
    expect(effects[0]).toMatchObject({ kind: "commitPrismatic", railLinkId: "cyl" });
    expect((effects[0] as { axisAngle: number }).axisAngle).toBeCloseTo(Math.PI / 4);
  });

  it("hints are localized while aiming, with and without a guide", () => {
    const ctx = ctxFor();
    const aiming = run([down({ x: 0, y: 0 }, site({ x: 0, y: 0 }, "r0", "rod"))], ctx).state;
    expect(sliderTool.hint(aiming, ctx).key).toBe("tools.slider.hint.aim");
    expectHintLocalized(sliderTool.hint(aiming, ctx));
    const onRail = sliderTool.reduce(aiming, move({ x: 200, y: 0 }), ctx).state;
    expect(sliderTool.hint(onRail, ctx)).toMatchObject({
      key: "tools.slider.hint.aimRail",
      values: { rail: "Cylinder" },
    });
    expectHintLocalized(sliderTool.hint(onRail, ctx));
  });

  it("Escape and right-click cancel", () => {
    expect(
      run([down({ x: 0, y: 0 }, site({ x: 0, y: 0 }, "r0", "rod")), { type: "cancel" }]).state,
    ).toEqual({
      phase: "idle",
    });
    expect(
      run([
        down({ x: 0, y: 0 }, site({ x: 0, y: 0 }, "r0", "rod")),
        down({ x: 5, y: 5 }, none({ x: 5, y: 5 }), 2),
      ]).state,
    ).toEqual({ phase: "idle" });
  });
});
