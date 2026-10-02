// @vitest-environment jsdom
import { render, screen, fireEvent, cleanup, waitFor, within } from "@testing-library/react";
import { afterEach, beforeAll, describe, it, expect, vi } from "vitest";
import { I18nextProvider } from "react-i18next";
import { ThemeProvider, CssBaseline } from "@mui/material";
import { TopBar } from "./TopBar";
import { createStudioTheme } from "../theme/studioTheme";
import { createI18n } from "../../i18n/i18n";
import { createPreferencesStore } from "../../uiState/preferences";
import { createStudioStore } from "../../uiState/studioStore";
import { startSession, SESSION_STORAGE_KEY } from "../../persistence/session";
import { createMemoryStorage } from "../../persistence/memoryStorage";
import { serializeDocument } from "../../model";
import { fourBarFixtureParsed } from "../../model/__fixtures__/fourBar";
import { saveDocumentToFile, openTextFromFile } from "../../persistence/fileIO";
import { installDomStubs } from "../../test/domStubs";
import type { Session } from "../../persistence/session";

vi.mock("../../persistence/fileIO", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../persistence/fileIO")>();
  return {
    ...actual,
    saveDocumentToFile: vi.fn(),
    openTextFromFile: vi.fn(),
  };
});

const mockSave = vi.mocked(saveDocumentToFile);
const mockOpen = vi.mocked(openTextFromFile);

beforeAll(() => {
  installDomStubs();
});

afterEach(() => {
  cleanup();
  mockSave.mockReset();
  mockOpen.mockReset();
});

function freshSession(): Session {
  return startSession({ storage: createMemoryStorage(), target: null });
}

function renderTopBar(session: Session, lang: "es" | "en" = "es") {
  const preferencesStore = createPreferencesStore({ storage: null });
  if (lang === "en") preferencesStore.getState().setLanguage("en");
  const studioStore = createStudioStore();
  const i18n = createI18n(lang);
  const theme = createStudioTheme("light", lang);

  const utils = render(
    <I18nextProvider i18n={i18n}>
      <ThemeProvider theme={theme}>
        <CssBaseline />
        <TopBar session={session} preferencesStore={preferencesStore} studioStore={studioStore} />
      </ThemeProvider>
    </I18nextProvider>,
  );
  return { ...utils, preferencesStore, studioStore, i18n };
}

async function openFileMenu(fileMenuLabel = "Archivo"): Promise<void> {
  fireEvent.click(screen.getByRole("button", { name: fileMenuLabel }));
  await screen.findByRole("menu");
}

describe("TopBar", () => {
  it("renders with Undo/Redo disabled", () => {
    const session = freshSession();
    renderTopBar(session);
    expect(screen.getByRole<HTMLButtonElement>("button", { name: /Deshacer/ }).disabled).toBe(true);
    expect(screen.getByRole<HTMLButtonElement>("button", { name: /Rehacer/ }).disabled).toBe(true);
  });

  it("Load example (via File menu) gives 4 links/4 joints and enables Undo", async () => {
    const session = freshSession();
    renderTopBar(session);

    await openFileMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: "Cargar ejemplo de cuatro barras" }));

    expect(session.store.getState().document.links.length).toBe(4);
    expect(session.store.getState().document.joints.length).toBe(4);
    expect(screen.getByRole<HTMLButtonElement>("button", { name: /Deshacer/ }).disabled).toBe(
      false,
    );
  });

  it("New (via File menu) resets the document", async () => {
    const session = freshSession();
    renderTopBar(session);

    await openFileMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: "Cargar ejemplo de cuatro barras" }));
    expect(session.store.getState().document.links.length).toBe(4);

    await openFileMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: "Nuevo" }));
    expect(session.store.getState().document.links.length).toBe(0);
  });

  it("clicking Undo repeatedly walks back to an empty document, then Redo replays it", async () => {
    const session = freshSession();
    renderTopBar(session);

    await openFileMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: "Cargar ejemplo de cuatro barras" }));
    expect(session.store.getState().document.links.length).toBe(4);

    let steps = 0;
    while (session.store.getState().canUndo && steps < 20) {
      fireEvent.click(screen.getByRole("button", { name: /Deshacer/ }));
      steps += 1;
    }
    expect(session.store.getState().document.links.length).toBe(0);
    expect(screen.getByRole<HTMLButtonElement>("button", { name: /Rehacer/ }).disabled).toBe(false);

    fireEvent.click(screen.getByRole("button", { name: /Rehacer/ }));
    expect(session.store.getState().canRedo).toBe(true);
  });

  it("Save calls saveDocumentToFile with the current document; a second Save passes the returned handle; Save as passes no handle", async () => {
    const session = freshSession();
    renderTopBar(session);

    await openFileMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: "Cargar ejemplo de cuatro barras" }));
    const doc = session.store.getState().document;

    const fakeHandle = {} as FileSystemFileHandle;
    mockSave.mockResolvedValue({
      kind: "saved",
      fileName: "four-bar.simup.json",
      handle: fakeHandle,
    });

    await openFileMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: "Guardar" }));
    await waitFor(() => expect(mockSave).toHaveBeenCalledTimes(1));
    const firstCall = mockSave.mock.calls[0];
    if (!firstCall) throw new Error("saveDocumentToFile was not called");
    expect(firstCall[0]).toEqual(doc);
    expect(firstCall[1]).toEqual({ handle: null });

    await openFileMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: "Guardar" }));
    await waitFor(() => expect(mockSave).toHaveBeenCalledTimes(2));
    const secondCall = mockSave.mock.calls[1];
    if (!secondCall) throw new Error("saveDocumentToFile was not called a second time");
    expect(secondCall[1]).toEqual({ handle: fakeHandle });

    await openFileMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: "Guardar como…" }));
    await waitFor(() => expect(mockSave).toHaveBeenCalledTimes(3));
    const thirdCall = mockSave.mock.calls[2];
    if (!thirdCall) throw new Error("saveDocumentToFile was not called a third time");
    expect(thirdCall[1]).toBeUndefined();

    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toContain("four-bar.simup.json"),
    );
  });

  it("Open failure shows role=alert with the DocumentLoadError message; document is unchanged", async () => {
    const session = freshSession();
    renderTopBar(session);
    await openFileMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: "Cargar ejemplo de cuatro barras" }));
    const before = session.store.getState().document;

    const broken = JSON.parse(serializeDocument(fourBarFixtureParsed)) as {
      joints: { siteA: string }[];
    };
    broken.joints[0].siteA = "x";
    mockOpen.mockResolvedValue({
      kind: "opened",
      text: JSON.stringify(broken),
      fileName: "bad.simup.json",
      handle: null,
    });

    await openFileMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: "Abrir" }));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("joints.0.siteA");
    expect(session.store.getState().document).toBe(before);
  });

  it("Open of unparseable text shows the error alert", async () => {
    const session = freshSession();
    renderTopBar(session);
    mockOpen.mockResolvedValue({
      kind: "opened",
      text: "{broken",
      fileName: "b.json",
      handle: null,
    });
    await openFileMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: "Abrir" }));
    expect((await screen.findByRole("alert")).textContent?.length).toBeGreaterThan(0);
  });

  it("Open cancelled is a no-op", async () => {
    const session = freshSession();
    const { studioStore } = renderTopBar(session);
    mockOpen.mockResolvedValue({ kind: "cancelled" });
    await openFileMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: "Abrir" }));
    await waitFor(() => expect(mockOpen).toHaveBeenCalledTimes(1));
    expect(studioStore.getState().importRequest).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("Open success loads the document and clears Undo", async () => {
    const session = freshSession();
    renderTopBar(session);

    mockOpen.mockResolvedValue({
      kind: "opened",
      text: serializeDocument(fourBarFixtureParsed),
      fileName: "four-bar.simup.json",
      handle: null,
    });

    await openFileMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: "Abrir" }));

    await waitFor(() => {
      expect(session.store.getState().document.links.length).toBe(
        fourBarFixtureParsed.links.length,
      );
    });
    expect(screen.getByRole<HTMLButtonElement>("button", { name: /Deshacer/ }).disabled).toBe(true);
  });

  it("Open of a .simup.json then Save overwrites the opened file (same handle)", async () => {
    const session = freshSession();
    renderTopBar(session);
    const fakeHandle = {} as FileSystemFileHandle;
    mockOpen.mockResolvedValue({
      kind: "opened",
      text: serializeDocument(fourBarFixtureParsed),
      fileName: "four-bar.simup.json",
      handle: fakeHandle,
    });
    mockSave.mockResolvedValue({
      kind: "saved",
      fileName: "four-bar.simup.json",
      handle: fakeHandle,
    });

    await openFileMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: "Abrir" }));
    await waitFor(() => expect(session.store.getState().document.links.length).toBeGreaterThan(0));

    await openFileMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: "Guardar" }));
    await waitFor(() => expect(mockSave).toHaveBeenCalledTimes(1));
    expect(mockSave.mock.calls[0][1]).toEqual({ handle: fakeHandle });
  });

  it("Open of a graph routes to the import request, leaves the document alone and keeps no handle for Save", async () => {
    const session = freshSession();
    const { studioStore } = renderTopBar(session);
    const before = session.store.getState().document;
    const graphText = '{"nodes":[{"id":0},{"id":1}],"edges":[{"source":0,"target":1}]}';
    mockOpen.mockResolvedValue({
      kind: "opened",
      text: graphText,
      fileName: "g.json",
      handle: {} as FileSystemFileHandle,
    });
    mockSave.mockResolvedValue({ kind: "saved", fileName: "m.simup.json", handle: null });

    await openFileMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: "Abrir" }));
    await waitFor(() => expect(studioStore.getState().importRequest).not.toBeNull());
    expect(studioStore.getState().importRequest?.text).toBe(graphText);
    expect(studioStore.getState().importRequest?.fileName).toBe("g.json");
    expect(studioStore.getState().dialog).toBe("import");
    expect(session.store.getState().document).toBe(before);

    await openFileMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: "Guardar" }));
    await waitFor(() => expect(mockSave).toHaveBeenCalledTimes(1));
    expect(mockSave.mock.calls[0][1]).toEqual({ handle: null });
  });

  it.each([
    ["Importar grafo…", "import"],
    ["Ejemplos…", "examples"],
    ["Explorar atlas…", "atlas"],
  ] as const)("File > %s opens the %s dialog", async (label, dialog) => {
    const session = freshSession();
    const { studioStore } = renderTopBar(session);
    await openFileMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: label }));
    expect(studioStore.getState().dialog).toBe(dialog);
  });

  it("shows an alert on first render when the session's restore.status is error", () => {
    const storage = createMemoryStorage({ [SESSION_STORAGE_KEY]: "{oops" });
    const session = startSession({ storage, target: null });
    renderTopBar(session);

    const alert = screen.getByRole("alert");
    expect(alert.textContent).toContain("No se pudo restaurar");
  });
});

describe("TopBar language", () => {
  it("renders English labels when the preferences language is en", () => {
    const session = freshSession();
    renderTopBar(session, "en");
    expect(screen.getByRole("button", { name: "File" })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Undo/ })).toBeTruthy();
  });
});

describe("TopBar language toggle", () => {
  it("clicking EN sets preferences.language to en", () => {
    const session = freshSession();
    const { preferencesStore } = renderTopBar(session, "es");
    fireEvent.click(within(screen.getByRole("group", { name: "Idioma" })).getByText("EN"));
    expect(preferencesStore.getState().language).toBe("en");
  });
});

describe("TopBar theme toggle", () => {
  it("clicking the theme button toggles preferences.themeMode", () => {
    const session = freshSession();
    const { preferencesStore } = renderTopBar(session, "es");
    expect(preferencesStore.getState().themeMode).toBe("light");
    fireEvent.click(screen.getByRole("button", { name: "Oscuro" }));
    expect(preferencesStore.getState().themeMode).toBe("dark");
  });
});

describe("TopBar shortcut sheet / palette buttons", () => {
  it("the ? button opens the shortcut sheet in studioStore", () => {
    const session = freshSession();
    const { studioStore } = renderTopBar(session, "es");
    fireEvent.click(screen.getByRole("button", { name: "Atajos" }));
    expect(studioStore.getState().shortcutSheetOpen).toBe(true);
  });

  it("the command-palette button opens the palette in studioStore", () => {
    const session = freshSession();
    const { studioStore } = renderTopBar(session, "es");
    fireEvent.click(screen.getByRole("button", { name: "Paleta de comandos" }));
    expect(studioStore.getState().paletteOpen).toBe(true);
  });
});

describe("TopBar Build/Simulate toggle", () => {
  it("the toggle's value follows studioStore.mode; clicking Simular switches to simulate", () => {
    const session = freshSession();
    const { studioStore } = renderTopBar(session, "es");

    const buildButton = screen.getByRole<HTMLButtonElement>("button", { name: "Construir" });
    const simulateButton = screen.getByRole<HTMLButtonElement>("button", { name: "Simular" });
    expect(buildButton.getAttribute("aria-pressed")).toBe("true");
    expect(simulateButton.disabled).toBe(false);

    fireEvent.click(simulateButton);
    expect(studioStore.getState().mode).toBe("simulate");
    expect(simulateButton.getAttribute("aria-pressed")).toBe("true");

    fireEvent.click(buildButton);
    expect(studioStore.getState().mode).toBe("build");
    expect(buildButton.getAttribute("aria-pressed")).toBe("true");
  });

  it("clicking Simular does nothing while toolBusy is true (selectCanToggleMode guard)", () => {
    const session = freshSession();
    const { studioStore } = renderTopBar(session, "es");
    studioStore.getState().setToolBusy(true);

    fireEvent.click(screen.getByRole<HTMLButtonElement>("button", { name: "Simular" }));
    expect(studioStore.getState().mode).toBe("build");
  });
});

describe("TopBar DofBadge placement", () => {
  it("renders the DOF badge right after the Build|Simulate toggle, in both modes", () => {
    const session = freshSession();
    const { studioStore } = renderTopBar(session, "es");

    const toggleGroup = screen.getByRole("group", { name: "Construir" });
    const badge = screen.getByTestId("dof-badge");
    expect(badge).toBeTruthy();
    expect(
      toggleGroup.compareDocumentPosition(badge) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    fireEvent.click(screen.getByRole<HTMLButtonElement>("button", { name: "Simular" }));
    expect(studioStore.getState().mode).toBe("simulate");
    expect(screen.getByTestId("dof-badge")).toBeTruthy();
  });
});
