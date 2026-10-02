import { describe, it, expect, vi } from "vitest";
import { createStudioStore, selectModalOpen, selectCanToggleMode } from "./studioStore";

describe("createStudioStore defaults", () => {
  it("starts with the select tool and everything else idle", () => {
    const store = createStudioStore();
    expect(store.getState()).toMatchObject({
      activeTool: "select",
      toolBusy: false,
      rightDockTab: "inspector",
      paletteOpen: false,
      shortcutSheetOpen: false,
      cursorWorld: null,
      snapStatus: null,
      hint: null,
      mode: "build",
      hoveredId: null,
      graphLayout: "spatial",
    });
  });
});

describe("hoveredId / setHoveredId", () => {
  it("starts null and setHoveredId sets/clears it", () => {
    const store = createStudioStore();
    expect(store.getState().hoveredId).toBeNull();
    store.getState().setHoveredId("link-2");
    expect(store.getState().hoveredId).toBe("link-2");
    store.getState().setHoveredId(null);
    expect(store.getState().hoveredId).toBeNull();
  });

  it("does not notify subscribers when setting the same value again", () => {
    const store = createStudioStore();
    store.getState().setHoveredId("link-2");
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);
    store.getState().setHoveredId("link-2");
    expect(listener).not.toHaveBeenCalled();
    store.getState().setHoveredId("link-3");
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
  });

  it("is untouched by setMode/setActiveTool", () => {
    const store = createStudioStore();
    store.getState().setHoveredId("link-2");
    store.getState().setMode("simulate");
    expect(store.getState().hoveredId).toBe("link-2");
    store.getState().setActiveTool("pan");
    expect(store.getState().hoveredId).toBe("link-2");
  });
});

describe("graphLayout / setGraphLayout", () => {
  it("starts 'spatial' and setGraphLayout sets it", () => {
    const store = createStudioStore();
    expect(store.getState().graphLayout).toBe("spatial");
    store.getState().setGraphLayout("layered");
    expect(store.getState().graphLayout).toBe("layered");
  });

  it("is untouched by setMode/setActiveTool", () => {
    const store = createStudioStore();
    store.getState().setGraphLayout("circular");
    store.getState().setMode("simulate");
    expect(store.getState().graphLayout).toBe("circular");
    store.getState().setActiveTool("pan");
    expect(store.getState().graphLayout).toBe("circular");
  });
});

describe("mode / toggleMode / setMode", () => {
  it("toggleMode flips build -> simulate -> build", () => {
    const store = createStudioStore();
    expect(store.getState().mode).toBe("build");
    store.getState().toggleMode();
    expect(store.getState().mode).toBe("simulate");
    store.getState().toggleMode();
    expect(store.getState().mode).toBe("build");
  });

  it("setMode('simulate') sets simulate directly", () => {
    const store = createStudioStore();
    store.getState().setMode("simulate");
    expect(store.getState().mode).toBe("simulate");
  });

  it("toggleMode/setMode('simulate') are no-ops while toolBusy is true", () => {
    const store = createStudioStore();
    store.getState().setToolBusy(true);
    store.getState().toggleMode();
    expect(store.getState().mode).toBe("build");
    store.getState().setMode("simulate");
    expect(store.getState().mode).toBe("build");
  });

  it("toggleMode/setMode('simulate') are no-ops while paletteOpen is true", () => {
    const store = createStudioStore();
    store.getState().openPalette();
    store.getState().toggleMode();
    expect(store.getState().mode).toBe("build");
    store.getState().setMode("simulate");
    expect(store.getState().mode).toBe("build");
  });

  it("toggleMode/setMode('simulate') are no-ops while shortcutSheetOpen is true", () => {
    const store = createStudioStore();
    store.getState().openShortcutSheet();
    store.getState().toggleMode();
    expect(store.getState().mode).toBe("build");
    store.getState().setMode("simulate");
    expect(store.getState().mode).toBe("build");
  });

  it("setMode('build') is always allowed, even while toolBusy", () => {
    const store = createStudioStore();
    store.getState().setMode("simulate");
    store.getState().setToolBusy(true);
    store.getState().setMode("build");
    expect(store.getState().mode).toBe("build");
  });

  it("setActiveTool to a drawing tool while simulating returns to build", () => {
    const store = createStudioStore();
    store.getState().setMode("simulate");
    store.getState().setActiveTool("bar");
    expect(store.getState().mode).toBe("build");
    expect(store.getState().activeTool).toBe("bar");
  });

  it("setActiveTool('select')/('pan') while simulating keeps simulate", () => {
    const store = createStudioStore();
    store.getState().setMode("simulate");
    store.getState().setActiveTool("pan");
    expect(store.getState().mode).toBe("simulate");
    store.getState().setActiveTool("select");
    expect(store.getState().mode).toBe("simulate");
  });

  it("setActiveTool while in build mode never touches mode", () => {
    const store = createStudioStore();
    store.getState().setActiveTool("bar");
    expect(store.getState().mode).toBe("build");
  });
});

describe("selectCanToggleMode", () => {
  it("is true iff toolBusy, paletteOpen and shortcutSheetOpen are all false", () => {
    expect(
      selectCanToggleMode({ toolBusy: false, paletteOpen: false, shortcutSheetOpen: false }),
    ).toBe(true);
    expect(
      selectCanToggleMode({ toolBusy: true, paletteOpen: false, shortcutSheetOpen: false }),
    ).toBe(false);
    expect(
      selectCanToggleMode({ toolBusy: false, paletteOpen: true, shortcutSheetOpen: false }),
    ).toBe(false);
    expect(
      selectCanToggleMode({ toolBusy: false, paletteOpen: false, shortcutSheetOpen: true }),
    ).toBe(false);
  });
});

describe("setActiveTool", () => {
  it("changes activeTool and clears toolBusy and hint", () => {
    const store = createStudioStore();
    store.getState().setToolBusy(true);
    store.getState().setHint({ key: "tools.bar.hint.idle" });

    store.getState().setActiveTool("bar");

    expect(store.getState().activeTool).toBe("bar");
    expect(store.getState().toolBusy).toBe(false);
    expect(store.getState().hint).toBeNull();
  });
});

describe("per-field setters", () => {
  it("setToolBusy updates only toolBusy", () => {
    const store = createStudioStore();
    store.getState().setToolBusy(true);
    expect(store.getState().toolBusy).toBe(true);
    expect(store.getState().activeTool).toBe("select");
  });

  it("openPalette/closePalette toggle paletteOpen only", () => {
    const store = createStudioStore();
    store.getState().openPalette();
    expect(store.getState().paletteOpen).toBe(true);
    expect(store.getState().shortcutSheetOpen).toBe(false);
    store.getState().closePalette();
    expect(store.getState().paletteOpen).toBe(false);
  });

  it("openShortcutSheet/closeShortcutSheet toggle shortcutSheetOpen only", () => {
    const store = createStudioStore();
    store.getState().openShortcutSheet();
    expect(store.getState().shortcutSheetOpen).toBe(true);
    expect(store.getState().paletteOpen).toBe(false);
    store.getState().closeShortcutSheet();
    expect(store.getState().shortcutSheetOpen).toBe(false);
  });

  it("setCursorWorld updates only cursorWorld", () => {
    const store = createStudioStore();
    store.getState().setCursorWorld({ x: 1, y: 2 });
    expect(store.getState().cursorWorld).toEqual({ x: 1, y: 2 });
    store.getState().setCursorWorld(null);
    expect(store.getState().cursorWorld).toBeNull();
  });

  it("setSnapStatus updates only snapStatus", () => {
    const store = createStudioStore();
    const status = { kind: "site" as const, labelKey: "tools.snap.site" };
    store.getState().setSnapStatus(status);
    expect(store.getState().snapStatus).toEqual(status);
  });

  it("setHint updates only hint", () => {
    const store = createStudioStore();
    store.getState().setHint({ key: "tools.bar.hint.idle", values: { n: 1 } });
    expect(store.getState().hint).toEqual({ key: "tools.bar.hint.idle", values: { n: 1 } });
  });

  it("setRightDockTab updates only rightDockTab", () => {
    const store = createStudioStore();
    store.getState().setRightDockTab("graph");
    expect(store.getState().rightDockTab).toBe("graph");
    expect(store.getState().activeTool).toBe("select");
  });

  it("requestFit increments fitRequest by one each call, starting at 0", () => {
    const store = createStudioStore();
    expect(store.getState().fitRequest).toBe(0);
    store.getState().requestFit();
    expect(store.getState().fitRequest).toBe(1);
    store.getState().requestFit();
    store.getState().requestFit();
    expect(store.getState().fitRequest).toBe(3);
    expect(store.getState().activeTool).toBe("select");
  });
});

describe("selectModalOpen", () => {
  const base = { paletteOpen: false, shortcutSheetOpen: false, dialog: null } as const;

  it("is false when nothing modal is open", () => {
    expect(selectModalOpen(base)).toBe(false);
  });

  it("is true when the palette is open", () => {
    expect(selectModalOpen({ ...base, paletteOpen: true })).toBe(true);
  });

  it("is true when the shortcut sheet is open", () => {
    expect(selectModalOpen({ ...base, shortcutSheetOpen: true })).toBe(true);
  });

  it("is true when a studio dialog is open", () => {
    expect(selectModalOpen({ ...base, dialog: "atlas" })).toBe(true);
  });
});

describe("studio dialogs and import requests", () => {
  it("openDialog / closeDialog set and clear the dialog id", () => {
    const store = createStudioStore();
    expect(store.getState().dialog).toBeNull();
    store.getState().openDialog("examples");
    expect(store.getState().dialog).toBe("examples");
    store.getState().closeDialog();
    expect(store.getState().dialog).toBeNull();
  });

  it("requestImport stores the text, bumps the nonce and opens the import dialog", () => {
    const store = createStudioStore();
    store.getState().requestImport("{}", "a.json");
    expect(store.getState().importRequest).toEqual({ text: "{}", fileName: "a.json", nonce: 1 });
    expect(store.getState().dialog).toBe("import");
    store.getState().requestImport("[]", null);
    expect(store.getState().importRequest).toEqual({ text: "[]", fileName: null, nonce: 2 });
  });

  it("clearImportRequest drops the request", () => {
    const store = createStudioStore();
    store.getState().requestImport("{}", null);
    store.getState().clearImportRequest();
    expect(store.getState().importRequest).toBeNull();
  });

  it("setMode('simulate') still succeeds while a dialog is open", () => {
    const store = createStudioStore();
    store.getState().openDialog("import");
    store.getState().setMode("simulate");
    expect(store.getState().mode).toBe("simulate");
  });
});
