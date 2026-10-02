// @vitest-environment jsdom
import { render, screen, cleanup, act } from "@testing-library/react";
import { afterEach, beforeAll, describe, it, expect } from "vitest";
import { I18nextProvider } from "react-i18next";
import { ThemeProvider, CssBaseline } from "@mui/material";
import { StatusBar } from "./StatusBar";
import { createStudioTheme } from "../theme/studioTheme";
import { createI18n } from "../../i18n/i18n";
import { createPreferencesStore } from "../../uiState/preferences";
import { createStudioStore } from "../../uiState/studioStore";
import { createMechanismStore } from "../../store";
import { createSimStore } from "../../sim/simStore";
import { installDomStubs } from "../../test/domStubs";

beforeAll(() => {
  installDomStubs();
});

afterEach(cleanup);

function renderStatusBar() {
  const preferencesStore = createPreferencesStore({ storage: null });
  const studioStore = createStudioStore();
  const mechanismStore = createMechanismStore();
  const simStore = createSimStore();
  const i18n = createI18n("es");
  const theme = createStudioTheme("light", "es");

  const utils = render(
    <I18nextProvider i18n={i18n}>
      <ThemeProvider theme={theme}>
        <CssBaseline />
        <StatusBar
          studioStore={studioStore}
          preferencesStore={preferencesStore}
          mechanismStore={mechanismStore}
          simStore={simStore}
        />
      </ThemeProvider>
    </I18nextProvider>,
  );
  return { ...utils, studioStore, mechanismStore, simStore };
}

describe("StatusBar without simStore (build-only callers)", () => {
  it("renders exactly as before, no solver segment", () => {
    const preferencesStore = createPreferencesStore({ storage: null });
    const studioStore = createStudioStore();
    const mechanismStore = createMechanismStore();
    const i18n = createI18n("es");
    const theme = createStudioTheme("light", "es");

    render(
      <I18nextProvider i18n={i18n}>
        <ThemeProvider theme={theme}>
          <CssBaseline />
          <StatusBar
            studioStore={studioStore}
            preferencesStore={preferencesStore}
            mechanismStore={mechanismStore}
          />
        </ThemeProvider>
      </I18nextProvider>,
    );

    expect(screen.getByRole("contentinfo").textContent).not.toContain("solver");
  });
});

describe("StatusBar in simulate mode", () => {
  it("shows no solver segment in build mode even with a simStore", () => {
    renderStatusBar();
    expect(screen.getByRole("contentinfo").textContent).not.toContain("solver");
  });

  it("shows the solver's 'ok' status with an exponent-formatted residual", () => {
    const { studioStore, simStore } = renderStatusBar();
    act(() => {
      studioStore.getState().setMode("simulate");
      simStore.getState().setReadout({
        input: 0,
        display: 0,
        time: 0,
        direction: 1,
        lockUp: null,
        nearSingular: false,
        solver: { status: "ok", residualNorm: 3e-12 },
      });
    });

    const text = screen.getByRole("contentinfo").textContent ?? "";
    expect(text).toContain("solver");
    expect(text).toContain("3e-12");
  });

  it("shows the studio hint in the hint slot while simulating", () => {
    const { studioStore } = renderStatusBar();
    act(() => {
      studioStore.getState().setMode("simulate");
      studioStore.getState().setHint({ key: "sim.hint.simulate" });
    });
    expect(screen.getByRole("contentinfo").textContent).toContain("Arrastra un eslabón");
  });
});
