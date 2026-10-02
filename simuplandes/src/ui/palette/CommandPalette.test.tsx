// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { I18nextProvider } from "react-i18next";
import { ThemeProvider, CssBaseline } from "@mui/material";
import { createI18n } from "../../i18n/i18n";
import { createStudioTheme } from "../theme/studioTheme";
import { createStudioStore } from "../../uiState/studioStore";
import { createPreferencesStore } from "../../uiState/preferences";
import { createMechanismStore, buildExampleFourBar } from "../../store";
import { installDomStubs } from "../../test/domStubs";
import { CommandPalette } from "./CommandPalette";
import type { Language } from "../../i18n/numberFormat";
import type { StoreApi } from "zustand";
import type { StudioState } from "../../uiState/studioStore";
import type { PreferencesState } from "../../uiState/preferences";
import type { MechanismStore } from "../../store";

beforeAll(() => {
  installDomStubs();
});
afterEach(cleanup);

function setup(lang: Language = "es") {
  const studioStore: StoreApi<StudioState> = createStudioStore();
  const preferencesStore: StoreApi<PreferencesState> = createPreferencesStore({ storage: null });
  const mechanismStore: MechanismStore = createMechanismStore();
  const i18n = createI18n(lang);
  const theme = createStudioTheme("light", lang);

  render(
    <I18nextProvider i18n={i18n}>
      <ThemeProvider theme={theme}>
        <CssBaseline />
        <button type="button">outside trigger</button>
        <CommandPalette
          studioStore={studioStore}
          mechanismStore={mechanismStore}
          preferencesStore={preferencesStore}
        />
      </ThemeProvider>
    </I18nextProvider>,
  );

  return { studioStore, preferencesStore, mechanismStore, i18n };
}

function typeInto(input: HTMLElement, value: string): void {
  fireEvent.change(input, { target: { value } });
}

describe("CommandPalette", () => {
  it("is not in the document while closed", () => {
    setup();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("focuses the search input on open", async () => {
    const { studioStore } = setup();
    act(() => studioStore.getState().openPalette());
    const input = await screen.findByPlaceholderText("Escribe un comando o herramienta…");
    await waitFor(() => expect(document.activeElement).toBe(input));
  });

  it("lists every registry tool as a selectable option", async () => {
    const { studioStore } = setup();
    act(() => studioStore.getState().openPalette());
    expect(await screen.findByRole("option", { name: /Barra/ })).toBeTruthy();
    expect(screen.getByRole("option", { name: /Pasador/ })).toBeTruthy();
    expect(screen.getByRole("option", { name: /Marcador/ })).toBeTruthy();
    expect(screen.getByRole("option", { name: /Seleccionar/ })).toBeTruthy();
    expect(screen.getByRole("option", { name: /Desplazar/ })).toBeTruthy();
    expect(screen.getByRole("option", { name: /Placa/ })).toBeTruthy();
    expect(screen.getByRole("option", { name: /Pivote a tierra/ })).toBeTruthy();
    expect(screen.getByRole("option", { name: /Corredera/ })).toBeTruthy();
    expect(screen.getByRole("option", { name: /Motor/ })).toBeTruthy();
  });

  it("also lists undo/redo/delete/fit/grid/snap/theme/language/shortcuts", async () => {
    const { studioStore } = setup();
    act(() => studioStore.getState().openPalette());
    expect(await screen.findByRole("option", { name: /Deshacer/ })).toBeTruthy();
    expect(screen.getByRole("option", { name: /Rehacer/ })).toBeTruthy();
    expect(screen.getByRole("option", { name: /Eliminar/ })).toBeTruthy();
    expect(screen.getByRole("option", { name: /Ajustar a la vista/ })).toBeTruthy();
    expect(screen.getByRole("option", { name: /cuadrícula/i })).toBeTruthy();
    expect(screen.getByRole("option", { name: /ajuste/i })).toBeTruthy();
    expect(screen.getByRole("option", { name: /tema/i })).toBeTruthy();
    expect(screen.getByRole("option", { name: "Español" })).toBeTruthy();
    expect(screen.getByRole("option", { name: "English" })).toBeTruthy();
    expect(screen.getByRole("option", { name: /Hoja de atajos/ })).toBeTruthy();
  });

  it("typing filters to the matching tool (es: 'barra')", async () => {
    const { studioStore } = setup("es");
    act(() => studioStore.getState().openPalette());
    const input = await screen.findByPlaceholderText("Escribe un comando o herramienta…");
    typeInto(input, "barra");
    await waitFor(() => {
      expect(screen.getByRole("option", { name: /Barra/ })).toBeTruthy();
      expect(screen.queryByRole("option", { name: /Pasador/ })).toBeNull();
    });
  });

  it("typing filters to the matching tool (en: 'bar')", async () => {
    const { studioStore } = setup("en");
    act(() => studioStore.getState().openPalette());
    const input = await screen.findByPlaceholderText("Type a command or tool…");
    typeInto(input, "bar");
    await waitFor(() => {
      expect(screen.getByRole("option", { name: /^Bar/ })).toBeTruthy();
      expect(screen.queryByRole("option", { name: /^Pin/ })).toBeNull();
    });
  });

  it("ArrowDown moves the active item (aria-selected)", async () => {
    const { studioStore } = setup();
    act(() => studioStore.getState().openPalette());
    const dialog = await screen.findByRole("dialog");
    const input = within(dialog).getByPlaceholderText("Escribe un comando o herramienta…");
    const first = within(dialog).getAllByRole("option")[0];
    expect(first.getAttribute("aria-selected")).toBe("true");
    // Fired on the input (a descendant of cmdk's own root keydown listener),
    // not the outer dialog wrapper -- DOM events only propagate through a
    // target's ANCESTORS, never into its descendants.
    fireEvent.keyDown(input, { key: "ArrowDown" });
    await waitFor(() => {
      const options = within(dialog).getAllByRole("option");
      expect(options[0].getAttribute("aria-selected")).toBe("false");
      expect(options[1].getAttribute("aria-selected")).toBe("true");
    });
  });

  it("Enter runs the selected tool command and closes the palette", async () => {
    const { studioStore } = setup();
    act(() => studioStore.getState().openPalette());
    const input = await screen.findByPlaceholderText("Escribe un comando o herramienta…");
    typeInto(input, "barra");
    await waitFor(() => expect(screen.getByRole("option", { name: /Barra/ })).toBeTruthy());
    fireEvent.keyDown(input, { key: "Enter" });
    expect(studioStore.getState().activeTool).toBe("bar");
    expect(studioStore.getState().paletteOpen).toBe(false);
  });

  it("Esc closes the palette without opening it again, and restores focus", async () => {
    const { studioStore } = setup();
    const outside = screen.getByRole("button", { name: "outside trigger" });
    outside.focus();
    act(() => studioStore.getState().openPalette());
    const input = await screen.findByPlaceholderText("Escribe un comando o herramienta…");
    fireEvent.keyDown(input, { key: "Escape" });
    expect(studioStore.getState().paletteOpen).toBe(false);
    await waitFor(() => expect(document.activeElement).toBe(outside));
  });

  it("Esc's keydown never reaches a window listener (stopped before bubbling)", async () => {
    const { studioStore } = setup();
    act(() => studioStore.getState().openPalette());
    const input = await screen.findByPlaceholderText("Escribe un comando o herramienta…");
    const windowListener = vi.fn();
    window.addEventListener("keydown", windowListener);
    fireEvent.keyDown(input, { key: "Escape" });
    window.removeEventListener("keydown", windowListener);
    expect(windowListener).not.toHaveBeenCalled();
  });

  it("view:fit increments studio.fitRequest", async () => {
    const { studioStore } = setup();
    const before = studioStore.getState().fitRequest;
    act(() => studioStore.getState().openPalette());
    const input = await screen.findByPlaceholderText("Escribe un comando o herramienta…");
    typeInto(input, "Ajustar a la vista");
    await waitFor(() => expect(screen.getByRole("option", { name: /Ajustar/ })).toBeTruthy());
    fireEvent.keyDown(input, { key: "Enter" });
    expect(studioStore.getState().fitRequest).toBe(before + 1);
  });

  it("toggles grid and switches language", async () => {
    const { studioStore, preferencesStore } = setup();
    const gridBefore = preferencesStore.getState().gridVisible;
    act(() => studioStore.getState().openPalette());
    let input = await screen.findByPlaceholderText("Escribe un comando o herramienta…");
    typeInto(input, "cuadrícula");
    await waitFor(() => expect(screen.getByRole("option", { name: /cuadrícula/i })).toBeTruthy());
    fireEvent.keyDown(input, { key: "Enter" });
    expect(preferencesStore.getState().gridVisible).toBe(!gridBefore);

    act(() => studioStore.getState().openPalette());
    input = await screen.findByPlaceholderText("Escribe un comando o herramienta…");
    typeInto(input, "English");
    await waitFor(() => expect(screen.getByRole("option", { name: "English" })).toBeTruthy());
    fireEvent.keyDown(input, { key: "Enter" });
    expect(preferencesStore.getState().language).toBe("en");
  });

  it("toggles snap and theme", async () => {
    const { studioStore, preferencesStore } = setup();
    const snapBefore = preferencesStore.getState().snapEnabled;
    act(() => studioStore.getState().openPalette());
    let input = await screen.findByPlaceholderText("Escribe un comando o herramienta…");
    typeInto(input, "Alternar ajuste");
    await waitFor(() =>
      expect(screen.getByRole("option", { name: /Alternar ajuste/ })).toBeTruthy(),
    );
    fireEvent.keyDown(input, { key: "Enter" });
    expect(preferencesStore.getState().snapEnabled).toBe(!snapBefore);

    const themeBefore = preferencesStore.getState().themeMode;
    act(() => studioStore.getState().openPalette());
    input = await screen.findByPlaceholderText("Escribe un comando o herramienta…");
    typeInto(input, "Alternar tema");
    await waitFor(() => expect(screen.getByRole("option", { name: /Alternar tema/ })).toBeTruthy());
    fireEvent.keyDown(input, { key: "Enter" });
    expect(preferencesStore.getState().themeMode).not.toBe(themeBefore);
  });

  it("deletes the selection via edit:delete", async () => {
    const { studioStore, mechanismStore } = setup();
    buildExampleFourBar(mechanismStore);
    const firstLinkId = mechanismStore.getState().document.links[0].id;
    mechanismStore.getState().select([firstLinkId]);
    act(() => studioStore.getState().openPalette());
    const input = await screen.findByPlaceholderText("Escribe un comando o herramienta…");
    typeInto(input, "Eliminar");
    await waitFor(() => expect(screen.getByRole("option", { name: /Eliminar/ })).toBeTruthy());
    fireEvent.keyDown(input, { key: "Enter" });
    expect(
      mechanismStore.getState().document.links.find((l) => l.id === firstLinkId),
    ).toBeUndefined();
  });

  it("undo/redo run through the mechanism store", async () => {
    const { studioStore, mechanismStore } = setup();
    buildExampleFourBar(mechanismStore);
    const afterBuild = mechanismStore.getState().document;
    expect(mechanismStore.getState().canUndo).toBe(true);

    act(() => studioStore.getState().openPalette());
    let input = await screen.findByPlaceholderText("Escribe un comando o herramienta…");
    typeInto(input, "Deshacer");
    await waitFor(() => expect(screen.getByRole("option", { name: /Deshacer/ })).toBeTruthy());
    fireEvent.keyDown(input, { key: "Enter" });
    expect(mechanismStore.getState().document).not.toBe(afterBuild);
    expect(mechanismStore.getState().canRedo).toBe(true);

    act(() => studioStore.getState().openPalette());
    input = await screen.findByPlaceholderText("Escribe un comando o herramienta…");
    typeInto(input, "Rehacer");
    await waitFor(() => expect(screen.getByRole("option", { name: /Rehacer/ })).toBeTruthy());
    fireEvent.keyDown(input, { key: "Enter" });
    expect(mechanismStore.getState().document).toEqual(afterBuild);
  });

  it("help:shortcuts opens the shortcut sheet", async () => {
    const { studioStore } = setup();
    act(() => studioStore.getState().openPalette());
    const input = await screen.findByPlaceholderText("Escribe un comando o herramienta…");
    typeInto(input, "Hoja de atajos");
    await waitFor(() =>
      expect(screen.getByRole("option", { name: /Hoja de atajos/ })).toBeTruthy(),
    );
    fireEvent.keyDown(input, { key: "Enter" });
    expect(studioStore.getState().shortcutSheetOpen).toBe(true);
  });

  it("shows the empty state for a query matching nothing", async () => {
    const { studioStore } = setup();
    act(() => studioStore.getState().openPalette());
    const input = await screen.findByPlaceholderText("Escribe un comando o herramienta…");
    typeInto(input, "zzzznomatchzzzz");
    await waitFor(() => expect(screen.getByText("No se encontraron comandos")).toBeTruthy());
  });
});
