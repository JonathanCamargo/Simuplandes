import { describe, expect, it } from "vitest";
import { MechanismDocumentSchema, degToRad, type MechanismDocument } from "../model";
import { createMechanismStore } from "../store";
import { applyToolEffects } from "./effects";
import { motorTool } from "./motorTool";
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

const GROUND_AND_CRANK: MechanismDocument = MechanismDocumentSchema.parse({
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
      id: "link-crank",
      name: "Crank",
      isGround: false,
      pose: { position: [0, 0], angle: 0 },
      shape: { kind: "bar" },
      sites: [
        { id: "site-o2", local: [0, 0] },
        { id: "site-a", local: [40, 0] },
      ],
    },
  ],
  joints: [{ id: "joint-o2", type: "R", siteA: "site-g", siteB: "site-o2", name: "O2" }],
});

describe("motorTool", () => {
  it("a click near a joint touching ground adds a rotary motor for an R joint", () => {
    const ctx = ctxFor(GROUND_AND_CRANK);
    const result = motorTool.reduce(motorTool.initial(), pointerdown({ x: 0, y: 0 }), ctx);
    expect(result.effects).toEqual([
      { kind: "addMotor", jointId: "joint-o2", motorKind: "rotary" },
    ]);
    expect(result.handled).toBe(true);
  });

  it("prefers a joint touching ground when several joints are nearby", () => {
    const doc = MechanismDocumentSchema.parse({
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
          id: "link-a",
          name: "A",
          isGround: false,
          pose: { position: [0, 0], angle: 0 },
          shape: { kind: "bar" },
          sites: [{ id: "site-a", local: [0, 0] }],
        },
        {
          id: "link-b",
          name: "B",
          isGround: false,
          pose: { position: [0, 0], angle: 0 },
          shape: { kind: "bar" },
          sites: [{ id: "site-b", local: [0, 0] }],
        },
      ],
      // joint-1 (a<->b, no ground) comes FIRST in document order, but
      // joint-2 (ground<->a) must still win because it touches ground.
      joints: [
        { id: "joint-1", type: "R", siteA: "site-a", siteB: "site-b" },
        { id: "joint-2", type: "R", siteA: "site-g", siteB: "site-a" },
      ],
    });
    const ctx = ctxFor(doc);
    const result = motorTool.reduce(motorTool.initial(), pointerdown({ x: 0, y: 0 }), ctx);
    expect(result.effects).toEqual([{ kind: "addMotor", jointId: "joint-2", motorKind: "rotary" }]);
  });

  it("falls back to the first joint in document order when none touches ground", () => {
    const doc = MechanismDocumentSchema.parse({
      schemaVersion: 1,
      links: [
        {
          id: "link-a",
          name: "A",
          isGround: false,
          pose: { position: [0, 0], angle: 0 },
          shape: { kind: "bar" },
          sites: [{ id: "site-a", local: [0, 0] }],
        },
        {
          id: "link-b",
          name: "B",
          isGround: false,
          pose: { position: [0, 0], angle: 0 },
          shape: { kind: "bar" },
          sites: [{ id: "site-b", local: [0, 0] }],
        },
        {
          id: "link-c",
          name: "C",
          isGround: false,
          pose: { position: [0, 0], angle: 0 },
          shape: { kind: "bar" },
          sites: [{ id: "site-c", local: [0, 0] }],
        },
      ],
      joints: [
        { id: "joint-1", type: "R", siteA: "site-a", siteB: "site-b" },
        { id: "joint-2", type: "R", siteA: "site-b", siteB: "site-c" },
      ],
    });
    const ctx = ctxFor(doc);
    const result = motorTool.reduce(motorTool.initial(), pointerdown({ x: 0, y: 0 }), ctx);
    expect(result.effects).toEqual([{ kind: "addMotor", jointId: "joint-1", motorKind: "rotary" }]);
  });

  it("a P joint gets a linear motor", () => {
    const doc = MechanismDocumentSchema.parse({
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
          id: "link-block",
          name: "Block",
          isGround: false,
          pose: { position: [0, 0], angle: 0 },
          shape: { kind: "bar" },
          sites: [{ id: "site-b", local: [0, 0] }],
        },
      ],
      joints: [{ id: "joint-p", type: "P", siteA: "site-g", siteB: "site-b", axis: [1, 0] }],
    });
    const ctx = ctxFor(doc);
    const result = motorTool.reduce(motorTool.initial(), pointerdown({ x: 0, y: 0 }), ctx);
    expect(result.effects).toEqual([{ kind: "addMotor", jointId: "joint-p", motorKind: "linear" }]);
  });

  it("a joint that already has a motor gets no effect, hints alreadyMotor with the joint's name", () => {
    const doc = MechanismDocumentSchema.parse({
      ...GROUND_AND_CRANK,
      motors: [
        {
          id: "motor-1",
          jointId: "joint-o2",
          kind: "rotary",
          drive: { mode: "constant", speed: 1 },
        },
      ],
    });
    const ctx = ctxFor(doc);
    const result = motorTool.reduce(motorTool.initial(), pointerdown({ x: 0, y: 0 }), ctx);
    expect(result.effects).toEqual([]);
    expect(result.handled).toBe(true);
    const hint = motorTool.hint(result.state, ctx);
    expect(hint).toEqual({ key: "tools.motor.hint.alreadyMotor", values: { joint: "O2" } });
    expectHintLocalized(hint);
  });

  it("no joint nearby hints needJoint", () => {
    const ctx = ctxFor(GROUND_AND_CRANK);
    const result = motorTool.reduce(motorTool.initial(), pointerdown({ x: 999, y: 999 }), ctx);
    expect(result.effects).toEqual([]);
    const hint = motorTool.hint(result.state, ctx);
    expect(hint).toEqual({ key: "tools.motor.hint.needJoint" });
    expectHintLocalized(hint);
  });

  it("moving the pointer clears a transient status back to idle", () => {
    const ctx = ctxFor(GROUND_AND_CRANK);
    const result = motorTool.reduce({ status: "needJoint" }, pointermove({ x: 1, y: 1 }), ctx);
    expect(result.state).toEqual({ status: "idle" });
  });

  it("is never busy", () => {
    expect(motorTool.isBusy(motorTool.initial())).toBe(false);
    expect(motorTool.isBusy({ status: "needJoint" })).toBe(false);
    expect(motorTool.isBusy({ status: "alreadyMotor", jointId: "x" })).toBe(false);
  });

  it("right-click is a no-op", () => {
    const ctx = ctxFor(GROUND_AND_CRANK);
    const result = motorTool.reduce(motorTool.initial(), pointerdown({ x: 0, y: 0 }, 2), ctx);
    expect(result.effects).toEqual([]);
    expect(result.handled).toBe(false);
  });

  it("hint is idle by default; preview/snapAnchor/dynamicInput are empty/undefined", () => {
    const ctx = ctxFor(GROUND_AND_CRANK);
    const hint = motorTool.hint(motorTool.initial(), ctx);
    expect(hint).toEqual({ key: "tools.motor.hint.idle" });
    expectHintLocalized(hint);
    expect(motorTool.preview(motorTool.initial())).toEqual([]);
    expect(motorTool.snapAnchor(motorTool.initial())).toBeUndefined();
    expect(motorTool.dynamicInput(motorTool.initial())).toBeUndefined();
  });

  it("key/cancel events are unhandled no-ops", () => {
    const ctx = ctxFor(GROUND_AND_CRANK);
    const keyResult = motorTool.reduce(
      motorTool.initial(),
      { type: "key", key: "m", shift: false, mod: false, alt: false },
      ctx,
    );
    expect(keyResult.handled).toBe(false);
    const cancelResult = motorTool.reduce(motorTool.initial(), { type: "cancel" }, ctx);
    expect(cancelResult.handled).toBe(false);
  });

  it("integration: addMotor on joint O2 adds one rotary motor with the default drive, one undo step", () => {
    const store = createMechanismStore({ validate: true });
    const ground = store.getState().addLink({
      name: "Ground",
      isGround: true,
      sites: [{ local: [0, 0] }],
    });
    const crank = store.getState().addLink({ name: "Crank", sites: [{ local: [0, 0] }] });
    const jointId = store
      .getState()
      .addJoint({ type: "R", siteA: ground.siteIds[0], siteB: crank.siteIds[0], name: "O2" });
    const before = store.getState().document;

    const ctx: ToolContext = {
      doc: store.getState().document,
      selection: new Set(),
      radiusWorld: 8,
      gestureSeed: "g",
    };
    const result = motorTool.reduce(motorTool.initial(), pointerdown({ x: 0, y: 0 }), ctx);
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
    expect(doc.motors).toHaveLength(1);
    expect(doc.motors[0]).toMatchObject({ jointId, kind: "rotary" });
    expect(doc.motors[0].drive).toEqual({ mode: "constant", speed: degToRad(36) });

    store.getState().undo();
    expect(store.getState().document).toEqual(before);
  });
});
