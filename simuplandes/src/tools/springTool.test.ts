import { describe, expect, it } from "vitest";
import { MechanismDocumentSchema, siteWorldPosition, type MechanismDocument } from "../model";
import { createMechanismStore } from "../store";
import { applyToolEffects, DEFAULT_SPRING_STIFFNESS } from "./effects";
import { springTool, type SpringToolState } from "./springTool";
import { expectHintLocalized } from "./machines.test";
import type { ToolContext, ToolEvent } from "./types";

const NAMES = {
  bar: "Barra",
  plate: "Placa",
  ground: "Bancada",
  slider: "Corredera",
  marker: "Punto",
  spring: "Resorte",
};

function ctxFor(doc: MechanismDocument): ToolContext {
  return { doc, selection: new Set(), radiusWorld: 2, gestureSeed: "g" };
}

function pointer(type: "pointerdown" | "pointermove", x: number, y: number, button = 0): ToolEvent {
  const world = { x, y };
  return {
    type,
    world,
    snap: { kind: "none", point: world },
    button,
    shift: false,
    mod: false,
    alt: false,
  };
}

/** A crank pinned to ground at the origin, plus a free coupler bar along y = 50. */
const DOC: MechanismDocument = MechanismDocumentSchema.parse({
  schemaVersion: 2,
  links: [
    {
      id: "ground",
      name: "Ground",
      isGround: true,
      pose: { position: [0, 0], angle: 0 },
      shape: { kind: "bar" },
      sites: [{ id: "g0", local: [0, 0] }],
    },
    {
      id: "crank",
      name: "Crank",
      isGround: false,
      pose: { position: [0, 0], angle: 0 },
      shape: { kind: "bar" },
      sites: [
        { id: "c0", local: [0, 0] },
        { id: "c1", local: [40, 0] },
      ],
    },
    {
      id: "coupler",
      name: "Coupler",
      isGround: false,
      pose: { position: [0, 50], angle: 0 },
      shape: { kind: "bar" },
      sites: [
        { id: "k0", local: [0, 0] },
        { id: "k1", local: [60, 0] },
      ],
    },
  ],
  joints: [{ id: "j0", type: "R", siteA: "g0", siteB: "c0" }],
  markers: [{ id: "m0", linkId: "coupler", local: [30, 0] }],
});

function run(doc: MechanismDocument, events: ToolEvent[]) {
  let state: SpringToolState = springTool.initial();
  let last = springTool.reduce(state, events[0], ctxFor(doc));
  state = last.state;
  for (const event of events.slice(1)) {
    last = springTool.reduce(state, event, ctxFor(doc));
    state = last.state;
  }
  return last;
}

describe("springTool", () => {
  it("connects a site to a point on another link, with its free length", () => {
    const result = run(DOC, [pointer("pointerdown", 40, 0), pointer("pointerdown", 20, 50)]);
    expect(result.effects).toEqual([
      {
        kind: "commitSpring",
        a: { kind: "site", siteId: "c1" },
        b: { kind: "link", linkId: "coupler", at: { x: 20, y: 50 } },
        freeLength: Math.hypot(20, 50),
      },
    ]);
    expect(result.state.status).toBe("idle");
  });

  it("anchors an end in empty space to ground, and reuses a joint's site", () => {
    const result = run(DOC, [pointer("pointerdown", 0, 0), pointer("pointerdown", 30, 50)]);
    // The first click hit the ground pivot's site; the second the coupler's marker.
    expect(result.effects[0]).toMatchObject({
      a: { kind: "site", siteId: "g0" },
      b: { kind: "link", linkId: "coupler" },
    });
    const ground = run(DOC, [pointer("pointerdown", -50, -50), pointer("pointerdown", 40, 0)]);
    expect(ground.effects[0]).toMatchObject({
      a: { kind: "ground", at: { x: -50, y: -50 } },
      b: { kind: "site", siteId: "c1" },
    });
  });

  it("refuses two ends on the same link, or two ground ends", () => {
    const same = run(DOC, [pointer("pointerdown", 0, 50), pointer("pointerdown", 60, 50)]);
    expect(same.effects).toEqual([]);
    expect(same.state.status).toBe("differentLink");
    expectHintLocalized(springTool.hint(same.state, ctxFor(DOC)));
    const grounds = run(DOC, [pointer("pointerdown", -50, -50), pointer("pointerdown", 0, 0)]);
    expect(grounds.state.status).toBe("differentLink");
    // Picking a valid second end afterwards still works.
    const recovered = springTool.reduce(same.state, pointer("pointerdown", 40, 0), ctxFor(DOC));
    expect(recovered.effects).toHaveLength(1);
  });

  it("previews a dashed line to the pointer while placing the second end", () => {
    const first = run(DOC, [pointer("pointerdown", 40, 0), pointer("pointermove", 10, 10)]);
    expect(springTool.isBusy(first.state)).toBe(true);
    expect(springTool.snapAnchor(first.state)).toEqual({ x: 40, y: 0 });
    expect(springTool.preview(first.state)).toEqual([
      { kind: "point", at: { x: 40, y: 0 } },
      { kind: "segment", a: { x: 40, y: 0 }, b: { x: 10, y: 10 }, dashed: true },
    ]);
    expectHintLocalized(springTool.hint(first.state, ctxFor(DOC)));
  });

  it("is idle otherwise", () => {
    const idle = springTool.initial();
    expect(springTool.isBusy(idle)).toBe(false);
    expect(springTool.preview(idle)).toEqual([]);
    expect(springTool.snapAnchor(idle)).toBeUndefined();
    expect(springTool.dynamicInput(idle)).toBeUndefined();
    expectHintLocalized(springTool.hint(idle, ctxFor(DOC)));
    const moved = springTool.reduce(idle, pointer("pointermove", 1, 1), ctxFor(DOC));
    expect(moved.state).toBe(idle);
    expect(springTool.reduce(idle, pointer("pointerdown", 1, 1, 2), ctxFor(DOC)).handled).toBe(
      false,
    );
    expect(springTool.reduce(idle, { type: "cancel" }, ctxFor(DOC)).handled).toBe(false);
  });

  it("cancels with Escape", () => {
    const first = run(DOC, [pointer("pointerdown", 40, 0)]);
    const cancelled = springTool.reduce(
      first.state,
      { type: "key", key: "Escape", shift: false, mod: false, alt: false },
      ctxFor(DOC),
    );
    expect(cancelled).toMatchObject({ state: { status: "idle" }, handled: true });
  });

  it("commits one undoable step that adds the sites and the spring", () => {
    const store = createMechanismStore();
    store.getState().loadDocument(DOC);
    const result = run(DOC, [pointer("pointerdown", -50, -50), pointer("pointerdown", 20, 50)]);
    applyToolEffects(store, result.effects, { defaultNames: NAMES });
    const doc = store.getState().document;
    expect(doc.springs).toHaveLength(1);
    const spring = doc.springs[0];
    expect(spring).toMatchObject({
      kind: "linear",
      name: "Resorte 1",
      stiffness: DEFAULT_SPRING_STIFFNESS,
    });
    expect(store.getState().selection).toEqual(new Set([spring.id]));
    if (spring.kind !== "linear") throw new Error("expected a linear spring");
    const ground = doc.links.find((l) => l.id === "ground")!;
    const groundSite = ground.sites.find((s) => s.id === spring.siteA)!;
    expect(siteWorldPosition(ground, groundSite.local)).toEqual({ x: -50, y: -50 });
    expect(MechanismDocumentSchema.safeParse(doc).success).toBe(true);
    store.getState().undo();
    expect(store.getState().document).toEqual(DOC);
  });
});
