// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor, act } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { ImportDialog } from "./ImportDialog";
import { createI18n } from "../../i18n/i18n";
import { createMechanismStore } from "../../store";
import { createStudioStore } from "../../uiState/studioStore";
import type { ImportDeps, LayoutResult } from "../../interchange/importReport";
import {
  missingInput,
  positionedFourBar,
  topologyOnlyEightBar,
} from "../../interchange/__fixtures__/importCases";

function setup(text: string | null, deps?: ImportDeps) {
  const studioStore = createStudioStore();
  const mechanismStore = createMechanismStore();
  if (text !== null) studioStore.getState().requestImport(text, "x.graphthe.json");
  else studioStore.getState().openDialog("import");
  render(
    <I18nextProvider i18n={createI18n("en")}>
      <ImportDialog studioStore={studioStore} mechanismStore={mechanismStore} deps={deps} />
    </I18nextProvider>,
  );
  return { studioStore, mechanismStore };
}

afterEach(() => {
  cleanup();
});

const SLOW = { timeout: 15_000 };

describe("ImportDialog", () => {
  it("renders nothing while no import dialog is open", () => {
    const studioStore = createStudioStore();
    render(
      <I18nextProvider i18n={createI18n("en")}>
        <ImportDialog studioStore={studioStore} mechanismStore={createMechanismStore()} />
      </I18nextProvider>,
    );
    expect(screen.queryByTestId("import-dialog")).toBeNull();
  });

  it("previews a positioned four-bar in both tabs with no warnings", async () => {
    setup(positionedFourBar());
    const verdict = await screen.findByTestId("import-verdict", undefined, SLOW);
    expect(verdict.getAttribute("data-status")).toBe("ready");
    expect(
      screen
        .queryAllByTestId("import-report-item")
        .filter((el) => el.getAttribute("data-severity") === "warning"),
    ).toHaveLength(0);
    expect(screen.getByTestId("import-preview-drawing")).toBeTruthy();
    fireEvent.click(screen.getByTestId("import-tab-graph"));
    expect(screen.getByTestId("import-preview-graph")).toBeTruthy();
    expect(screen.getByTestId("import-commit").hasAttribute("disabled")).toBe(false);
  });

  it("lists missing-input with fixes; choosing another re-plans with it active", async () => {
    setup(missingInput());
    const item = await screen.findByTestId("import-report-item", undefined, SLOW);
    expect(item.getAttribute("data-code")).toBe("missing-input");
    const fixes = Array.from(item.querySelectorAll("[data-fix-id]"));
    expect(fixes.length).toBeGreaterThan(1);
    const other = fixes.find((f) => f.getAttribute("aria-pressed") !== "true")!;
    const otherId = other.getAttribute("data-fix-id")!;
    fireEvent.click(other);
    await waitFor(() => {
      const again = screen
        .getAllByTestId("import-report-item")
        .find((el) => el.getAttribute("data-code") === "missing-input")!;
      expect(again.querySelector(`[data-fix-id="${otherId}"]`)?.getAttribute("aria-pressed")).toBe(
        "true",
      );
    }, SLOW);
  });

  it("disables Import for unparseable text", async () => {
    setup("not json at all");
    const item = await screen.findByTestId("import-report-item", undefined, SLOW);
    expect(item.getAttribute("data-code")).toBe("unparseable");
    expect(screen.getByTestId("import-commit").hasAttribute("disabled")).toBe(true);
  });

  it("pasting text plans it", async () => {
    setup(null);
    expect(screen.getByTestId("import-commit").hasAttribute("disabled")).toBe(true);
    fireEvent.change(screen.getByTestId("import-paste"), {
      target: { value: positionedFourBar() },
    });
    await screen.findByTestId("import-verdict", undefined, SLOW);
  });

  it("Import loads the planned document, closes the dialog and enters Simulate", async () => {
    const { studioStore, mechanismStore } = setup(positionedFourBar());
    await screen.findByTestId("import-verdict", undefined, SLOW);
    fireEvent.click(screen.getByTestId("import-commit"));
    expect(studioStore.getState().dialog).toBeNull();
    expect(studioStore.getState().mode).toBe("simulate");
    expect(mechanismStore.getState().document.links).toHaveLength(4);
    expect(mechanismStore.getState().canUndo).toBe(false);
  });

  it("Cancel closes the dialog and clears the request", () => {
    const { studioStore } = setup(positionedFourBar());
    fireEvent.click(screen.getByTestId("import-cancel"));
    expect(studioStore.getState().dialog).toBeNull();
    expect(studioStore.getState().importRequest).toBeNull();
  });

  it("shows layout progress and Cancel aborts the layout run", async () => {
    let signal: AbortSignal | undefined;
    let report: ((tries: number, max: number) => void) | undefined;
    const deps: ImportDeps = {
      layout: (_req, ctl) =>
        new Promise<LayoutResult>((resolve) => {
          signal = ctl?.signal;
          report = ctl?.onProgress;
          ctl?.signal?.addEventListener("abort", () =>
            resolve({
              status: "cancelled",
              positions: null,
              rangeDeg: 0,
              tries: 0,
              lengthResidual: null,
            }),
          );
        }),
    };
    setup(topologyOnlyEightBar(), deps);
    await screen.findByTestId("import-progress");
    await waitFor(() => expect(report).toBeDefined());
    act(() => report?.(2, 8));
    expect(await screen.findByText("Laying out… try 2 of 8")).toBeTruthy();
    fireEvent.click(screen.getByTestId("import-cancel-layout"));
    expect(signal?.aborted).toBe(true);
    await waitFor(() => expect(screen.queryByTestId("import-progress")).toBeNull());
    expect(screen.getByTestId("import-commit").hasAttribute("disabled")).toBe(true);
  });
});
