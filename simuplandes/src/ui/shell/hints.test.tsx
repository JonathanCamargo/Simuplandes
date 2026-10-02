// @vitest-environment jsdom
/**
 * UX-05's hint guarantee, verified two ways:
 *  1. Render the real shell (CanvasArea mocked -- Konva can't render in
 *     jsdom) for both languages, and walk every `TOOL_REGISTRY` tool: after
 *     `setActiveTool(id)`, the StatusBar's rendered hint text equals
 *     `t(tool.hintKey)` and is non-empty.
 *  2. Mount the REAL `useToolController` (a plain hook -- no Konva) via
 *     `renderHook`, sharing the SAME `studioStore`/mechanism store the
 *     rendered shell reads from, and prove a real pointerdown on the Bar
 *     tool changes the published hint from idle to the drawing hint.
 */
import { act, cleanup, render, renderHook, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { I18nextProvider } from "react-i18next";
import { ThemeProvider, CssBaseline } from "@mui/material";
import { StudioShell } from "./StudioShell";
import { createStudioTheme } from "../theme/studioTheme";
import { createI18n } from "../../i18n/i18n";
import { createPreferencesStore } from "../../uiState/preferences";
import { createStudioStore } from "../../uiState/studioStore";
import { startSession } from "../../persistence/session";
import { createMemoryStorage } from "../../persistence/memoryStorage";
import { createViewStore } from "../../canvas/viewStore";
import { installDomStubs } from "../../test/domStubs";
import { TOOL_REGISTRY } from "../../tools/registry";
import { useToolController } from "../../tools/react/useToolController";
import type { Session } from "../../persistence/session";
import type { StoreApi } from "zustand";
import type { PreferencesState } from "../../uiState/preferences";
import type { StudioState } from "../../uiState/studioStore";
import type { CanvasPointerEvent } from "../../canvas/CanvasStage";

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

function setup(lang: "es" | "en") {
  const session: Session = startSession({ storage: createMemoryStorage(), target: null });
  const preferencesStore: StoreApi<PreferencesState> = createPreferencesStore({ storage: null });
  if (lang === "en") preferencesStore.getState().setLanguage("en");
  const studioStore: StoreApi<StudioState> = createStudioStore();
  const i18n = createI18n(lang);
  const theme = createStudioTheme("light", lang);

  render(
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

  return { session, preferencesStore, studioStore, i18n };
}

describe.each(["es", "en"] as const)(
  "every tool publishes a non-empty, correctly localized idle hint (%s)",
  (lang) => {
    it("StatusBar's hint text equals t(tool.hintKey) for every registry tool", () => {
      const { studioStore, i18n } = setup(lang);
      const contentinfo = screen.getByRole("contentinfo");

      for (const tool of TOOL_REGISTRY) {
        act(() => {
          studioStore.getState().setActiveTool(tool.id);
        });
        const expected = i18n.t(tool.hintKey);
        expect(expected).not.toBe(tool.hintKey);
        expect(expected.length).toBeGreaterThan(0);
        expect(contentinfo.textContent).toContain(expected);
      }
    });
  },
);

describe("the Bar tool's hint updates through the real tool controller", () => {
  it("changes from the idle hint to the drawing hint after a real pointerdown", () => {
    const { session, studioStore, preferencesStore } = setup("es");
    act(() => {
      studioStore.getState().setActiveTool("bar");
    });

    const view = createViewStore({ widthPx: 800, heightPx: 600 });
    const { result } = renderHook(() =>
      useToolController({
        store: session.store,
        studio: studioStore,
        preferences: preferencesStore,
        view,
        t: (key: string) => key,
        lang: "es",
        schedule: (cb) => {
          cb();
          return 0;
        },
      }),
    );

    // Mounting the controller for the already-active "bar" tool publishes
    // its idle hint immediately (before any pointer event).
    expect(studioStore.getState().hint?.key).toBe("tools.bar.hint.idle");

    const down: CanvasPointerEvent = {
      type: "pointerdown",
      screen: { x: 0, y: 0 },
      world: { x: 0, y: 0 },
      snap: { kind: "none", point: { x: 0, y: 0 } },
      button: 0,
      shiftKey: false,
      ctrlKey: false,
      altKey: false,
    };

    act(() => {
      result.current.onPointer(down);
    });

    expect(studioStore.getState().hint?.key).toBe("tools.bar.hint.drawing");
    expect(studioStore.getState().toolBusy).toBe(true);
  });
});
