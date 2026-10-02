// @vitest-environment jsdom
import { render, screen, fireEvent, cleanup, act } from "@testing-library/react";
import { afterEach, beforeAll, describe, it, expect } from "vitest";
import { I18nextProvider } from "react-i18next";
import { ThemeProvider, CssBaseline } from "@mui/material";
import { GraphSvg } from "./GraphSvg";
import { createStudioTheme } from "../theme/studioTheme";
import { LINK_TYPE_COLORS } from "../theme/tokens";
import { createI18n } from "../../i18n/i18n";
import { createStudioStore } from "../../uiState/studioStore";
import { createMechanismStore } from "../../store";
import { documentFromEdges } from "../../graph/__fixtures__/fromEdges";
import { GROUND_NODE_ID, getGraphAnalysis, layoutGraph } from "../../graph";
import { installDomStubs } from "../../test/domStubs";
import { computeGraphViewport, GRAPH_PX, GRAPH_FALLBACK_SIZE_PX } from "./graphViewport";
import { LABEL_MIN_FONT } from "./labelFit";
import type { MechanismDocument } from "../../model";
import type { StoreApi } from "zustand";
import type { StudioState } from "../../uiState/studioStore";
import type { MechanismStore } from "../../store";
import type { GraphViewport } from "./graphViewport";

beforeAll(() => {
  installDomStubs();
});

afterEach(cleanup);

const STEPHENSON_EDGES: [number, number][] = [
  [0, 1],
  [0, 2],
  [0, 3],
  [1, 4],
  [2, 5],
  [4, 5],
  [3, 4],
];

const SC3_EDGES: [number, number][] = [
  [0, 1],
  [1, 2],
  [2, 3],
  [3, 0],
  [2, 4],
  [4, 5],
  [5, 2],
];

function renderGraph(
  doc: MechanismDocument,
  lang: "es" | "en" = "es",
  viewport?: GraphViewport,
): {
  studioStore: StoreApi<StudioState>;
  mechanismStore: MechanismStore;
} {
  const analysis = getGraphAnalysis(doc);
  const positions = layoutGraph(
    analysis.graph,
    "spatial",
    viewport ? { minSeparation: viewport.minSeparation } : undefined,
  );
  const studioStore = createStudioStore();
  const mechanismStore = createMechanismStore({ initialDocument: doc });
  const i18n = createI18n(lang);
  const theme = createStudioTheme("light", lang);

  render(
    <I18nextProvider i18n={i18n}>
      <ThemeProvider theme={theme}>
        <CssBaseline />
        <GraphSvg
          analysis={analysis}
          positions={positions}
          studioStore={studioStore}
          mechanismStore={mechanismStore}
          viewport={viewport}
        />
      </ThemeProvider>
    </I18nextProvider>,
  );

  return { studioStore, mechanismStore };
}

function nodeEl(nodeId: string): HTMLElement {
  const el = screen
    .getAllByTestId("graph-node")
    .find((e) => e.getAttribute("data-node-id") === nodeId);
  if (!el) throw new Error(`no graph-node with data-node-id="${nodeId}"`);
  return el;
}

function labelElFor(nodeId: string): HTMLElement | null {
  return document.querySelector(`[data-testid="graph-labels"] [data-label-for="${nodeId}"]`);
}

function edgeEl(jointId: string): HTMLElement {
  const el = screen
    .getAllByTestId("graph-edge")
    .find((e) => e.getAttribute("data-edge-id") === jointId);
  if (!el) throw new Error(`no graph-edge with data-edge-id="${jointId}"`);
  return el;
}

describe("GraphSvg: Stephenson six-bar structure", () => {
  it("renders 6 nodes and 7 edges with ground/ternary/binary shapes and colors", () => {
    const { doc, linkIdOf } = documentFromEdges(STEPHENSON_EDGES);
    renderGraph(doc);

    expect(screen.getAllByTestId("graph-node")).toHaveLength(6);
    expect(screen.getAllByTestId("graph-edge")).toHaveLength(7);

    const ground = nodeEl(GROUND_NODE_ID);
    const groundRect = ground.querySelector("rect");
    expect(groundRect).toBeTruthy();
    expect(groundRect?.getAttribute("fill")).toBe(LINK_TYPE_COLORS.ground);

    const ternary = nodeEl(linkIdOf(4));
    expect(ternary.getAttribute("data-link-type")).toBe("ternary");
    const ternaryCircle = ternary.querySelector("circle");
    expect(ternaryCircle).toBeTruthy();
    expect(ternaryCircle?.getAttribute("fill")).toBe(LINK_TYPE_COLORS.ternary);

    for (const idx of [1, 2, 3, 5]) {
      const binary = nodeEl(linkIdOf(idx));
      expect(binary.getAttribute("data-link-type")).toBe("binary");
      const circle = binary.querySelector("circle");
      expect(circle?.getAttribute("fill")).toBe(LINK_TYPE_COLORS.binary);
    }
  });

  it("prismatic + ground-pivot edge gets data-joint-type=P, a dashed visible line, and data-ground-pivot=true; R edges have no dasharray", () => {
    const { doc, jointIdOf } = documentFromEdges(STEPHENSON_EDGES, { prismatic: [0] });
    renderGraph(doc);

    const pEdge = edgeEl(jointIdOf(0));
    expect(pEdge.getAttribute("data-joint-type")).toBe("P");
    expect(pEdge.getAttribute("data-ground-pivot")).toBe("true");
    const pLine = pEdge.querySelector("line");
    expect(pLine?.getAttribute("stroke-dasharray")).toBeTruthy();

    const rEdge = edgeEl(jointIdOf(1));
    expect(rEdge.getAttribute("data-joint-type")).toBe("R");
    expect(rEdge.getAttribute("data-ground-pivot")).toBe("true");
    const rLine = rEdge.querySelector("line");
    expect(rLine?.getAttribute("stroke-dasharray")).toBeFalsy();

    const nonGroundEdge = edgeEl(jointIdOf(3));
    expect(nonGroundEdge.getAttribute("data-ground-pivot")).toBe("false");
  });
});

describe("GraphSvg: hover", () => {
  it("pointerenter/leave on a moving node sets/clears studioStore.hoveredId", () => {
    const { doc, linkIdOf } = documentFromEdges(STEPHENSON_EDGES);
    const { studioStore } = renderGraph(doc);

    const node = nodeEl(linkIdOf(4));
    fireEvent.pointerEnter(node);
    expect(studioStore.getState().hoveredId).toBe(linkIdOf(4));

    fireEvent.pointerLeave(node);
    expect(studioStore.getState().hoveredId).toBeNull();
  });

  it("pointerenter on the ground node sets hoveredId to its first ground link id", () => {
    const { doc, linkIdOf } = documentFromEdges(STEPHENSON_EDGES);
    const { studioStore } = renderGraph(doc);

    fireEvent.pointerEnter(nodeEl(GROUND_NODE_ID));
    expect(studioStore.getState().hoveredId).toBe(linkIdOf(0));
  });

  it("pointerenter on an edge sets hoveredId to its joint id", () => {
    const { doc, jointIdOf } = documentFromEdges(STEPHENSON_EDGES);
    const { studioStore } = renderGraph(doc);

    fireEvent.pointerEnter(edgeEl(jointIdOf(3)));
    expect(studioStore.getState().hoveredId).toBe(jointIdOf(3));
  });

  it("setting hoveredId externally marks the matching node/edge data-hovered=true, including the ground node via a ground link id", () => {
    const { doc, linkIdOf, jointIdOf } = documentFromEdges(STEPHENSON_EDGES);
    const { studioStore } = renderGraph(doc);

    act(() => studioStore.getState().setHoveredId(linkIdOf(4)));
    expect(nodeEl(linkIdOf(4)).getAttribute("data-hovered")).toBe("true");
    expect(nodeEl(linkIdOf(1)).getAttribute("data-hovered")).toBe("false");

    act(() => studioStore.getState().setHoveredId(linkIdOf(0)));
    expect(nodeEl(GROUND_NODE_ID).getAttribute("data-hovered")).toBe("true");

    act(() => studioStore.getState().setHoveredId(jointIdOf(3)));
    expect(edgeEl(jointIdOf(3)).getAttribute("data-hovered")).toBe("true");
  });

  it("keyboard focus/blur on a node mirror pointerenter/leave", () => {
    const { doc, linkIdOf } = documentFromEdges(STEPHENSON_EDGES);
    const { studioStore } = renderGraph(doc);

    const node = nodeEl(linkIdOf(4));
    fireEvent.focus(node);
    expect(studioStore.getState().hoveredId).toBe(linkIdOf(4));
    fireEvent.blur(node);
    expect(studioStore.getState().hoveredId).toBeNull();
  });
});

describe("GraphSvg: selection", () => {
  it("clicking a moving node selects its link; shift+click toggles it back off", () => {
    const { doc, linkIdOf } = documentFromEdges(STEPHENSON_EDGES);
    const { mechanismStore } = renderGraph(doc);

    fireEvent.click(nodeEl(linkIdOf(4)));
    expect(mechanismStore.getState().selection.has(linkIdOf(4))).toBe(true);

    fireEvent.click(nodeEl(linkIdOf(4)), { shiftKey: true });
    expect(mechanismStore.getState().selection.has(linkIdOf(4))).toBe(false);
  });

  it("clicking the ground node selects every ground link", () => {
    const { doc, linkIdOf } = documentFromEdges(STEPHENSON_EDGES);
    const { mechanismStore } = renderGraph(doc);

    fireEvent.click(nodeEl(GROUND_NODE_ID));
    expect(mechanismStore.getState().selection.has(linkIdOf(0))).toBe(true);
  });

  it("clicking an edge selects its joint", () => {
    const { doc, jointIdOf } = documentFromEdges(STEPHENSON_EDGES);
    const { mechanismStore } = renderGraph(doc);

    fireEvent.click(edgeEl(jointIdOf(3)));
    expect(mechanismStore.getState().selection.has(jointIdOf(3))).toBe(true);
  });

  it("selection set externally marks the matching node/edge data-selected=true", () => {
    const { doc, linkIdOf, jointIdOf } = documentFromEdges(STEPHENSON_EDGES);
    const { mechanismStore } = renderGraph(doc);

    act(() => mechanismStore.getState().select([linkIdOf(4), jointIdOf(3)]));
    expect(nodeEl(linkIdOf(4)).getAttribute("data-selected")).toBe("true");
    expect(edgeEl(jointIdOf(3)).getAttribute("data-selected")).toBe("true");
    expect(nodeEl(linkIdOf(1)).getAttribute("data-selected")).toBe("false");
  });

  it("Enter/Space on a focused node selects it", () => {
    const { doc, linkIdOf } = documentFromEdges(STEPHENSON_EDGES);
    const { mechanismStore } = renderGraph(doc);

    fireEvent.keyDown(nodeEl(linkIdOf(4)), { key: "Enter" });
    expect(mechanismStore.getState().selection.has(linkIdOf(4))).toBe(true);

    mechanismStore.getState().clearSelection();
    fireEvent.keyDown(nodeEl(linkIdOf(1)), { key: " " });
    expect(mechanismStore.getState().selection.has(linkIdOf(1))).toBe(true);
  });
});

describe("GraphSvg: label placement (06-09 gap closure)", () => {
  const VIEWPORT = computeGraphViewport(302, 281);

  it("every node's label lives in the graph-labels layer, not inside its own graph-node <g>; the <g> still has <title> and node-shape", () => {
    const { doc, linkIdOf } = documentFromEdges(STEPHENSON_EDGES, { name: "fromEdges" });
    renderGraph(doc, "es", VIEWPORT);

    for (const idx of [0, 1, 2, 3, 4, 5]) {
      const nodeId = idx === 0 ? GROUND_NODE_ID : linkIdOf(idx);
      const node = nodeEl(nodeId);
      expect(node.querySelector('[data-role="node-label"]')).toBeNull();
      expect(node.querySelector("title")).toBeTruthy();
      expect(node.querySelector('[data-role="node-shape"]')).toBeTruthy();
      expect(labelElFor(nodeId)).toBeTruthy();
    }
  });

  it('a node whose link is named "coupler" gets a readable, untruncated, outside-placed label', () => {
    const { doc, linkIdOf } = documentFromEdges(STEPHENSON_EDGES, { name: "fromEdges" });
    const named: MechanismDocument = {
      ...doc,
      links: doc.links.map((link) =>
        link.id === linkIdOf(4) ? { ...link, name: "coupler" } : link,
      ),
    };
    renderGraph(named, "es", VIEWPORT);

    const label = labelElFor(linkIdOf(4));
    expect(label).toBeTruthy();
    const fontSize = Number(label?.getAttribute("font-size"));
    expect(fontSize).toBeGreaterThanOrEqual(LABEL_MIN_FONT);
    expect(label?.textContent).toBe("coupler");
    expect(label?.getAttribute("data-label-truncated")).toBe("false");
    expect(label?.getAttribute("data-label-placement")).not.toBe("inside");
  });

  it('a node named "L5" places its label inside its own shape', () => {
    const { doc, linkIdOf } = documentFromEdges(STEPHENSON_EDGES, { name: "fromEdges" });
    const named: MechanismDocument = {
      ...doc,
      links: doc.links.map((link) => (link.id === linkIdOf(4) ? { ...link, name: "L5" } : link)),
    };
    renderGraph(named, "es", VIEWPORT);

    const label = labelElFor(linkIdOf(4));
    expect(label?.getAttribute("data-label-placement")).toBe("inside");
  });

  it("a very long link name ellipsizes its label but keeps the full name in <title>", () => {
    const longName = "Eslabón de acoplamiento extremadamente largo";
    const { doc, linkIdOf } = documentFromEdges(STEPHENSON_EDGES, { name: "fromEdges" });
    const named: MechanismDocument = {
      ...doc,
      links: doc.links.map((link) =>
        link.id === linkIdOf(4) ? { ...link, name: longName } : link,
      ),
    };
    renderGraph(named, "es", VIEWPORT);

    const label = labelElFor(linkIdOf(4));
    expect(label?.getAttribute("data-label-truncated")).toBe("true");
    expect(label?.textContent?.endsWith("…")).toBe(true);
    expect(label?.textContent).not.toBe(longName);

    const title = nodeEl(linkIdOf(4)).querySelector("title");
    expect(title?.textContent).toContain(longName);
  });
});

describe("GraphSvg: viewport / viewBox (06-09)", () => {
  it("without a viewport prop, falls back to a 360x360 viewBox and GRAPH_PX-sized nodes", () => {
    const { doc } = documentFromEdges(STEPHENSON_EDGES);
    renderGraph(doc);

    const svg = screen.getByTestId("graph-svg");
    expect(svg.getAttribute("viewBox")).toBe(
      `0 0 ${GRAPH_FALLBACK_SIZE_PX} ${GRAPH_FALLBACK_SIZE_PX}`,
    );
    const circle = screen.getAllByTestId("graph-node")[0].querySelector("circle,rect");
    expect(circle).toBeTruthy();
  });

  it("with a computeGraphViewport(302, 281) viewport, renders a 302x281 viewBox", () => {
    const { doc } = documentFromEdges(STEPHENSON_EDGES);
    const vp = computeGraphViewport(302, 281);
    renderGraph(doc, "es", vp);

    const svg = screen.getByTestId("graph-svg");
    expect(svg.getAttribute("viewBox")).toBe("0 0 302 281");
  });

  it("a non-ground node's circle has r === GRAPH_PX.nodeRadius regardless of viewport", () => {
    const { doc, linkIdOf } = documentFromEdges(STEPHENSON_EDGES);
    renderGraph(doc, "es", computeGraphViewport(302, 281));

    const circle = nodeEl(linkIdOf(1)).querySelector('[data-role="node-shape"]');
    expect(circle?.getAttribute("r")).toBe(String(GRAPH_PX.nodeRadius));
  });
});

describe("GraphSvg: Baranov issue highlighting", () => {
  it("exactly the 3 offending nodes and 3 edges have data-issue=true (SC-3 fixture)", () => {
    const { doc, linkIdOf, jointIdOf } = documentFromEdges(SC3_EDGES);
    renderGraph(doc);

    const issueNodes = screen
      .getAllByTestId("graph-node")
      .filter((el) => el.getAttribute("data-issue") === "true");
    const issueEdges = screen
      .getAllByTestId("graph-edge")
      .filter((el) => el.getAttribute("data-issue") === "true");

    expect(issueNodes).toHaveLength(3);
    expect(issueEdges).toHaveLength(3);
    expect(issueNodes.map((el) => el.getAttribute("data-node-id")).sort()).toEqual(
      [linkIdOf(2), linkIdOf(4), linkIdOf(5)].sort(),
    );
    expect(issueEdges.map((el) => el.getAttribute("data-edge-id")).sort()).toEqual(
      [jointIdOf(4), jointIdOf(5), jointIdOf(6)].sort(),
    );

    const issueRings = document.querySelectorAll('[data-role="issue-ring"]');
    expect(issueRings).toHaveLength(3);
  });
});
