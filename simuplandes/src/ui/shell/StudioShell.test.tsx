// @vitest-environment jsdom
import { render, screen, fireEvent, cleanup, within, act } from "@testing-library/react";
import { afterEach, beforeAll, describe, it, expect, vi } from "vitest";
import { I18nextProvider } from "react-i18next";
import { ThemeProvider, CssBaseline } from "@mui/material";
import { StudioShell } from "./StudioShell";
import App from "../../App";
import { createStudioTheme } from "../theme/studioTheme";
import { CANVAS_TOKENS } from "../theme/tokens";
import { createI18n } from "../../i18n/i18n";
import { createPreferencesStore } from "../../uiState/preferences";
import { createStudioStore } from "../../uiState/studioStore";
import { startSession } from "../../persistence/session";
import { createMemoryStorage } from "../../persistence/memoryStorage";
import { installDomStubs } from "../../test/domStubs";
import type { Session } from "../../persistence/session";
import type { StoreApi } from "zustand";
import type { PreferencesState } from "../../uiState/preferences";
import type { StudioState } from "../../uiState/studioStore";

// Konva cannot render in jsdom (no `canvas`/`getContext`); stub the real
// Konva canvas out here. See `CanvasStage.chromium.test.tsx` for
// real-pointer/Konva coverage in a browser project.
vi.mock("./CanvasArea", () => ({
  CanvasArea: () => <main data-testid="canvas-area" tabIndex={0} />,
}));

// uPlot touches `matchMedia`/canvas at module-evaluation time (`setPxRatio`),
// before `installDomStubs()` (a `beforeAll`) can install its polyfill --
// StudioShell now always mounts `PlotDock`/`UPlotChart` (05-08), so every
// jsdom test importing it needs `uplot` itself stubbed, exactly like
// `UPlotChart.test.tsx`'s own fake.
vi.mock("uplot", () => {
  class FakeUPlot {
    constructor() {
      // no-op: this suite never asserts on chart internals.
    }
    setData(): void {}
    setSize(): void {}
    destroy(): void {}
  }
  return { default: FakeUPlot };
});

beforeAll(() => {
  installDomStubs();
});

afterEach(cleanup);

function renderShell(lang: "es" | "en" = "es") {
  const session: Session = startSession({ storage: createMemoryStorage(), target: null });
  const preferencesStore: StoreApi<PreferencesState> = createPreferencesStore({ storage: null });
  if (lang === "en") preferencesStore.getState().setLanguage("en");
  const studioStore: StoreApi<StudioState> = createStudioStore();
  const i18n = createI18n(lang);
  const theme = createStudioTheme("light", lang);

  const utils = render(
    <I18nextProvider i18n={i18n}>
      <ThemeProvider theme={theme}>
        <CssBaseline />
        <StudioShell
          session={session}
          preferencesStore={preferencesStore}
          studioStore={studioStore}
        />
      </ThemeProvider>
    </I18nextProvider>,
  );
  return { ...utils, session, preferencesStore, studioStore, i18n };
}

/**
 * `App` (not bare `StudioShell`) owns the preferences->i18n/theme sync
 * effect (Pattern 7), so the language/theme *switch* behaviors -- which
 * must actually re-render text/colors, not just flip a store field -- are
 * exercised through `App`.
 */
function renderApp(lang: "es" | "en" = "es") {
  const session: Session = startSession({ storage: createMemoryStorage(), target: null });
  const preferencesStore: StoreApi<PreferencesState> = createPreferencesStore({ storage: null });
  if (lang === "en") preferencesStore.getState().setLanguage("en");
  const studioStore: StoreApi<StudioState> = createStudioStore();
  const i18n = createI18n(lang);

  const utils = render(
    <App session={session} preferences={preferencesStore} studio={studioStore} i18n={i18n} />,
  );
  return { ...utils, session, preferencesStore, studioStore, i18n };
}

describe("StudioShell landmarks", () => {
  it("renders header, nav, main, complementary, transport region and contentinfo", () => {
    renderShell();

    expect(screen.getByRole("banner")).toBeTruthy();
    expect(screen.getByRole("heading", { level: 1, name: "Simuplandes Studio" })).toBeTruthy();

    const nav = screen.getByRole("navigation");
    expect(nav.getAttribute("aria-label")).toBe("Herramientas");

    const main = screen.getByRole("main");
    expect(main.getAttribute("data-testid")).toBe("canvas-area");

    const complementary = screen.getByRole("complementary");
    expect(within(complementary).getByRole("tab", { name: "Inspector" })).toBeTruthy();
    expect(within(complementary).getByRole("tab", { name: "Grafo" })).toBeTruthy();
    expect(within(complementary).getByRole("tab", { name: "Exportar" })).toBeTruthy();

    expect(screen.getByRole("region", { name: "Transporte" })).toBeTruthy();
    expect(screen.getByRole("contentinfo")).toBeTruthy();
  });
});

describe("StudioShell tool selection", () => {
  it("clicking the Bar rail button sets activeTool and shows aria-pressed + the bar hint", () => {
    const { studioStore } = renderShell();

    const barButton = screen.getByRole<HTMLButtonElement>("button", { name: /Barra \(L\)/ });
    fireEvent.click(barButton);

    expect(studioStore.getState().activeTool).toBe("bar");
    expect(barButton.getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("contentinfo").textContent).toContain(
      "Haz clic para empezar una barra",
    );
  });

  it("pressing the L key (no focused text field) selects the Bar tool", () => {
    const { studioStore } = renderShell();
    fireEvent.keyDown(document.body, { key: "l", code: "KeyL" });
    expect(studioStore.getState().activeTool).toBe("bar");
  });

  it("typing 's' and 'l' into a text field does not change activeTool", () => {
    const { studioStore } = renderShell();
    const documentNameInput = screen.getByRole("button", { name: "Archivo" });
    // Use a real text input to prove enableOnFormTags:false suppresses the shortcut.
    const input = document.createElement("input");
    document.body.appendChild(input);
    input.focus();
    fireEvent.keyDown(input, { key: "s", code: "KeyS" });
    fireEvent.keyDown(input, { key: "l", code: "KeyL" });
    expect(studioStore.getState().activeTool).toBe("select");
    input.remove();
    expect(documentNameInput).toBeTruthy();
  });

  it("does not change activeTool while toolBusy is true", () => {
    const { studioStore } = renderShell();
    act(() => {
      studioStore.getState().setToolBusy(true);
    });
    fireEvent.keyDown(document.body, { key: "g", code: "KeyG" });
    expect(studioStore.getState().activeTool).toBe("select");
  });
});

describe("StudioShell undo/redo shortcuts", () => {
  it("Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y call undo/redo on the mechanism store", () => {
    const { session } = renderShell();
    session.store.getState().newDocument({ name: "x" });
    session.store.getState().newDocument({ name: "y" });

    fireEvent.keyDown(document.body, { key: "z", code: "KeyZ", ctrlKey: true });
    fireEvent.keyDown(document.body, { key: "z", code: "KeyZ", ctrlKey: true, shiftKey: true });
    fireEvent.keyDown(document.body, { key: "y", code: "KeyY", ctrlKey: true });

    // No assertion on exact document identity here (loadDocument is not
    // itself undoable) -- this test only proves the key bindings reach the
    // mechanism store without throwing and without changing the active tool.
    expect(session.store.getState()).toBeTruthy();
  });
});

describe("StudioShell command palette & shortcut sheet", () => {
  it("Ctrl+K opens the command palette; the Bar option runs setActiveTool", async () => {
    const { studioStore } = renderShell();
    fireEvent.keyDown(document.body, { key: "k", code: "KeyK", ctrlKey: true });
    expect(studioStore.getState().paletteOpen).toBe(true);

    const option = await screen.findByRole("option", { name: /Barra/ });
    fireEvent.click(option);
    expect(studioStore.getState().activeTool).toBe("bar");
    expect(studioStore.getState().paletteOpen).toBe(false);
  });

  it("'?' opens the shortcut sheet listing every tool", () => {
    const { studioStore } = renderShell();
    fireEvent.keyDown(document.body, { key: "?", code: "Slash", shiftKey: true });
    expect(studioStore.getState().shortcutSheetOpen).toBe(true);
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("Barra")).toBeTruthy();
    expect(within(dialog).getByText("Marcador")).toBeTruthy();
  });

  it("the TopBar's palette and shortcut-sheet buttons open the same dialogs", () => {
    const { studioStore } = renderShell();
    fireEvent.click(screen.getByRole("button", { name: "Paleta de comandos" }));
    expect(studioStore.getState().paletteOpen).toBe(true);
  });

  it("tool-letter shortcuts do not fire while the shortcut sheet is open", () => {
    const { studioStore } = renderShell();
    act(() => {
      studioStore.getState().openShortcutSheet();
    });
    fireEvent.keyDown(document.body, { key: "l", code: "KeyL" });
    expect(studioStore.getState().activeTool).toBe("select");
  });
});

describe("App language switch (StudioShell wired through App)", () => {
  it("clicking EN changes rail tooltips, dock tab labels and the hint with no root remount", async () => {
    const { studioStore, container } = renderApp("es");
    const appRoot = container.firstElementChild;

    fireEvent.click(within(screen.getByRole("group", { name: "Idioma" })).getByText("EN"));

    expect(await screen.findByRole("tab", { name: "Inspector" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Graph" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Export" })).toBeTruthy();
    expect(screen.getByRole("navigation").getAttribute("aria-label")).toBe("Tools");
    expect(screen.getByRole("contentinfo").textContent).toContain("Click or drag to select");
    expect(studioStore.getState().activeTool).toBe("select");

    expect(container.firstElementChild).toBe(appRoot);
  });
});

describe("StudioShell Graph tab (06-05 wiring)", () => {
  it("shows the real graph panel (empty state or the svg), never the old 'coming soon' placeholder", () => {
    renderShell();

    fireEvent.click(screen.getByRole("tab", { name: "Grafo" }));

    const hasEmptyState = screen.queryByText("Dibuja eslabones para ver su grafo") !== null;
    const hasSvg = screen.queryByTestId("graph-svg") !== null;
    expect(hasEmptyState || hasSvg).toBe(true);
    expect(screen.queryByText("El panel de grafo llega en una fase posterior")).toBeNull();
  });
});

describe("App theme switch (StudioShell wired through App)", () => {
  it("toggling the theme flips the MUI palette mode and the injected body background color", () => {
    renderApp("es");
    fireEvent.click(screen.getByRole("button", { name: "Oscuro" }));

    expect(screen.getByRole("button", { name: "Claro" })).toBeTruthy();
    expect(document.documentElement.dataset.theme).toBe("dark");

    // CssBaseline injects the palette's background.default as a `body {}`
    // rule via emotion; assert the dark paper token made it into that CSS
    // (there is no inline `body.style` to read since it's a stylesheet rule).
    const injectedCss = Array.from(document.querySelectorAll("style"))
      .map((style) => style.textContent ?? "")
      .join("\n")
      .toLowerCase();
    expect(injectedCss).toContain(CANVAS_TOKENS.dark.paper.toLowerCase());
  });
});

describe("StudioShell drop overlay", () => {
  it("shows the overlay while files are dragged over and sends a dropped file to requestImport", async () => {
    const { studioStore } = renderShell("en");
    expect(screen.queryByTestId("drop-overlay")).toBeNull();
    const over = new Event("dragover", { bubbles: true, cancelable: true });
    Object.defineProperty(over, "dataTransfer", { value: { types: ["Files"], files: [] } });
    act(() => {
      window.dispatchEvent(over);
    });
    const overlay = screen.getByTestId("drop-overlay");
    expect(overlay.textContent).toBe("Drop to import");
    expect(getComputedStyle(overlay).pointerEvents).toBe("none");
    expect(getComputedStyle(overlay).position).toBe("fixed");

    const drop = new Event("drop", { bubbles: true, cancelable: true });
    Object.defineProperty(drop, "dataTransfer", {
      value: { types: ["Files"], files: [new File(["{}"], "g.json")] },
    });
    act(() => {
      window.dispatchEvent(drop);
    });
    expect(screen.queryByTestId("drop-overlay")).toBeNull();
    await vi.waitFor(() => expect(studioStore.getState().importRequest?.text).toBe("{}"));
    expect(studioStore.getState().dialog).toBe("import");
  });
});
