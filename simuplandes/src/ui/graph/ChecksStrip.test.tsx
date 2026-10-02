// @vitest-environment jsdom
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { afterEach, beforeAll, describe, it, expect } from "vitest";
import { I18nextProvider } from "react-i18next";
import { ThemeProvider, CssBaseline } from "@mui/material";
import { ChecksStrip } from "./ChecksStrip";
import { createStudioTheme } from "../theme/studioTheme";
import { createI18n } from "../../i18n/i18n";
import { documentFromEdges } from "../../graph/__fixtures__/fromEdges";
import { ATLAS_TOPOLOGIES, analyzeDocument, type GraphAnalysis } from "../../graph";
import { installDomStubs } from "../../test/domStubs";

beforeAll(() => {
  installDomStubs();
});

afterEach(cleanup);

function renderChecks(analysis: GraphAnalysis, lang: "es" | "en" = "es") {
  const i18n = createI18n(lang);
  const theme = createStudioTheme("light", lang);
  return render(
    <I18nextProvider i18n={i18n}>
      <ThemeProvider theme={theme}>
        <CssBaseline />
        <ChecksStrip analysis={analysis} />
      </ThemeProvider>
    </I18nextProvider>,
  );
}

const STEPHENSON_EDGES: [number, number][] = [
  [0, 1],
  [0, 2],
  [0, 3],
  [1, 4],
  [2, 5],
  [4, 5],
  [3, 4],
];

const WATT_EDGES: [number, number][] = [
  [0, 1],
  [0, 2],
  [0, 3],
  [1, 4],
  [2, 5],
  [3, 4],
  [3, 5],
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

describe("ChecksStrip: four-bar", () => {
  it("shows n, j, F, ok severity, Baranov pass, assortment and topology", () => {
    const { doc } = documentFromEdges([
      [0, 1],
      [1, 2],
      [2, 3],
      [3, 0],
    ]);
    renderChecks(analyzeDocument(doc));

    const mobility = screen.getByTestId("graph-check-mobility");
    expect(mobility.textContent).toContain("n = 4");
    expect(mobility.textContent).toContain("j = 4");
    expect(mobility.textContent).toContain("F = 3(4 − 1) − 2·4 = 1");
    expect(mobility.getAttribute("data-severity")).toBe("ok");

    const baranov = screen.getByTestId("graph-check-baranov");
    expect(baranov.textContent).toContain("Baranov ✓");
    expect(baranov.getAttribute("data-status")).toBe("pass");

    expect(screen.getByTestId("graph-check-assortment").textContent).toContain("4 binarios");

    const topology = screen.getByTestId("graph-check-topology");
    expect(topology.textContent).toBe("Cadena de cuatro barras");
    expect(topology.getAttribute("data-topology-id")).toBe("four-bar");
  });
});

describe("ChecksStrip: six-bar chain names", () => {
  it("Stephenson -> Cadena de Stephenson / T6B_S", () => {
    const { doc } = documentFromEdges(STEPHENSON_EDGES);
    renderChecks(analyzeDocument(doc));
    const topology = screen.getByTestId("graph-check-topology");
    expect(topology.textContent).toBe("Cadena de Stephenson");
    expect(topology.getAttribute("data-topology-id")).toBe("T6B_S");
  });

  it("Watt -> Cadena de Watt", () => {
    const { doc } = documentFromEdges(WATT_EDGES);
    renderChecks(analyzeDocument(doc));
    expect(screen.getByTestId("graph-check-topology").textContent).toBe("Cadena de Watt");
  });

  it("en: Stephenson chain", () => {
    const { doc } = documentFromEdges(STEPHENSON_EDGES);
    renderChecks(analyzeDocument(doc), "en");
    expect(screen.getByTestId("graph-check-topology").textContent).toBe("Stephenson chain");
  });
});

describe("ChecksStrip: 8-bar atlas entry", () => {
  it("shows '8 barras' and the atlas id in the topology chip", () => {
    const entry = ATLAS_TOPOLOGIES.find((t) => t.id === "T07");
    if (!entry) throw new Error("expected atlas entry T07");
    const { doc } = documentFromEdges(entry.graph.edges);
    renderChecks(analyzeDocument(doc));

    const topology = screen.getByTestId("graph-check-topology");
    expect(topology.textContent).toContain("8 barras");
    expect(topology.textContent).toContain("T07");
    expect(topology.getAttribute("data-topology-id")).toBe("T07");
  });
});

describe("ChecksStrip: SC-3 golden fixture (Baranov failure)", () => {
  it("Baranov chip fails, names the offending links, explains subcadena rígida; mobility F=1 stays ok", () => {
    const { doc } = documentFromEdges(SC3_EDGES);
    renderChecks(analyzeDocument(doc));

    const baranov = screen.getByTestId("graph-check-baranov");
    expect(baranov.getAttribute("data-status")).toBe("fail");
    expect(baranov.textContent).toContain("L2");
    expect(baranov.textContent).toContain("L4");
    expect(baranov.textContent).toContain("L5");
    expect(baranov.textContent).toContain("subcadena rígida");

    const mobility = screen.getByTestId("graph-check-mobility");
    expect(mobility.textContent).toContain("F = 3(6 − 1) − 2·7 = 1");
    expect(mobility.getAttribute("data-severity")).toBe("ok");
  });
});

describe("ChecksStrip: mobility severity", () => {
  it("F = 0 -> error severity", () => {
    const { doc } = documentFromEdges([
      [0, 1],
      [1, 2],
      [2, 0],
    ]);
    renderChecks(analyzeDocument(doc));
    expect(screen.getByTestId("graph-check-mobility").getAttribute("data-severity")).toBe("error");
  });

  it("F >= 2 -> warn severity", () => {
    const { doc } = documentFromEdges([
      [0, 1],
      [1, 2],
    ]);
    const analysis = analyzeDocument(doc);
    expect(analysis.mobility.gruebler).toBeGreaterThanOrEqual(2);
    renderChecks(analysis);
    expect(screen.getByTestId("graph-check-mobility").getAttribute("data-severity")).toBe("warn");
  });
});

describe("ChecksStrip: Baranov skipped (too-large graph)", () => {
  it("shows the too-large note with data-status=skipped", () => {
    const edges: [number, number][] = [];
    for (let i = 0; i < 17; i++) edges.push([i, (i + 1) % 17]);
    const { doc } = documentFromEdges(edges);
    const analysis = analyzeDocument(doc);
    expect(analysis.baranov.status).toBe("skipped");
    renderChecks(analysis);

    const baranov = screen.getByTestId("graph-check-baranov");
    expect(baranov.getAttribute("data-status")).toBe("skipped");
    expect(baranov.textContent).toContain("grafo demasiado grande");
  });
});

describe("ChecksStrip: no atlas match", () => {
  it("shows 'Sin coincidencia en el atlas' with data-topology-id=none and the reason as a tooltip", async () => {
    const { doc } = documentFromEdges([
      [0, 1],
      [1, 2],
      [2, 3],
      [3, 4],
      [4, 0],
    ]);
    const analysis = analyzeDocument(doc);
    expect(analysis.topology).toEqual({ kind: "none", reason: "noAtlasForSize" });
    renderChecks(analysis);

    const topology = screen.getByTestId("graph-check-topology");
    expect(topology.textContent).toBe("Sin coincidencia en el atlas");
    expect(topology.getAttribute("data-topology-id")).toBe("none");

    fireEvent.mouseOver(topology);
    expect(await screen.findByText("No hay atlas para este número de eslabones")).toBeTruthy();
  });
});
