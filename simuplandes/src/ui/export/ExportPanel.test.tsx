// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, act, waitFor } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { ExportPanel } from "./ExportPanel";
import { createI18n } from "../../i18n/i18n";
import { createMechanismStore } from "../../store";
import { buildExampleFourBar } from "../../store/examples";
import { createStudioStore } from "../../uiState/studioStore";
import { createPreferencesStore } from "../../uiState/preferences";
import { exportGraphthe } from "../../interchange";
import { graphtheFileName } from "../../persistence/fileIO";

vi.mock("./ImageExportActions", () => ({
  ImageExportActions: () => <div data-testid="image-export-actions-stub" />,
}));

vi.mock("../../persistence/fileIO", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../persistence/fileIO")>();
  return { ...actual, saveBlobToFile: vi.fn(actual.saveBlobToFile) };
});

import { saveBlobToFile as mockedSave } from "../../persistence/fileIO";

const mockSave = vi.mocked(mockedSave);

function renderPanel(lang: "es" | "en" = "en") {
  const mechanismStore = createMechanismStore();
  const ids = buildExampleFourBar(mechanismStore);
  const studioStore = createStudioStore();
  const preferencesStore = createPreferencesStore();
  const i18n = createI18n(lang);
  render(
    <I18nextProvider i18n={i18n}>
      <ExportPanel
        mechanismStore={mechanismStore}
        studioStore={studioStore}
        preferencesStore={preferencesStore}
      />
    </I18nextProvider>,
  );
  return { mechanismStore, studioStore, preferencesStore, ids };
}

afterEach(() => {
  mockSave.mockClear();
  cleanup();
});

describe("ExportPanel", () => {
  it("renders the JSON preview whose text equals exportGraphthe(doc).text", () => {
    renderPanel();
    const doc = createDocFromStore();
    const expected = exportGraphthe(doc).text.trimEnd();
    expect(screen.getByTestId("export-json").textContent).toBe(expected);
  });

  it("updates the preview after a store command edits the document", () => {
    const { mechanismStore, ids } = renderPanel();
    const before = screen.getByTestId("export-json").textContent;

    act(() => {
      mechanismStore.getState().execute("move-crank", (draft) => {
        const crank = draft.links.find((l) => l.id === ids.crankId)!;
        crank.pose.position[0] += 25;
      });
    });

    const after = screen.getByTestId("export-json").textContent;
    expect(after).not.toBe(before);
    expect(after).toContain("crank");
  });

  it("Copy writes the exact export text to the clipboard and shows a transient Copied", async () => {
    renderPanel();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(window, "navigator", {
      value: { clipboard: { writeText } },
      configurable: true,
    });

    const expected = exportGraphthe(createDocFromStore()).text;
    fireEvent.click(screen.getByTestId("export-copy"));
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    expect(writeText.mock.calls[0][0]).toBe(expected);

    await waitFor(() => expect(screen.getByTestId("export-copy").textContent).toBe("Copied"));
  });

  it("Download saves an application/json blob named <slug>.graphthe.json with the same text", async () => {
    mockSave.mockResolvedValue({ kind: "saved", fileName: "x", handle: null });
    renderPanel();

    fireEvent.click(screen.getByTestId("export-download"));
    await waitFor(() => expect(mockSave).toHaveBeenCalledTimes(1));

    const [blob, fileName, options] = mockSave.mock.calls[0];
    expect(blob.type).toBe("application/json");
    const doc = createDocFromStore();
    await expect(blob.text()).resolves.toBe(exportGraphthe(doc).text);
    expect(fileName).toBe(graphtheFileName(doc));
    expect(options.mimeTypes).toEqual(["application/json"]);
  });

  it("shows the ready line for a clean four-bar and the error item after deleting the motor", () => {
    const { mechanismStore, ids } = renderPanel();
    expect(screen.getByTestId("export-report-empty")).toBeTruthy();

    act(() => {
      mechanismStore.getState().execute("delete-motor", (draft) => {
        draft.motors = draft.motors.filter((m) => m.id !== ids.motorId);
      });
    });

    const items = screen.getAllByTestId("export-report-item");
    const noMotor = items.find((el) => el.getAttribute("data-code") === "cannot-simulate-no-motor");
    expect(noMotor).toBeDefined();
    expect(noMotor!.getAttribute("data-severity")).toBe("error");
  });

  it("mounts the image actions section", () => {
    renderPanel();
    expect(screen.getByTestId("image-export-actions-stub")).toBeTruthy();
  });
});

/** Builds a fresh example four-bar document (the same doc the panel shows). */
function createDocFromStore(): Parameters<typeof exportGraphthe>[0] {
  const store = createMechanismStore();
  buildExampleFourBar(store);
  return store.getState().document;
}
