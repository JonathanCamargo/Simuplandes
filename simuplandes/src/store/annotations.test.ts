import { describe, expect, it } from "vitest";
import { createMechanismStore } from "./mechanismStore";
import { addAnnotation } from "./commands";
import { clearAllAnnotations } from "./annotations";

describe("clearAllAnnotations", () => {
  it("removes every note as one undo step, leaving the mechanism alone", () => {
    const store = createMechanismStore({ validate: true });
    store.getState().addLink({ name: "B", sites: [{ local: [0, 0] }, { local: [10, 0] }] });
    for (const id of ["a", "b"]) {
      store
        .getState()
        .execute("add", addAnnotation({ id, points: [[0, 0]], color: "ink", width: 1 }));
    }
    expect(clearAllAnnotations(store)).toBe(true);
    expect(store.getState().document.annotations).toEqual([]);
    expect(store.getState().document.links).toHaveLength(1);
    store.getState().undo();
    expect(store.getState().document.annotations.map((a) => a.id)).toEqual(["a", "b"]);
  });

  it("is a no-op with no history entry when there are no notes", () => {
    const store = createMechanismStore();
    expect(clearAllAnnotations(store)).toBe(false);
    expect(store.getState().canUndo).toBe(false);
  });
});
