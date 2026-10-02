// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeAll } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor, within } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { AtlasDialog } from "./AtlasDialog";
import { createI18n } from "../../i18n/i18n";
import { createMechanismStore, buildExampleFourBar } from "../../store";
import { createStudioStore } from "../../uiState/studioStore";
import type {
  ImportDeps,
  LayoutRequest,
  LayoutResult,
  MobilityVerdict,
} from "../../interchange/importReport";
import { installDomStubs } from "../../test/domStubs";

beforeAll(() => {
  installDomStubs();
});
afterEach(cleanup);

const READY: MobilityVerdict = {
  status: "ready",
  gruebler: 1,
  rankDof: 1,
  inputKind: "rotary",
  rangeDeg: 360,
  linearTravel: null,
  fullRotation: true,
};

/** One joint position per edge (the layout contract), on a circle. */
function circle(req: LayoutRequest): LayoutResult {
  const n = req.edges.length;
  return {
    status: "ok",
    positions: Array.from({ length: n }, (_, i): [number, number] => [
      100 * Math.cos((2 * Math.PI * i) / n),
      100 * Math.sin((2 * Math.PI * i) / n),
    ]),
    rangeDeg: 360,
    tries: 1,
    lengthResidual: null,
  };
}

function setup(deps: ImportDeps) {
  const studioStore = createStudioStore();
  const mechanismStore = createMechanismStore();
  studioStore.getState().openDialog("atlas");
  render(
    <I18nextProvider i18n={createI18n("en")}>
      <AtlasDialog studioStore={studioStore} mechanismStore={mechanismStore} deps={deps} />
    </I18nextProvider>,
  );
  return { studioStore, mechanismStore };
}

const fast: ImportDeps = { layout: (req) => Promise.resolve(circle(req)), verify: () => READY };

describe("AtlasDialog", () => {
  it("renders nothing while the atlas dialog is closed", () => {
    render(
      <I18nextProvider i18n={createI18n("en")}>
        <AtlasDialog studioStore={createStudioStore()} mechanismStore={createMechanismStore()} />
      </I18nextProvider>,
    );
    expect(screen.queryByTestId("atlas-dialog")).toBeNull();
  });

  it("renders a card with a thumbnail for each of the 19 topologies", () => {
    setup(fast);
    const cards = screen.getAllByTestId("atlas-card");
    expect(cards).toHaveLength(19);
    for (const card of cards) {
      expect(within(card).getByTestId("atlas-thumbnail")).toBeTruthy();
    }
    expect(screen.getByTestId("atlas-count").textContent).toBe("19 topologies");
  });

  it("filters by link count and class", () => {
    setup(fast);
    fireEvent.click(screen.getByTestId("atlas-size-8"));
    expect(screen.getAllByTestId("atlas-card")).toHaveLength(16);
    fireEvent.click(screen.getByTestId("atlas-size-all"));
    fireEvent.mouseDown(screen.getByRole("combobox"));
    fireEvent.click(screen.getByTestId("atlas-class-watt"));
    const cards = screen.getAllByTestId("atlas-card");
    expect(cards).toHaveLength(1);
    expect(cards[0].getAttribute("data-atlas-id")).toBe("T6B_W");
    expect(screen.getByTestId("atlas-count").textContent).toBe("1 topology");
    fireEvent.click(screen.getByTestId("atlas-size-4"));
    expect(screen.queryAllByTestId("atlas-card")).toHaveLength(0);
    expect(screen.getByText("No topology matches these filters.")).toBeTruthy();
  });

  it("opens a card: lays out, loads the document, enters Simulate and closes", async () => {
    const { studioStore, mechanismStore } = setup(fast);
    fireEvent.click(screen.getAllByTestId("atlas-card").find((c) => c.dataset.atlasId === "T15")!);
    await waitFor(() =>
      expect(
        studioStore.getState().dialog,
        screen.queryByTestId("atlas-error")?.textContent ?? "",
      ).toBeNull(),
    );
    expect(mechanismStore.getState().document.links.length).toBe(8);
    expect(studioStore.getState().mode).toBe("simulate");
  });

  it("asks before replacing an edited drawing", async () => {
    const { studioStore, mechanismStore } = setup(fast);
    buildExampleFourBar(mechanismStore);
    const card = screen.getAllByTestId("atlas-card")[0];
    fireEvent.click(card);
    const confirm = await screen.findByTestId("replace-confirm");
    fireEvent.click(within(confirm).getByText("Replace"));
    await waitFor(() => expect(studioStore.getState().dialog).toBeNull());
  });

  it("shows the first error when no document comes back", async () => {
    const failing: ImportDeps = {
      layout: () =>
        Promise.resolve({
          status: "lengths-infeasible",
          positions: null,
          rangeDeg: 0,
          tries: 1,
          lengthResidual: 1,
        }),
      verify: () => READY,
    };
    const { studioStore } = setup(failing);
    fireEvent.click(screen.getAllByTestId("atlas-card")[1]);
    await screen.findByTestId("atlas-error");
    expect(studioStore.getState().dialog).toBe("atlas");
  });

  it("Cancel aborts the running layout", async () => {
    let signal: AbortSignal | undefined;
    const slow: ImportDeps = {
      layout: (_req, ctl) =>
        new Promise<LayoutResult>((resolve) => {
          signal = ctl?.signal;
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
    const { studioStore } = setup(slow);
    fireEvent.click(screen.getAllByTestId("atlas-card")[1]);
    await screen.findByTestId("atlas-progress");
    fireEvent.click(screen.getByTestId("atlas-cancel-layout"));
    expect(signal?.aborted).toBe(true);
    await waitFor(() => expect(screen.queryByTestId("atlas-progress")).toBeNull());
    expect(studioStore.getState().dialog).toBe("atlas");
    expect(screen.queryByTestId("atlas-error")).toBeNull();
  });

  it("Close dismisses the dialog", () => {
    const { studioStore } = setup(fast);
    fireEvent.click(screen.getByTestId("atlas-close"));
    expect(studioStore.getState().dialog).toBeNull();
  });
});
