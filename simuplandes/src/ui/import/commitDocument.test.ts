import { describe, it, expect, vi } from "vitest";
import { commitImportedDocument } from "./commitDocument";
import { createMechanismStore } from "../../store";
import { createStudioStore } from "../../uiState/studioStore";
import { fourBarFixtureParsed } from "../../model/__fixtures__/fourBar";

function setup() {
  const mechanismStore = createMechanismStore();
  const studioStore = createStudioStore();
  mechanismStore.getState().newDocument({ name: "before" });
  studioStore.getState().setActiveTool("pan");
  studioStore.getState().requestImport("{}", "x.json");
  return { mechanismStore, studioStore };
}

describe("commitImportedDocument", () => {
  it("runs the steps in the fixed order, closing the dialog before entering Simulate", () => {
    const { mechanismStore, studioStore } = setup();
    const order: string[] = [];
    const studio = studioStore.getState();
    const mech = mechanismStore.getState();
    vi.spyOn(studio, "setMode").mockImplementation((m) => {
      order.push(`setMode:${m}`);
    });
    vi.spyOn(studio, "setActiveTool").mockImplementation(() => {
      order.push("setActiveTool");
    });
    vi.spyOn(studio, "clearImportRequest").mockImplementation(() => {
      order.push("clearImportRequest");
    });
    vi.spyOn(studio, "closeDialog").mockImplementation(() => {
      order.push("closeDialog");
    });
    const load = vi.spyOn(mech, "loadDocument").mockImplementation(() => {
      order.push("loadDocument");
    });
    commitImportedDocument(fourBarFixtureParsed, { mechanismStore, studioStore, simulate: true });
    expect(order).toEqual([
      "setMode:build",
      "loadDocument",
      "setActiveTool",
      "clearImportRequest",
      "closeDialog",
      "setMode:simulate",
    ]);
    expect(load).toHaveBeenCalledWith(fourBarFixtureParsed);
  });

  it("ends in simulate with the document loaded, history reset and no dialog", () => {
    const { mechanismStore, studioStore } = setup();
    commitImportedDocument(fourBarFixtureParsed, { mechanismStore, studioStore, simulate: true });
    expect(studioStore.getState().dialog).toBeNull();
    expect(studioStore.getState().importRequest).toBeNull();
    expect(studioStore.getState().mode).toBe("simulate");
    expect(studioStore.getState().activeTool).toBe("select");
    expect(mechanismStore.getState().document).toEqual(fourBarFixtureParsed);
    expect(mechanismStore.getState().canUndo).toBe(false);
  });

  it("stays in build when simulate is false", () => {
    const { mechanismStore, studioStore } = setup();
    studioStore.getState().setMode("simulate");
    commitImportedDocument(fourBarFixtureParsed, { mechanismStore, studioStore, simulate: false });
    expect(studioStore.getState().mode).toBe("build");
    expect(studioStore.getState().dialog).toBeNull();
  });
});
