// @vitest-environment jsdom
import { renderHook, fireEvent, cleanup, act } from "@testing-library/react";
import { afterEach, beforeAll, describe, it, expect } from "vitest";
import { useStudioShortcuts, resolveToolIdForKey } from "./useStudioShortcuts";
import { createStudioStore } from "../../uiState/studioStore";
import { createMechanismStore, buildExampleFourBar } from "../../store";
import { installDomStubs } from "../../test/domStubs";

beforeAll(() => {
  installDomStubs();
});

afterEach(cleanup);

describe("resolveToolIdForKey", () => {
  it("returns undefined for an undefined key", () => {
    expect(resolveToolIdForKey(undefined)).toBeUndefined();
  });

  it("returns undefined for a key not in the registry", () => {
    expect(resolveToolIdForKey("z")).toBeUndefined();
  });

  it("returns the matching ToolId for a registered key", () => {
    expect(resolveToolIdForKey("l")).toBe("bar");
    expect(resolveToolIdForKey("v")).toBe("select");
  });
});

describe("useStudioShortcuts", () => {
  it("pressing a registered tool key sets activeTool", () => {
    const studioStore = createStudioStore();
    const mechanismStore = createMechanismStore();
    renderHook(() => useStudioShortcuts(studioStore, mechanismStore));

    fireEvent.keyDown(document.body, { key: "l", code: "KeyL" });
    expect(studioStore.getState().activeTool).toBe("bar");
  });

  it("does nothing while toolBusy is true", () => {
    const studioStore = createStudioStore();
    const mechanismStore = createMechanismStore();
    renderHook(() => useStudioShortcuts(studioStore, mechanismStore));

    act(() => {
      studioStore.getState().setToolBusy(true);
    });
    fireEvent.keyDown(document.body, { key: "g", code: "KeyG" });
    expect(studioStore.getState().activeTool).toBe("select");
  });

  it("does nothing while the command palette is open", () => {
    const studioStore = createStudioStore();
    const mechanismStore = createMechanismStore();
    renderHook(() => useStudioShortcuts(studioStore, mechanismStore));

    act(() => {
      studioStore.getState().openPalette();
    });
    fireEvent.keyDown(document.body, { key: "g", code: "KeyG" });
    expect(studioStore.getState().activeTool).toBe("select");
  });

  it("mod+z calls undo on the mechanism store (repeatedly walks back to empty)", () => {
    const studioStore = createStudioStore();
    const mechanismStore = createMechanismStore();
    buildExampleFourBar(mechanismStore);
    renderHook(() => useStudioShortcuts(studioStore, mechanismStore));

    expect(mechanismStore.getState().canUndo).toBe(true);
    let steps = 0;
    while (mechanismStore.getState().canUndo && steps < 20) {
      fireEvent.keyDown(document.body, { key: "z", code: "KeyZ", ctrlKey: true });
      steps += 1;
    }
    expect(mechanismStore.getState().canUndo).toBe(false);
    expect(mechanismStore.getState().document.links.length).toBe(0);
  });

  it("mod+shift+z calls redo on the mechanism store", () => {
    const studioStore = createStudioStore();
    const mechanismStore = createMechanismStore();
    buildExampleFourBar(mechanismStore);
    mechanismStore.getState().undo();
    renderHook(() => useStudioShortcuts(studioStore, mechanismStore));

    expect(mechanismStore.getState().canRedo).toBe(true);
    const beforeRedoCount = mechanismStore.getState().document.markers.length;
    fireEvent.keyDown(document.body, { key: "z", code: "KeyZ", ctrlKey: true, shiftKey: true });
    expect(mechanismStore.getState().document.markers.length).toBeGreaterThan(beforeRedoCount);
  });

  it("mod+y calls redo on the mechanism store", () => {
    const studioStore = createStudioStore();
    const mechanismStore = createMechanismStore();
    buildExampleFourBar(mechanismStore);
    mechanismStore.getState().undo();
    renderHook(() => useStudioShortcuts(studioStore, mechanismStore));

    expect(mechanismStore.getState().canRedo).toBe(true);
    const beforeRedoCount = mechanismStore.getState().document.markers.length;
    fireEvent.keyDown(document.body, { key: "y", code: "KeyY", ctrlKey: true });
    expect(mechanismStore.getState().document.markers.length).toBeGreaterThan(beforeRedoCount);
  });

  it("does not fire tool shortcuts while focus is in a text field", () => {
    const studioStore = createStudioStore();
    const mechanismStore = createMechanismStore();
    renderHook(() => useStudioShortcuts(studioStore, mechanismStore));

    const input = document.createElement("input");
    document.body.appendChild(input);
    input.focus();
    fireEvent.keyDown(input, { key: "l", code: "KeyL" });
    expect(studioStore.getState().activeTool).toBe("select");
    input.remove();
  });

  it("mod+k opens the command palette, even while focus is in a text field", () => {
    const studioStore = createStudioStore();
    const mechanismStore = createMechanismStore();
    renderHook(() => useStudioShortcuts(studioStore, mechanismStore));

    const input = document.createElement("input");
    document.body.appendChild(input);
    input.focus();
    fireEvent.keyDown(input, { key: "k", code: "KeyK", ctrlKey: true });
    expect(studioStore.getState().paletteOpen).toBe(true);
    input.remove();
  });

  it("'?' opens the shortcut sheet", () => {
    const studioStore = createStudioStore();
    const mechanismStore = createMechanismStore();
    renderHook(() => useStudioShortcuts(studioStore, mechanismStore));

    fireEvent.keyDown(document.body, { key: "?", code: "Slash", shiftKey: true });
    expect(studioStore.getState().shortcutSheetOpen).toBe(true);
  });

  it("'?' does not open the shortcut sheet while focus is in a text field", () => {
    const studioStore = createStudioStore();
    const mechanismStore = createMechanismStore();
    renderHook(() => useStudioShortcuts(studioStore, mechanismStore));

    const input = document.createElement("input");
    document.body.appendChild(input);
    input.focus();
    fireEvent.keyDown(input, { key: "?", code: "Slash", shiftKey: true });
    expect(studioStore.getState().shortcutSheetOpen).toBe(false);
    input.remove();
  });
});

describe("useStudioShortcuts Space (Build/Simulate toggle)", () => {
  it("Space toggles the mode, twice returns to build", () => {
    const studioStore = createStudioStore();
    const mechanismStore = createMechanismStore();
    renderHook(() => useStudioShortcuts(studioStore, mechanismStore));

    fireEvent.keyDown(document.body, { key: " ", code: "Space" });
    expect(studioStore.getState().mode).toBe("simulate");

    fireEvent.keyDown(document.body, { key: " ", code: "Space" });
    expect(studioStore.getState().mode).toBe("build");
  });

  it("does nothing while a modal (palette) is open", () => {
    const studioStore = createStudioStore();
    const mechanismStore = createMechanismStore();
    renderHook(() => useStudioShortcuts(studioStore, mechanismStore));

    act(() => {
      studioStore.getState().openPalette();
    });
    fireEvent.keyDown(document.body, { key: " ", code: "Space" });
    expect(studioStore.getState().mode).toBe("build");
  });

  it("does nothing while toolBusy is true", () => {
    const studioStore = createStudioStore();
    const mechanismStore = createMechanismStore();
    renderHook(() => useStudioShortcuts(studioStore, mechanismStore));

    act(() => {
      studioStore.getState().setToolBusy(true);
    });
    fireEvent.keyDown(document.body, { key: " ", code: "Space" });
    expect(studioStore.getState().mode).toBe("build");
  });

  it("does not fire while focus is in a text field (native Space still works there)", () => {
    const studioStore = createStudioStore();
    const mechanismStore = createMechanismStore();
    renderHook(() => useStudioShortcuts(studioStore, mechanismStore));

    const input = document.createElement("input");
    document.body.appendChild(input);
    input.focus();
    fireEvent.keyDown(input, { key: " ", code: "Space" });
    expect(studioStore.getState().mode).toBe("build");
    input.remove();
  });
});
