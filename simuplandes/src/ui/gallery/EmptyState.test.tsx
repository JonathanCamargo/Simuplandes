// @vitest-environment jsdom
import { render, screen, fireEvent, cleanup, act } from "@testing-library/react";
import { afterEach, beforeAll, describe, it, expect } from "vitest";
import { I18nextProvider } from "react-i18next";
import { ThemeProvider } from "@mui/material";
import { EmptyState } from "./EmptyState";
import { createStudioTheme } from "../theme/studioTheme";
import { createI18n } from "../../i18n/i18n";
import { createStudioStore } from "../../uiState/studioStore";
import { createMechanismStore, buildExampleFourBar } from "../../store";
import { installDomStubs } from "../../test/domStubs";

beforeAll(() => {
  installDomStubs();
});
afterEach(cleanup);

function setup() {
  const store = createMechanismStore();
  const studio = createStudioStore();
  render(
    <I18nextProvider i18n={createI18n("en")}>
      <ThemeProvider theme={createStudioTheme("light", "en")}>
        <EmptyState store={store} studio={studio} extraActions={<span>extra-slot</span>} />
      </ThemeProvider>
    </I18nextProvider>,
  );
  return { store, studio };
}

describe("EmptyState", () => {
  it("shows for an empty document with the select tool, with five cards and the slot", () => {
    setup();
    const root = screen.getByTestId("empty-state");
    expect(root.style.pointerEvents).toBe("");
    expect(screen.getAllByTestId("example-card")).toHaveLength(5);
    expect(screen.getByText("extra-slot")).toBeTruthy();
  });

  it("opens the import dialog from its button", () => {
    const { studio } = setup();
    fireEvent.click(screen.getByRole("button", { name: "Import graph…" }));
    expect(studio.getState().dialog).toBe("import");
  });

  it("opens the atlas dialog from its button", () => {
    const { studio } = setup();
    fireEvent.click(screen.getByTestId("empty-state-atlas"));
    expect(studio.getState().dialog).toBe("atlas");
  });

  it("hides after picking another tool", () => {
    const { studio } = setup();
    act(() => studio.getState().setActiveTool("groundPivot"));
    expect(screen.queryByTestId("empty-state")).toBeNull();
    act(() => studio.getState().setActiveTool("select"));
    expect(screen.getByTestId("empty-state")).toBeTruthy();
  });

  it("hides once a link exists and in Simulate mode", () => {
    const { store, studio } = setup();
    act(() => studio.getState().setMode("simulate"));
    expect(screen.queryByTestId("empty-state")).toBeNull();
    act(() => studio.getState().setMode("build"));
    expect(screen.getByTestId("empty-state")).toBeTruthy();
    act(() => {
      buildExampleFourBar(store);
    });
    expect(screen.queryByTestId("empty-state")).toBeNull();
  });

  it("stays hidden after dismissal", () => {
    const { store } = setup();
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(screen.queryByTestId("empty-state")).toBeNull();
    act(() => store.getState().newDocument());
    expect(screen.queryByTestId("empty-state")).toBeNull();
  });
});
