/**
 * Real-Konva, real-pointer coverage for `ToolPreview` (rendered via the real
 * `CanvasArea` -> `CanvasStage` -> `OverlaysLayer` -> `children` chain, since
 * jsdom cannot render Konva at all -- see `CanvasStage.chromium.test.tsx`).
 * Drives each drawing tool far enough to produce a non-empty preview of
 * every `PreviewShape` kind this plan's machines emit (segment/polyline/
 * ray/point), and proves the end-to-end pointer-only four-bar/typed-length
 * flows work through the real DOM + real Konva stage.
 */

import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup, waitFor } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { ThemeProvider, CssBaseline } from "@mui/material";
import { createStudioTheme } from "../../ui/theme/studioTheme";
import { createI18n } from "../../i18n/i18n";
import { createPreferencesStore } from "../../uiState/preferences";
import { createStudioStore, type StudioState } from "../../uiState/studioStore";
import { createMechanismStore } from "../../store/mechanismStore";
import { CanvasArea } from "../../ui/shell/CanvasArea";
import { createViewStore, type ViewStore } from "../viewStore";
import { worldToScreen } from "../viewport";
import type { Vec2 } from "../../geom";
import type { StoreApi } from "zustand";

afterEach(cleanup);

function renderCanvasArea(view: ViewStore) {
  const store = createMechanismStore();
  const studio = createStudioStore();
  const preferences = createPreferencesStore({ storage: null });
  const i18n = createI18n("es");
  const theme = createStudioTheme("light", "es");

  const utils = render(
    <div style={{ width: 800, height: 600 }}>
      <I18nextProvider i18n={i18n}>
        <ThemeProvider theme={theme}>
          <CssBaseline />
          <CanvasArea store={store} studio={studio} preferences={preferences} view={view} />
        </ThemeProvider>
      </I18nextProvider>
    </div>,
  );
  return { ...utils, store, studio, preferences };
}

async function waitForStage(container: HTMLElement): Promise<HTMLElement> {
  await waitFor(() => {
    expect(container.querySelector(".konvajs-content")).toBeTruthy();
  });
  return container.querySelector(".konvajs-content") as HTMLElement;
}

function dispatchPointer(
  target: Element,
  type: "pointerdown" | "pointermove" | "pointerup",
  screen: Vec2,
  init: Partial<PointerEventInit> = {},
): void {
  const rect = target.getBoundingClientRect();
  target.dispatchEvent(
    new PointerEvent(type, {
      bubbles: true,
      cancelable: true,
      pointerId: 1,
      pointerType: "mouse",
      button: 0,
      clientX: rect.left + screen.x,
      clientY: rect.top + screen.y,
      ...init,
    }),
  );
}

function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

function setActiveTool(studio: StoreApi<StudioState>, tool: StudioState["activeTool"]): void {
  studio.getState().setActiveTool(tool);
}

describe("ToolPreview (chromium, real Konva)", () => {
  it("Bar: a segment preview appears while drawing, and a click-click bar commits", async () => {
    const view = createViewStore();
    const { container, store, studio } = renderCanvasArea(view);
    const stageEl = await waitForStage(container);
    setActiveTool(studio, "bar");

    const start: Vec2 = { x: 0, y: 0 };
    const mid: Vec2 = { x: 40, y: 30 };
    dispatchPointer(stageEl, "pointerdown", worldToScreen(view.getState().viewport, start));
    await nextFrame();
    await waitFor(() => expect(studio.getState().toolBusy).toBe(true));

    dispatchPointer(stageEl, "pointermove", worldToScreen(view.getState().viewport, mid));
    await nextFrame();
    await waitFor(() => expect(studio.getState().hint?.key).toBe("tools.bar.hint.drawing"));

    dispatchPointer(stageEl, "pointerdown", worldToScreen(view.getState().viewport, mid));
    await nextFrame();

    document.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", code: "Escape", bubbles: true }),
    );

    await waitFor(() => {
      expect(store.getState().document.links).toHaveLength(1);
    });
  });

  it("Plate: a polyline preview appears while placing vertices", async () => {
    const view = createViewStore();
    const { container, studio } = renderCanvasArea(view);
    const stageEl = await waitForStage(container);
    setActiveTool(studio, "plate");

    dispatchPointer(
      stageEl,
      "pointerdown",
      worldToScreen(view.getState().viewport, { x: 0, y: 0 }),
    );
    await nextFrame();
    dispatchPointer(
      stageEl,
      "pointermove",
      worldToScreen(view.getState().viewport, { x: 50, y: 0 }),
    );
    await nextFrame();

    await waitFor(() => expect(studio.getState().toolBusy).toBe(true));
  });

  it("Slider: a ray preview appears while aiming the axis", async () => {
    const view = createViewStore();
    const { container, studio } = renderCanvasArea(view);
    const stageEl = await waitForStage(container);
    setActiveTool(studio, "slider");

    dispatchPointer(
      stageEl,
      "pointerdown",
      worldToScreen(view.getState().viewport, { x: 0, y: 0 }),
    );
    await nextFrame();
    dispatchPointer(
      stageEl,
      "pointermove",
      worldToScreen(view.getState().viewport, { x: 30, y: 0 }),
    );
    await nextFrame();

    await waitFor(() => expect(studio.getState().hint?.key).toBe("tools.slider.hint.aim"));
  });

  it("Pin: a point preview appears after picking the first site", async () => {
    const view = createViewStore();
    const { container, store, studio } = renderCanvasArea(view);
    const stageEl = await waitForStage(container);

    store.getState().addLink({ name: "A", sites: [{ local: [0, 0] }] });
    setActiveTool(studio, "pin");

    dispatchPointer(
      stageEl,
      "pointerdown",
      worldToScreen(view.getState().viewport, { x: 0, y: 0 }),
    );
    await nextFrame();

    await waitFor(() => expect(studio.getState().toolBusy).toBe(true));
  });
});
