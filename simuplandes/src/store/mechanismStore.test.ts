import { describe, expect, it } from "vitest";
import {
  createEmptyDocument,
  indexDocument,
  MechanismDocumentSchema,
  serializeDocument,
  siteWorldPosition,
  type EntityKind,
  type Id,
} from "../model";
import { createMechanismStore } from "./mechanismStore";
import { buildExampleFourBar } from "./examples";
import {
  addLink as addLinkRecipe,
  CommandError,
  moveEntities as moveEntitiesRecipe,
  rename,
} from "./commands";

/** A deterministic id factory for tests: `${kind}-1`, `${kind}-2`, ... */
function counterIdFactory(): (kind: EntityKind) => Id {
  const counters = new Map<EntityKind, number>();
  return (kind: EntityKind) => {
    const n = (counters.get(kind) ?? 0) + 1;
    counters.set(kind, n);
    return `${kind}-${n}`;
  };
}

describe("createMechanismStore", () => {
  it("four-bar serialization", () => {
    const store = createMechanismStore({ idFactory: counterIdFactory(), validate: true });
    buildExampleFourBar(store);
    const doc = store.getState().document;

    expect(doc.links).toHaveLength(4);
    expect(doc.links.filter((l) => l.isGround)).toHaveLength(1);
    expect(doc.joints).toHaveLength(4);
    expect(doc.joints.every((j) => j.type === "R")).toBe(true);
    expect(doc.motors).toHaveLength(1);
    expect(doc.motors[0]?.kind).toBe("rotary");
    expect(doc.markers).toHaveLength(1);
    const coupler = doc.links.find((l) => l.name === "coupler");
    expect(coupler?.shape.kind).toBe("plate");

    const index = indexDocument(doc);
    for (const joint of doc.joints) {
      const a = index.sites.get(joint.siteA);
      const b = index.sites.get(joint.siteB);
      expect(a).toBeDefined();
      expect(b).toBeDefined();
      if (!a || !b) continue;
      const worldA = siteWorldPosition(a.link, a.site.local);
      const worldB = siteWorldPosition(b.link, b.site.local);
      expect(Math.hypot(worldA.x - worldB.x, worldA.y - worldB.y)).toBeLessThan(1e-9);
    }

    const roundTripped = MechanismDocumentSchema.parse(JSON.parse(serializeDocument(doc)));
    expect(roundTripped).toEqual(doc);
  });

  it("100 undo/redo", () => {
    const store = createMechanismStore({ idFactory: counterIdFactory() });
    const trueInitial = store.getState().document;

    const { linkId } = store.getState().addLink({ name: "seed", sites: [{ local: [0, 0] }] });
    for (let i = 0; i < 119; i += 1) {
      const op = i % 3;
      if (op === 0) {
        store.getState().addLink({ name: `link-${i}`, sites: [{ local: [i, 0] }] });
      } else if (op === 1) {
        store.getState().execute("move", moveEntitiesRecipe(new Set([linkId]), { x: 1, y: 0 }));
      } else {
        store.getState().execute("rename", rename(linkId, `renamed-${i}`));
      }
    }
    const final = store.getState().document;
    expect(store.getState().canUndo).toBe(true);

    for (let i = 0; i < 120; i += 1) {
      expect(store.getState().undo()).toBe(true);
    }
    expect(store.getState().document).toEqual(trueInitial);
    expect(store.getState().undo()).toBe(false);

    for (let i = 0; i < 120; i += 1) {
      expect(store.getState().redo()).toBe(true);
    }
    expect(store.getState().document).toEqual(final);
  });

  it("multi-select move is one step", () => {
    const store = createMechanismStore({ idFactory: counterIdFactory() });
    buildExampleFourBar(store);
    const before = store.getState().document;
    const linkIds = before.links.map((l) => l.id);

    store.getState().select(linkIds, "replace");
    const moved = store.getState().moveSelection({ x: 10, y: 0 });
    expect(moved).toBe(true);
    const after = store.getState().document;

    const beforeIndex = indexDocument(before);
    const afterIndex = indexDocument(after);
    for (const [siteId, { site, link }] of afterIndex.sites) {
      const beforeEntry = beforeIndex.sites.get(siteId);
      if (!beforeEntry) continue;
      const worldBefore = siteWorldPosition(beforeEntry.link, beforeEntry.site.local);
      const worldAfter = siteWorldPosition(link, site.local);
      expect(worldAfter.x).toBeCloseTo(worldBefore.x + 10, 9);
      expect(worldAfter.y).toBeCloseTo(worldBefore.y, 9);
    }

    expect(store.getState().undo()).toBe(true);
    expect(store.getState().document).toEqual(before);
  });

  it("a no-op execute returns false and records nothing", () => {
    const store = createMechanismStore({ idFactory: counterIdFactory() });
    const before = store.getState().document;
    const undoLabelBefore = store.getState().undoLabel;
    const result = store.getState().execute("noop", () => {
      /* intentionally does nothing */
    });
    expect(result).toBe(false);
    expect(store.getState().document).toBe(before);
    expect(store.getState().undoLabel).toBe(undoLabelBefore);
    expect(store.getState().canUndo).toBe(false);
  });

  it("a recipe that throws CommandError leaves document and history unchanged and rethrows", () => {
    const store = createMechanismStore({ idFactory: counterIdFactory() });
    const { linkId } = store.getState().addLink({ name: "a", sites: [] });
    const before = store.getState().document;
    const undoLabelBefore = store.getState().undoLabel;

    expect(() =>
      store.getState().execute("dup", addLinkRecipe({ id: linkId, name: "dup", sites: [] })),
    ).toThrow(CommandError);
    expect(store.getState().document).toBe(before);
    expect(store.getState().undoLabel).toBe(undoLabelBefore);
  });

  it("with validate:true, a recipe producing a schema-invalid document throws CommandError and records nothing", () => {
    const store = createMechanismStore({ idFactory: counterIdFactory(), validate: true });
    buildExampleFourBar(store);
    const before = store.getState().document;
    const undoLabelBefore = store.getState().undoLabel;

    expect(() =>
      store.getState().execute("break", (draft) => {
        const joint = draft.joints[0];
        if (joint) joint.siteA = "nope";
      }),
    ).toThrow(CommandError);
    expect(store.getState().document).toBe(before);
    expect(store.getState().undoLabel).toBe(undoLabelBefore);
  });

  it("coalesceKey: three moveSelection calls with the same key are one undo step", () => {
    const store = createMechanismStore({ idFactory: counterIdFactory() });
    buildExampleFourBar(store);
    const before = store.getState().document;
    const linkIds = before.links.map((l) => l.id);
    store.getState().select(linkIds, "replace");

    store.getState().moveSelection({ x: 1, y: 0 }, { coalesceKey: "drag-7" });
    store.getState().moveSelection({ x: 1, y: 0 }, { coalesceKey: "drag-7" });
    store.getState().moveSelection({ x: 1, y: 0 }, { coalesceKey: "drag-7" });

    expect(store.getState().undo()).toBe(true);
    expect(store.getState().document).toEqual(before);
  });

  describe("selection", () => {
    it("select modes replace/add/toggle/remove and clearSelection work", () => {
      const store = createMechanismStore({ idFactory: counterIdFactory() });
      const { linkId: a } = store.getState().addLink({ name: "a", sites: [] });
      const { linkId: b } = store.getState().addLink({ name: "b", sites: [] });
      const { linkId: c } = store.getState().addLink({ name: "c", sites: [] });

      store.getState().select([a, b], "replace");
      expect(store.getState().selection).toEqual(new Set([a, b]));

      store.getState().select([c], "add");
      expect(store.getState().selection).toEqual(new Set([a, b, c]));

      store.getState().select([b], "toggle");
      expect(store.getState().selection).toEqual(new Set([a, c]));
      store.getState().select([b], "toggle");
      expect(store.getState().selection).toEqual(new Set([a, b, c]));

      store.getState().select([a], "remove");
      expect(store.getState().selection).toEqual(new Set([b, c]));

      store.getState().clearSelection();
      expect(store.getState().selection).toEqual(new Set());
    });

    it("selection changes never affect undo history", () => {
      const store = createMechanismStore({ idFactory: counterIdFactory() });
      const { linkId } = store.getState().addLink({ name: "a", sites: [] });
      const undoLabelBefore = store.getState().undoLabel;
      const canUndoBefore = store.getState().canUndo;

      store.getState().select([linkId], "replace");
      store.getState().clearSelection();

      expect(store.getState().undoLabel).toBe(undoLabelBefore);
      expect(store.getState().canUndo).toBe(canUndoBefore);
    });

    it("select ignores ids that don't exist in the document", () => {
      const store = createMechanismStore({ idFactory: counterIdFactory() });
      const { linkId } = store.getState().addLink({ name: "a", sites: [] });
      store.getState().select([linkId, "nope"], "replace");
      expect(store.getState().selection).toEqual(new Set([linkId]));
    });

    it("deleteSelection cascades and leaves selection empty", () => {
      const store = createMechanismStore({ idFactory: counterIdFactory() });
      const { linkId } = store.getState().addLink({ name: "a", sites: [{ local: [0, 0] }] });
      store.getState().select([linkId], "replace");

      const result = store.getState().deleteSelection();
      expect(result).toBe(true);
      expect(store.getState().document.links.some((l) => l.id === linkId)).toBe(false);
      expect(store.getState().selection).toEqual(new Set());
    });

    it("undoing an addLink whose link was selected prunes it from the selection", () => {
      const store = createMechanismStore({ idFactory: counterIdFactory() });
      const { linkId } = store.getState().addLink({ name: "a", sites: [] });
      store.getState().select([linkId], "replace");
      expect(store.getState().selection).toEqual(new Set([linkId]));

      store.getState().undo();
      expect(store.getState().selection).toEqual(new Set());
    });
  });

  it("loadDocument replaces the document and clears history and selection", () => {
    const store = createMechanismStore({ idFactory: counterIdFactory() });
    store.getState().addLink({ name: "a", sites: [] });
    const linkIds = store.getState().document.links.map((l) => l.id);
    store.getState().select(linkIds, "replace");

    const fresh = createEmptyDocument({ name: "Loaded" });
    store.getState().loadDocument(fresh);

    expect(store.getState().document).toEqual(fresh);
    expect(store.getState().canUndo).toBe(false);
    expect(store.getState().selection).toEqual(new Set());
  });

  it("newDocument creates an empty document with given options and clears history/selection", () => {
    const store = createMechanismStore({ idFactory: counterIdFactory() });
    store.getState().addLink({ name: "a", sites: [] });

    store.getState().newDocument({ lengthUnit: "m" });

    expect(store.getState().document.units.length).toBe("m");
    expect(store.getState().document.links).toEqual([]);
    expect(store.getState().canUndo).toBe(false);
  });

  it("canUndo/canRedo/undoLabel/redoLabel update after every execute/undo/redo", () => {
    const store = createMechanismStore({ idFactory: counterIdFactory() });
    expect(store.getState().canUndo).toBe(false);
    expect(store.getState().undoLabel).toBeNull();

    store.getState().addLink({ name: "a", sites: [] });
    expect(store.getState().canUndo).toBe(true);
    expect(store.getState().undoLabel).toBe("add-link");
    expect(store.getState().canRedo).toBe(false);

    store.getState().undo();
    expect(store.getState().canUndo).toBe(false);
    expect(store.getState().canRedo).toBe(true);
    expect(store.getState().redoLabel).toBe("add-link");

    store.getState().redo();
    expect(store.getState().canUndo).toBe(true);
    expect(store.getState().canRedo).toBe(false);
  });

  it("two stores created in the same test file do not share history or documents", () => {
    const storeA = createMechanismStore({ idFactory: counterIdFactory() });
    const storeB = createMechanismStore({ idFactory: counterIdFactory() });

    storeA.getState().addLink({ name: "a", sites: [] });

    expect(storeA.getState().canUndo).toBe(true);
    expect(storeB.getState().canUndo).toBe(false);
    expect(storeB.getState().document.links).toEqual([]);
  });
});
