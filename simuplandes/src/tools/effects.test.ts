import { describe, expect, it } from "vitest";
import { createMechanismStore } from "../store";
import { degToRad } from "../model/units";
import { MechanismDocumentSchema } from "../model";
import { applyToolEffects, type DefaultNames } from "./effects";
import type { ToolEffect } from "./types";

const DEFAULT_NAMES: DefaultNames = {
  bar: "Barra",
  plate: "Placa",
  ground: "Bancada",
  slider: "Corredera",
  marker: "Punto",
};

describe("applyToolEffects: commitBar", () => {
  it("creates one link (bar, exact pose+sites) with no joints when no site is targeted", () => {
    const store = createMechanismStore({ validate: true });
    const before = store.getState().document;

    const effect: ToolEffect = {
      kind: "commitBar",
      start: { x: 0, y: 0 },
      angle: Math.PI / 3,
      length: 120,
      startSiteId: undefined,
      endSiteId: undefined,
    };
    const [result] = applyToolEffects(store, [effect], { defaultNames: DEFAULT_NAMES });

    const doc = store.getState().document;
    expect(doc.links).toHaveLength(1);
    const link = doc.links[0];
    expect(link.shape).toEqual({ kind: "bar" });
    expect(link.pose).toEqual({ position: [0, 0], angle: Math.PI / 3 });
    expect(link.sites.map((s) => s.local)).toEqual([
      [0, 0],
      [120, 0],
    ]);
    expect(doc.joints).toHaveLength(0);
    expect(result.linkId).toBe(link.id);
    expect(result.siteIds).toEqual(link.sites.map((s) => s.id));

    expect(store.getState().canUndo).toBe(true);
    store.getState().undo();
    expect(store.getState().document).toEqual(before);
  });

  it("creates ONE link and ONE R joint (auto-pin) in ONE undo step", () => {
    const store = createMechanismStore({ validate: true });
    // an existing bar to pin to
    const { siteIds } = store.getState().addLink({
      name: "Ground rail",
      isGround: true,
      sites: [{ local: [0, 0] }],
    });
    const before = store.getState().document;

    const effect: ToolEffect = {
      kind: "commitBar",
      start: { x: 0, y: 0 },
      angle: Math.PI / 3,
      length: 120,
      startSiteId: siteIds[0],
      endSiteId: undefined,
    };
    applyToolEffects(store, [effect], { defaultNames: DEFAULT_NAMES });

    const doc = store.getState().document;
    expect(doc.links).toHaveLength(2);
    expect(doc.joints).toHaveLength(1);
    expect(doc.joints[0]).toMatchObject({ type: "R", siteB: siteIds[0] });

    store.getState().undo();
    expect(store.getState().document).toEqual(before);
  });

  it("with both startSiteId and endSiteId, creates two R joints in ONE undo step", () => {
    const store = createMechanismStore({ validate: true });
    const a = store.getState().addLink({ name: "A", isGround: true, sites: [{ local: [0, 0] }] });
    const b = store.getState().addLink({ name: "B", isGround: true, sites: [{ local: [120, 0] }] });
    const before = store.getState().document;

    const effect: ToolEffect = {
      kind: "commitBar",
      start: { x: 0, y: 0 },
      angle: 0,
      length: 120,
      startSiteId: a.siteIds[0],
      endSiteId: b.siteIds[0],
    };
    applyToolEffects(store, [effect], { defaultNames: DEFAULT_NAMES });

    const doc = store.getState().document;
    expect(doc.joints).toHaveLength(2);

    store.getState().undo();
    expect(store.getState().document).toEqual(before);
  });

  it("names a new bar with a running index", () => {
    const store = createMechanismStore({ validate: true });
    applyToolEffects(store, [{ kind: "commitBar", start: { x: 0, y: 0 }, angle: 0, length: 1 }], {
      defaultNames: DEFAULT_NAMES,
    });
    applyToolEffects(store, [{ kind: "commitBar", start: { x: 0, y: 0 }, angle: 0, length: 1 }], {
      defaultNames: DEFAULT_NAMES,
    });
    const [first, second] = store.getState().document.links;
    expect(first.name).toBe("Barra 1");
    expect(second.name).toBe("Barra 2");
  });
});

describe("applyToolEffects: commitPlate", () => {
  const vertices = [
    { x: 0, y: 0 },
    { x: 100, y: 0 },
    { x: 50, y: 80 },
  ];

  it("creates one plate link (outline = site locals) with a site per vertex, no joints", () => {
    const store = createMechanismStore({ validate: true });
    const effect: ToolEffect = {
      kind: "commitPlate",
      vertices,
      vertexSiteIds: [undefined, undefined, undefined],
    };
    const [result] = applyToolEffects(store, [effect], { defaultNames: DEFAULT_NAMES });

    const doc = store.getState().document;
    expect(doc.links).toHaveLength(1);
    const link = doc.links[0];
    expect(link.shape.kind).toBe("plate");
    expect(link.sites).toHaveLength(3);
    if (link.shape.kind === "plate") {
      expect(link.shape.outline).toEqual(link.sites.map((s) => s.local));
    }
    expect(doc.joints).toHaveLength(0);
    expect(result.siteIds).toHaveLength(3);
  });

  it("adds an R joint per vertex landing on an existing site, all in ONE undo step", () => {
    const store = createMechanismStore({ validate: true });
    const existing = store
      .getState()
      .addLink({ name: "X", isGround: true, sites: [{ local: [0, 0] }] });
    const before = store.getState().document;

    const effect: ToolEffect = {
      kind: "commitPlate",
      vertices,
      vertexSiteIds: [existing.siteIds[0], undefined, undefined],
    };
    applyToolEffects(store, [effect], { defaultNames: DEFAULT_NAMES });

    const doc = store.getState().document;
    expect(doc.joints).toHaveLength(1);

    store.getState().undo();
    expect(store.getState().document).toEqual(before);
  });
});

describe("applyToolEffects: commitGroundPivot", () => {
  it("on an empty document, creates the ground link + site in ONE step", () => {
    const store = createMechanismStore({ validate: true });
    const before = store.getState().document;

    const effect: ToolEffect = { kind: "commitGroundPivot", at: { x: 10, y: 20 } };
    const [result] = applyToolEffects(store, [effect], { defaultNames: DEFAULT_NAMES });

    const doc = store.getState().document;
    expect(doc.links).toHaveLength(1);
    expect(doc.links[0].isGround).toBe(true);
    expect(doc.links[0].name).toBe("Bancada");
    expect(doc.links[0].sites[0].local).toEqual([10, 20]);
    expect(result.linkId).toBe(doc.links[0].id);

    store.getState().undo();
    expect(store.getState().document).toEqual(before);
  });

  it("a second pivot adds a site to the SAME ground link", () => {
    const store = createMechanismStore({ validate: true });
    applyToolEffects(store, [{ kind: "commitGroundPivot", at: { x: 0, y: 0 } }], {
      defaultNames: DEFAULT_NAMES,
    });
    applyToolEffects(store, [{ kind: "commitGroundPivot", at: { x: 50, y: 0 } }], {
      defaultNames: DEFAULT_NAMES,
    });

    const doc = store.getState().document;
    expect(doc.links.filter((l) => l.isGround)).toHaveLength(1);
    expect(doc.links[0].sites).toHaveLength(2);
  });

  it("with a siteId, also adds R(groundSite, siteId) in the same step", () => {
    const store = createMechanismStore({ validate: true });
    const moving = store.getState().addLink({ name: "M", sites: [{ local: [0, 0] }] });
    const before = store.getState().document;

    applyToolEffects(
      store,
      [{ kind: "commitGroundPivot", at: { x: 0, y: 0 }, siteId: moving.siteIds[0] }],
      { defaultNames: DEFAULT_NAMES },
    );

    const doc = store.getState().document;
    expect(doc.joints).toHaveLength(1);
    expect(doc.joints[0]).toMatchObject({ type: "R", siteB: moving.siteIds[0] });

    store.getState().undo();
    expect(store.getState().document).toEqual(before);
  });
});

describe("applyToolEffects: commitPin", () => {
  it("adds one R joint between the two given sites", () => {
    const store = createMechanismStore({ validate: true });
    const a = store.getState().addLink({ name: "A", isGround: true, sites: [{ local: [0, 0] }] });
    const b = store.getState().addLink({ name: "B", isGround: true, sites: [{ local: [0, 0] }] });

    const [result] = applyToolEffects(
      store,
      [{ kind: "commitPin", siteA: a.siteIds[0], siteB: b.siteIds[0] }],
      { defaultNames: DEFAULT_NAMES },
    );

    const doc = store.getState().document;
    expect(doc.joints).toHaveLength(1);
    expect(doc.joints[0]).toMatchObject({ type: "R", siteA: a.siteIds[0], siteB: b.siteIds[0] });
    expect(result.siteIds).toEqual([a.siteIds[0], b.siteIds[0]]);
  });
});

describe("applyToolEffects: commitSlider", () => {
  it("creates a block link + ground site + P joint on an empty document, schema-valid, ONE undo step", () => {
    const store = createMechanismStore({ validate: true });
    const before = store.getState().document;

    const effect: ToolEffect = {
      kind: "commitSlider",
      at: { x: 10, y: 0 },
      axisAngle: 0,
      blockHalfSize: 12,
    };
    const [result] = applyToolEffects(store, [effect], { defaultNames: DEFAULT_NAMES });

    const doc = store.getState().document;
    expect(MechanismDocumentSchema.safeParse(doc).success).toBe(true);

    const groundLink = doc.links.find((l) => l.isGround);
    const blockLink = doc.links.find((l) => !l.isGround);
    expect(groundLink).toBeDefined();
    expect(blockLink).toBeDefined();
    expect(blockLink?.shape.kind).toBe("plate");
    expect(blockLink?.pose).toEqual({ position: [10, 0], angle: 0 });

    const pJoint = doc.joints.find((j) => j.type === "P");
    expect(pJoint).toBeDefined();
    if (pJoint?.type === "P") {
      expect(pJoint.axis[0]).toBeCloseTo(1);
      expect(pJoint.axis[1]).toBeCloseTo(0);
    }
    expect(result.linkId).toBe(blockLink?.id);

    store.getState().undo();
    expect(store.getState().document).toEqual(before);
  });

  it("expresses the axis in ground-local coordinates for a non-zero axis angle", () => {
    const store = createMechanismStore({ validate: true });
    const effect: ToolEffect = {
      kind: "commitSlider",
      at: { x: 0, y: 0 },
      axisAngle: degToRad(90),
      blockHalfSize: 10,
    };
    applyToolEffects(store, [effect], { defaultNames: DEFAULT_NAMES });

    const doc = store.getState().document;
    const pJoint = doc.joints.find((j) => j.type === "P");
    if (pJoint?.type === "P") {
      expect(pJoint.axis[0]).toBeCloseTo(0);
      expect(pJoint.axis[1]).toBeCloseTo(1);
    }
  });

  it("reuses an existing ground link and adds R(blockSite, siteId) when siteId is given", () => {
    const store = createMechanismStore({ validate: true });
    applyToolEffects(store, [{ kind: "commitGroundPivot", at: { x: -50, y: 0 } }], {
      defaultNames: DEFAULT_NAMES,
    });
    const moving = store.getState().addLink({ name: "M", sites: [{ local: [0, 0] }] });

    applyToolEffects(
      store,
      [
        {
          kind: "commitSlider",
          at: { x: 0, y: 0 },
          axisAngle: 0,
          blockHalfSize: 10,
          siteId: moving.siteIds[0],
        },
      ],
      { defaultNames: DEFAULT_NAMES },
    );

    const doc = store.getState().document;
    expect(doc.links.filter((l) => l.isGround)).toHaveLength(1);
    expect(doc.joints.filter((j) => j.type === "R")).toHaveLength(1);
    expect(doc.joints.some((j) => j.type === "P")).toBe(true);
  });

  it("names a new slider block with a running index", () => {
    const store = createMechanismStore({ validate: true });
    applyToolEffects(
      store,
      [{ kind: "commitSlider", at: { x: 0, y: 0 }, axisAngle: 0, blockHalfSize: 10 }],
      { defaultNames: DEFAULT_NAMES },
    );
    const blockLink = store.getState().document.links.find((l) => !l.isGround);
    expect(blockLink?.name).toBe("Corredera 1");
  });
});

describe("applyToolEffects: select / clearSelection", () => {
  it("select() replaces the selection and is NOT recorded in history", () => {
    const store = createMechanismStore({ validate: true });
    const a = store.getState().addLink({ name: "A", isGround: true, sites: [{ local: [0, 0] }] });
    const undoLabelBefore = store.getState().undoLabel;

    applyToolEffects(store, [{ kind: "select", ids: [a.linkId], mode: "replace" }], {
      defaultNames: DEFAULT_NAMES,
    });

    expect(store.getState().selection).toEqual(new Set([a.linkId]));
    // The selection change didn't push a new history entry: the top of the
    // undo stack is still "add-link", not e.g. a "select" label.
    expect(store.getState().undoLabel).toBe(undoLabelBefore);
  });

  it("clearSelection() empties the selection and is NOT recorded in history", () => {
    const store = createMechanismStore({ validate: true });
    const a = store.getState().addLink({ name: "A", isGround: true, sites: [{ local: [0, 0] }] });
    store.getState().select([a.linkId]);
    const undoLabelBefore = store.getState().undoLabel;

    applyToolEffects(store, [{ kind: "clearSelection" }], { defaultNames: DEFAULT_NAMES });

    expect(store.getState().selection.size).toBe(0);
    expect(store.getState().undoLabel).toBe(undoLabelBefore);
  });
});

describe("applyToolEffects: moveEntities", () => {
  it("moves the given ids by delta, one undo step per gestureId, coalescing consecutive calls sharing it", () => {
    const store = createMechanismStore({ validate: true });
    const a = store.getState().addLink({ name: "A", sites: [{ local: [0, 0] }] });
    const before = store.getState().document;

    applyToolEffects(
      store,
      [
        {
          kind: "moveEntities",
          ids: [a.linkId],
          delta: { x: 1, y: 0 },
          gestureId: "gesture-1",
          label: "move-selection",
        },
      ],
      { defaultNames: DEFAULT_NAMES },
    );
    applyToolEffects(
      store,
      [
        {
          kind: "moveEntities",
          ids: [a.linkId],
          delta: { x: 2, y: 0 },
          gestureId: "gesture-1",
          label: "move-selection",
        },
      ],
      { defaultNames: DEFAULT_NAMES },
    );

    const doc = store.getState().document;
    expect(doc.links.find((l) => l.id === a.linkId)?.pose.position).toEqual([3, 0]);

    // Same gestureId -> ONE history entry: a single undo restores the original document.
    store.getState().undo();
    expect(store.getState().document).toEqual(before);
  });

  it("a different gestureId starts a new history entry", () => {
    const store = createMechanismStore({ validate: true });
    const a = store.getState().addLink({ name: "A", sites: [{ local: [0, 0] }] });

    applyToolEffects(
      store,
      [
        {
          kind: "moveEntities",
          ids: [a.linkId],
          delta: { x: 1, y: 0 },
          gestureId: "gesture-1",
          label: "move-selection",
        },
      ],
      { defaultNames: DEFAULT_NAMES },
    );
    applyToolEffects(
      store,
      [
        {
          kind: "moveEntities",
          ids: [a.linkId],
          delta: { x: 1, y: 0 },
          gestureId: "gesture-2",
          label: "move-selection",
        },
      ],
      { defaultNames: DEFAULT_NAMES },
    );

    let undoSteps = 0;
    while (store.getState().canUndo) {
      store.getState().undo();
      undoSteps += 1;
    }
    // 1 for `addLink` + 2 for the two distinct-gestureId moves (not coalesced).
    expect(undoSteps).toBe(3);
  });
});

describe("applyToolEffects: deleteSelection", () => {
  it("deletes the current selection in one undo step", () => {
    const store = createMechanismStore({ validate: true });
    const a = store.getState().addLink({ name: "A", isGround: true, sites: [{ local: [0, 0] }] });
    store.getState().select([a.linkId]);

    applyToolEffects(store, [{ kind: "deleteSelection" }], { defaultNames: DEFAULT_NAMES });

    expect(store.getState().document.links).toHaveLength(0);
    store.getState().undo();
    expect(store.getState().document.links).toHaveLength(1);
  });
});

describe("applyToolEffects: duplicateSelection", () => {
  it("duplicates the selected link in one undo step and selects the copy", () => {
    const store = createMechanismStore({ validate: true });
    const a = store.getState().addLink({ name: "A", sites: [{ local: [0, 0] }] });
    store.getState().select([a.linkId]);
    const before = store.getState().document;

    const [result] = applyToolEffects(
      store,
      [{ kind: "duplicateSelection", offset: { x: 10, y: 10 } }],
      { defaultNames: DEFAULT_NAMES },
    );

    const doc = store.getState().document;
    expect(doc.links).toHaveLength(2);
    expect(result.createdIds).toHaveLength(1);
    expect(store.getState().selection).toEqual(new Set(result.createdIds));

    store.getState().undo();
    expect(store.getState().document).toEqual(before);
  });
});

describe("applyToolEffects: addMotor", () => {
  it("adds a motor with the kind's default drive, in one undo step", () => {
    const store = createMechanismStore({ validate: true });
    const a = store.getState().addLink({ name: "A", isGround: true, sites: [{ local: [0, 0] }] });
    const b = store.getState().addLink({ name: "B", sites: [{ local: [0, 0] }] });
    const jointId = store
      .getState()
      .addJoint({ type: "R", siteA: a.siteIds[0], siteB: b.siteIds[0] });
    const before = store.getState().document;

    const [result] = applyToolEffects(store, [{ kind: "addMotor", jointId, motorKind: "rotary" }], {
      defaultNames: DEFAULT_NAMES,
    });

    const doc = store.getState().document;
    expect(doc.motors).toHaveLength(1);
    expect(doc.motors[0]).toMatchObject({ jointId, kind: "rotary" });
    expect(doc.motors[0].drive).toEqual({ mode: "constant", speed: degToRad(36) });
    expect(result.createdIds).toEqual([doc.motors[0].id]);

    store.getState().undo();
    expect(store.getState().document).toEqual(before);
  });
});

describe("applyToolEffects: addMarker", () => {
  it("adds a marker at the given link-local point with an indexed default name, in one undo step", () => {
    const store = createMechanismStore({ validate: true });
    const a = store.getState().addLink({ name: "A", sites: [{ local: [0, 0] }] });

    applyToolEffects(store, [{ kind: "addMarker", linkId: a.linkId, local: [5, 5] }], {
      defaultNames: DEFAULT_NAMES,
    });
    applyToolEffects(store, [{ kind: "addMarker", linkId: a.linkId, local: [6, 6] }], {
      defaultNames: DEFAULT_NAMES,
    });

    const doc = store.getState().document;
    expect(doc.markers).toHaveLength(2);
    expect(doc.markers[0].name).toBe("Punto 1");
    expect(doc.markers[1].name).toBe("Punto 2");
    expect(doc.markers[0].local).toEqual([5, 5]);

    store.getState().undo();
    expect(store.getState().document.markers).toHaveLength(1);
  });
});

describe("applyToolEffects: multiple effects", () => {
  it("applies each effect as its own execute() call, in order", () => {
    const store = createMechanismStore({ validate: true });
    applyToolEffects(
      store,
      [
        { kind: "commitGroundPivot", at: { x: 0, y: 0 } },
        { kind: "commitGroundPivot", at: { x: 100, y: 0 } },
      ],
      { defaultNames: DEFAULT_NAMES },
    );
    expect(store.getState().document.links).toHaveLength(1);
    expect(store.getState().document.links[0].sites).toHaveLength(2);
    // two separate commits -> two undo steps
    store.getState().undo();
    expect(store.getState().document.links[0].sites).toHaveLength(1);
  });
});
