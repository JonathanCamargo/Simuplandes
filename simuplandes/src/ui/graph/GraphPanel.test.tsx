// @vitest-environment jsdom
import { render, screen, cleanup, fireEvent, act } from "@testing-library/react";
import { afterEach, beforeAll, describe, it, expect, vi } from "vitest";
import { I18nextProvider } from "react-i18next";
import { ThemeProvider, CssBaseline } from "@mui/material";
import type { i18n as I18nInstance } from "i18next";
import { GraphPanel } from "./GraphPanel";
import { createStudioTheme } from "../theme/studioTheme";
import { createI18n } from "../../i18n/i18n";
import { createMechanismStore, buildExampleFourBar } from "../../store";
import { createStudioStore } from "../../uiState/studioStore";
import { poseFromWorldPoints, worldToLinkLocal } from "../../model";
import { vec2 } from "../../geom";
import { installDomStubs } from "../../test/domStubs";
import type { MechanismStore } from "../../store";
import type { StoreApi } from "zustand";
import type { StudioState } from "../../uiState/studioStore";

vi.mock("../../graph", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../graph")>();
  return { ...actual, getGraphAnalysis: vi.fn(actual.getGraphAnalysis) };
});
import { getGraphAnalysis } from "../../graph";

const mockGetGraphAnalysis = vi.mocked(getGraphAnalysis);

beforeAll(() => {
  installDomStubs();
});

afterEach(() => {
  cleanup();
  mockGetGraphAnalysis.mockClear();
});

function renderPanel(
  mechanismStore: MechanismStore,
  studioStore: StoreApi<StudioState> = createStudioStore(),
): ReturnType<typeof render> & { i18n: I18nInstance; studioStore: StoreApi<StudioState> } {
  const i18n = createI18n("es");
  const theme = createStudioTheme("light", "es");
  const utils = render(
    <I18nextProvider i18n={i18n}>
      <ThemeProvider theme={theme}>
        <CssBaseline />
        <GraphPanel mechanismStore={mechanismStore} studioStore={studioStore} />
      </ThemeProvider>
    </I18nextProvider>,
  );
  return { ...utils, i18n, studioStore };
}

describe("GraphPanel: empty document", () => {
  it("shows the empty text and a load-example button; clicking it loads the four-bar", () => {
    const mechanismStore = createMechanismStore();
    renderPanel(mechanismStore);

    expect(screen.getByTestId("graph-panel-empty")).toBeTruthy();
    expect(screen.getByText("Dibuja eslabones para ver su grafo")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Cargar ejemplo de cuatro barras" }));
    expect(screen.getAllByTestId("graph-node")).toHaveLength(4);
  });
});

describe("GraphPanel: example four-bar", () => {
  it("shows 4 nodes, 4 edges, the checks strip, and 'Espacial' pressed in the layout toggle", () => {
    const mechanismStore = createMechanismStore();
    buildExampleFourBar(mechanismStore);
    renderPanel(mechanismStore);

    expect(screen.getAllByTestId("graph-node")).toHaveLength(4);
    expect(screen.getAllByTestId("graph-edge")).toHaveLength(4);
    expect(screen.getByTestId("graph-checks")).toBeTruthy();

    const spatialButton = screen.getByRole("button", { name: "Espacial" });
    expect(spatialButton.getAttribute("aria-pressed")).toBe("true");
  });

  it("adding a bar through store commands shows a 5th node and 2 more edges without remount", () => {
    const mechanismStore = createMechanismStore();
    buildExampleFourBar(mechanismStore);
    const { container } = renderPanel(mechanismStore);
    const root = container.firstElementChild;

    const state = mechanismStore.getState();
    const doc = state.document;
    const jointA = doc.joints.find((j) => j.name === "A");
    const jointO4 = doc.joints.find((j) => j.name === "O4");
    if (!jointA || !jointO4) throw new Error("expected joints named A and O4");

    const A = vec2(20, 20 * Math.sqrt(3));
    const O4 = vec2(100, 0);
    const pose = poseFromWorldPoints(A, O4);
    act(() => {
      const extra = state.addLink({
        name: "extra",
        pose,
        sites: [{ local: [0, 0] }, { local: worldToLinkLocal(pose, O4) }],
      });
      state.addJoint({ type: "R", siteA: extra.siteIds[0], siteB: jointA.siteA, name: "extra-A" });
      state.addJoint({
        type: "R",
        siteA: extra.siteIds[1],
        siteB: jointO4.siteB,
        name: "extra-O4",
      });
    });

    expect(screen.getAllByTestId("graph-node")).toHaveLength(5);
    expect(screen.getAllByTestId("graph-edge")).toHaveLength(6);
    expect(container.firstElementChild).toBe(root);
  });
});

describe("GraphPanel: layout toggle", () => {
  it("clicking Circular sets studioStore.graphLayout and changes node positions", () => {
    const mechanismStore = createMechanismStore();
    buildExampleFourBar(mechanismStore);
    const studioStore = createStudioStore();
    renderPanel(mechanismStore, studioStore);

    function firstMovingNodeCx(): string | null | undefined {
      const moving = screen.getAllByTestId("graph-node").find((el) => el.querySelector("circle"));
      return moving?.querySelector("circle")?.getAttribute("cx");
    }

    const cxBefore = firstMovingNodeCx();
    expect(cxBefore).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Circular" }));

    expect(studioStore.getState().graphLayout).toBe("circular");
    expect(firstMovingNodeCx()).not.toBe(cxBefore);
  });
});

describe("GraphPanel: recompute discipline", () => {
  it("getGraphAnalysis is called once per document identity across unrelated re-renders", () => {
    const mechanismStore = createMechanismStore();
    buildExampleFourBar(mechanismStore);
    const studioStore = createStudioStore();
    const { i18n } = renderPanel(mechanismStore, studioStore);

    expect(mockGetGraphAnalysis).toHaveBeenCalledTimes(1);

    act(() => studioStore.getState().setGraphLayout("circular"));
    act(() => studioStore.getState().setHoveredId("something"));
    act(() => studioStore.getState().setGraphLayout("layered"));
    act(() => studioStore.getState().setHoveredId(null));
    act(() => void i18n.changeLanguage("en"));

    expect(mockGetGraphAnalysis).toHaveBeenCalledTimes(1);
  });
});

describe("GraphPanel: measured viewport (06-09)", () => {
  it("renders without crashing when ResizeObserver is undefined (falls back to a getBoundingClientRect-only measurement)", () => {
    const mechanismStore = createMechanismStore();
    buildExampleFourBar(mechanismStore);
    const original = window.ResizeObserver;
    // @ts-expect-error -- deliberately simulating an environment without ResizeObserver
    delete window.ResizeObserver;
    try {
      renderPanel(mechanismStore);
      expect(screen.getAllByTestId("graph-node").length).toBeGreaterThan(0);
      expect(screen.getByTestId("graph-svg")).toBeTruthy();
    } finally {
      window.ResizeObserver = original;
    }
  });

  it("passes a measured viewport to GraphSvg's viewBox when the box has a real size", () => {
    const mechanismStore = createMechanismStore();
    buildExampleFourBar(mechanismStore);
    // eslint-disable-next-line @typescript-eslint/unbound-method -- captured only to restore the property in `finally`, never called with a different `this`
    const original = Element.prototype.getBoundingClientRect;
    // jsdom always returns an all-zero rect; stub it to a fixed 302x281 (this
    // test's only measured element) so `computeGraphViewport` sees a real size.
    const stubbedRect = (): DOMRect => ({
      width: 302,
      height: 281,
      top: 0,
      left: 0,
      right: 302,
      bottom: 281,
      x: 0,
      y: 0,
      toJSON() {
        return {};
      },
    });
    Element.prototype.getBoundingClientRect = stubbedRect;
    try {
      renderPanel(mechanismStore);
      const svg = screen.getByTestId("graph-svg");
      expect(svg.getAttribute("viewBox")).toBe("0 0 302 281");
    } finally {
      Element.prototype.getBoundingClientRect = original;
    }
  });
});
