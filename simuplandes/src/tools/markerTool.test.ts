import { describe, expect, it } from "vitest";
import { MechanismDocumentSchema, worldToLinkLocal, type MechanismDocument } from "../model";
import { createMechanismStore } from "../store";
import { applyToolEffects } from "./effects";
import { markerTool } from "./markerTool";
import { expectHintLocalized } from "./machines.test";
import type { ToolContext, ToolEvent } from "./types";

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

const GROUND_AND_COUPLER: MechanismDocument = MechanismDocumentSchema.parse({
  schemaVersion: 1,
  links: [
    {
      id: "link-ground",
      name: "Ground",
      isGround: true,
      pose: { position: [0, 0], angle: 0 },
      shape: { kind: "bar" },
      sites: [{ id: "site-g", local: [0, 0] }],
    },
    {
      id: "link-coupler",
      name: "Coupler",
      isGround: false,
      pose: { position: [10, 0], angle: Math.PI / 4 },
      shape: { kind: "bar" },
      sites: [
        { id: "site-a", local: [0, 0] },
        { id: "site-b", local: [50, 0] },
      ],
    },
  ],
});

describe("markerTool", () => {
  it("a click on a non-ground link body adds a marker at the link-local snap point", () => {
    const ctx = ctxFor(GROUND_AND_COUPLER);
    const clickWorld = { x: 30, y: 10 };
    const result = markerTool.reduce(markerTool.initial(), pointerdown(clickWorld), ctx);
    const link = GROUND_AND_COUPLER.links.find((l) => l.id === "link-coupler")!;
    expect(result.effects).toEqual([
      { kind: "addMarker", linkId: "link-coupler", local: worldToLinkLocal(link.pose, clickWorld) },
    ]);
    expect(result.handled).toBe(true);
  });

  it("a click on a non-ground link's site also adds a marker there", () => {
    const ctx = ctxFor(GROUND_AND_COUPLER);
    const result = markerTool.reduce(markerTool.initial(), pointerdown({ x: 10, y: 0 }), ctx);
    expect(result.effects).toEqual([{ kind: "addMarker", linkId: "link-coupler", local: [0, 0] }]);
  });

  it("a click on ground hints needLink, no effect", () => {
    const ctx = ctxFor(GROUND_AND_COUPLER);
    const result = markerTool.reduce(markerTool.initial(), pointerdown({ x: 0, y: 0 }), ctx);
    expect(result.effects).toEqual([]);
    expect(result.handled).toBe(true);
    const hint = markerTool.hint(result.state, ctx);
    expect(hint).toEqual({ key: "tools.marker.hint.needLink" });
    expectHintLocalized(hint);
  });

  it("a click on nothing hints needLink, no effect", () => {
    const ctx = ctxFor(GROUND_AND_COUPLER);
    const result = markerTool.reduce(markerTool.initial(), pointerdown({ x: 999, y: 999 }), ctx);
    expect(result.effects).toEqual([]);
    const hint = markerTool.hint(result.state, ctx);
    expect(hint).toEqual({ key: "tools.marker.hint.needLink" });
  });

  it("moving the pointer clears a needLink status back to idle", () => {
    const ctx = ctxFor(GROUND_AND_COUPLER);
    const result = markerTool.reduce({ status: "needLink" }, pointermove({ x: 1, y: 1 }), ctx);
    expect(result.state).toEqual({ status: "idle" });
  });

  it("is never busy", () => {
    expect(markerTool.isBusy(markerTool.initial())).toBe(false);
    expect(markerTool.isBusy({ status: "needLink" })).toBe(false);
  });

  it("right-click is a no-op", () => {
    const ctx = ctxFor(GROUND_AND_COUPLER);
    const result = markerTool.reduce(markerTool.initial(), pointerdown({ x: 30, y: 10 }, 2), ctx);
    expect(result.effects).toEqual([]);
    expect(result.handled).toBe(false);
  });

  it("hint is idle by default; preview/snapAnchor/dynamicInput are empty/undefined", () => {
    const ctx = ctxFor(GROUND_AND_COUPLER);
    const hint = markerTool.hint(markerTool.initial(), ctx);
    expect(hint).toEqual({ key: "tools.marker.hint.idle" });
    expectHintLocalized(hint);
    expect(markerTool.preview(markerTool.initial())).toEqual([]);
    expect(markerTool.snapAnchor(markerTool.initial())).toBeUndefined();
    expect(markerTool.dynamicInput(markerTool.initial())).toBeUndefined();
  });

  it("key/cancel events are unhandled no-ops", () => {
    const ctx = ctxFor(GROUND_AND_COUPLER);
    const keyResult = markerTool.reduce(
      markerTool.initial(),
      { type: "key", key: "t", shift: false, mod: false, alt: false },
      ctx,
    );
    expect(keyResult.handled).toBe(false);
    const cancelResult = markerTool.reduce(markerTool.initial(), { type: "cancel" }, ctx);
    expect(cancelResult.handled).toBe(false);
  });

  it("integration: addMarker on the coupler at world point P places the marker exactly at P", () => {
    const store = createMechanismStore({ validate: true });
    const couplerPose = { position: [10, 0] as [number, number], angle: Math.PI / 4 };
    const coupler = store.getState().addLink({
      name: "Coupler",
      pose: couplerPose,
      sites: [{ local: [0, 0] }, { local: [50, 0] }],
    });
    const before = store.getState().document;

    // P = the bar's exact midpoint in world space (guaranteed to hit its body).
    const site1World = {
      x: couplerPose.position[0] + 50 * Math.cos(couplerPose.angle),
      y: couplerPose.position[1] + 50 * Math.sin(couplerPose.angle),
    };
    const P = {
      x: (couplerPose.position[0] + site1World.x) / 2,
      y: (couplerPose.position[1] + site1World.y) / 2,
    };
    const ctx: ToolContext = {
      doc: store.getState().document,
      selection: new Set(),
      radiusWorld: 8,
      gestureSeed: "g",
    };
    const result = markerTool.reduce(markerTool.initial(), pointerdown(P), ctx);
    applyToolEffects(store, result.effects, {
      defaultNames: {
        bar: "Barra",
        plate: "Placa",
        ground: "Bancada",
        slider: "Corredera",
        marker: "Punto",
      },
    });

    const doc = store.getState().document;
    expect(doc.markers).toHaveLength(1);
    const marker = doc.markers[0];
    expect(marker.linkId).toBe(coupler.linkId);
    const worldOfMarker = {
      x:
        couplerPose.position[0] +
        marker.local[0] * Math.cos(couplerPose.angle) -
        marker.local[1] * Math.sin(couplerPose.angle),
      y:
        couplerPose.position[1] +
        marker.local[0] * Math.sin(couplerPose.angle) +
        marker.local[1] * Math.cos(couplerPose.angle),
    };
    expect(worldOfMarker.x).toBeCloseTo(P.x, 9);
    expect(worldOfMarker.y).toBeCloseTo(P.y, 9);

    store.getState().undo();
    expect(store.getState().document).toEqual(before);
  });
});
