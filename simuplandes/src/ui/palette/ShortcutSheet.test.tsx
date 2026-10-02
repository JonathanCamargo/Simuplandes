// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { I18nextProvider } from "react-i18next";
import { ThemeProvider, CssBaseline } from "@mui/material";
import { createI18n } from "../../i18n/i18n";
import { createStudioTheme } from "../theme/studioTheme";
import { createStudioStore } from "../../uiState/studioStore";
import { installDomStubs } from "../../test/domStubs";
import { TOOL_REGISTRY, EDIT_SHORTCUTS } from "../../tools/registry";
import { ShortcutSheet, formatShortcutDisplay } from "./ShortcutSheet";
import type { Language } from "../../i18n/numberFormat";
import type { StoreApi } from "zustand";
import type { StudioState } from "../../uiState/studioStore";

beforeAll(() => {
  installDomStubs();
});
afterEach(cleanup);

function setup(lang: Language = "es") {
  const studioStore: StoreApi<StudioState> = createStudioStore();
  const i18n = createI18n(lang);
  const theme = createStudioTheme("light", lang);

  render(
    <I18nextProvider i18n={i18n}>
      <ThemeProvider theme={theme}>
        <CssBaseline />
        <ShortcutSheet studioStore={studioStore} />
      </ThemeProvider>
    </I18nextProvider>,
  );

  return { studioStore, i18n };
}

describe("ShortcutSheet", () => {
  it("is not in the document while closed", () => {
    setup();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("lists all 9 tools with their key and localized label", () => {
    const { studioStore } = setup("es");
    act(() => studioStore.getState().openShortcutSheet());
    const dialog = screen.getByRole("dialog");
    for (const tool of TOOL_REGISTRY) {
      expect(within(dialog).getByText(tool.key.toUpperCase())).toBeTruthy();
    }
    expect(within(dialog).getAllByText(/./).length).toBeGreaterThan(0);
    expect(within(dialog).getByText("Barra")).toBeTruthy();
    expect(within(dialog).getByText("Marcador")).toBeTruthy();
  });

  it("lists every EDIT_SHORTCUTS row", () => {
    const { studioStore } = setup("es");
    act(() => studioStore.getState().openShortcutSheet());
    const dialog = screen.getByRole("dialog");
    for (const shortcut of EDIT_SHORTCUTS) {
      expect(
        within(dialog).getAllByText(formatShortcutDisplay(shortcut.display)).length,
      ).toBeGreaterThan(0);
    }
  });

  it("switches language live", () => {
    const { studioStore, i18n } = setup("es");
    act(() => studioStore.getState().openShortcutSheet());
    expect(screen.getByRole("dialog").textContent).toContain("Herramientas");
    act(() => {
      void i18n.changeLanguage("en");
    });
    expect(screen.getByRole("dialog").textContent).toContain("Tools");
  });

  it("closes via the close button", () => {
    const { studioStore } = setup();
    act(() => studioStore.getState().openShortcutSheet());
    fireEvent.click(screen.getByRole("button", { name: "Cerrar" }));
    expect(studioStore.getState().shortcutSheetOpen).toBe(false);
  });
});

describe("formatShortcutDisplay", () => {
  const originalPlatform = navigator.platform;

  afterEach(() => {
    vi.restoreAllMocks();
    Object.defineProperty(navigator, "platform", { value: originalPlatform, configurable: true });
  });

  it("renders 'Ctrl' for a non-mac platform", () => {
    Object.defineProperty(navigator, "platform", { value: "Win32", configurable: true });
    expect(formatShortcutDisplay("Ctrl/Cmd+Z")).toBe("Ctrl+Z");
  });

  it("renders '⌘' for a mac platform", () => {
    Object.defineProperty(navigator, "platform", { value: "MacIntel", configurable: true });
    expect(formatShortcutDisplay("Ctrl/Cmd+Shift+Z")).toBe("⌘+Shift+Z");
  });

  it("passes through a display string with no Ctrl/Cmd token unchanged", () => {
    Object.defineProperty(navigator, "platform", { value: "Win32", configurable: true });
    expect(formatShortcutDisplay("Delete/Backspace")).toBe("Delete/Backspace");
  });
});
