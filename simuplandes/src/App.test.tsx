// @vitest-environment jsdom
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { afterEach, beforeAll, describe, it, expect, vi } from "vitest";
import App from "./App";
import { startSession } from "./persistence/session";
import { createMemoryStorage } from "./persistence/memoryStorage";
import { createPreferencesStore } from "./uiState/preferences";
import { createStudioStore } from "./uiState/studioStore";
import { createI18n } from "./i18n/i18n";
import { installDomStubs } from "./test/domStubs";

// Konva cannot render in jsdom (no `canvas`/`getContext`); every jsdom test
// stubs the real Konva canvas out. See `CanvasStage.chromium.test.tsx` for
// real-pointer/Konva coverage in a browser project.
vi.mock("./ui/shell/CanvasArea", () => ({
  CanvasArea: () => <main data-testid="canvas-area" tabIndex={0} />,
}));

// uPlot touches `matchMedia`/canvas at module-evaluation time (`setPxRatio`),
// which runs before `installDomStubs()` (a `beforeAll`) can install its
// polyfill -- App now renders the real `PlotDock`/`UPlotChart` (05-08), so
// every jsdom test importing `App` needs `uplot` itself stubbed out, exactly
// like `UPlotChart.test.tsx`'s own fake.
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

function renderApp() {
  const session = startSession({ storage: createMemoryStorage(), target: null });
  const preferences = createPreferencesStore({ storage: null });
  const studio = createStudioStore();
  const i18n = createI18n("es");
  return render(<App session={session} preferences={preferences} studio={studio} i18n={i18n} />);
}

describe("App", () => {
  it("renders the Simuplandes Studio heading", () => {
    renderApp();
    const heading = screen.getByRole("heading", { level: 1, name: /Simuplandes Studio/ });
    expect(heading).toBeTruthy();
  });

  it("File menu contains Load example", () => {
    renderApp();
    fireEvent.click(screen.getByRole("button", { name: "Archivo" }));
    expect(screen.getByRole("menuitem", { name: "Cargar ejemplo de cuatro barras" })).toBeTruthy();
  });
});
