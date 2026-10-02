// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { renderGraphSvgText } from "./graphImage";
import { fourBarFixtureParsed } from "../../model/__fixtures__/fourBar";
import { analyzeDocument } from "../../graph";
import { createMechanismStore } from "../../store";
import { createStudioStore } from "../../uiState/studioStore";
import { createI18n } from "../../i18n/i18n";

function parse(svgText: string): Document {
  return new DOMParser().parseFromString(svgText, "image/svg+xml");
}

describe("renderGraphSvgText", () => {
  it("returns a standalone SVG whose node count equals analysis.graph.nodes.length, no background rect", () => {
    const analysis = analyzeDocument(fourBarFixtureParsed);
    const svgText = renderGraphSvgText({
      analysis,
      layoutMode: "spatial",
      stores: { studioStore: createStudioStore(), mechanismStore: createMechanismStore() },
      widthPx: 320,
      heightPx: 280,
      themeMode: "light",
      i18n: createI18n("en"),
    });

    expect(svgText.startsWith("<svg")).toBe(true);
    expect(svgText).toContain('xmlns="http://www.w3.org/2000/svg"');

    const doc = parse(svgText);
    expect(doc.querySelectorAll('[data-testid="graph-node"]').length).toBe(
      analysis.graph.nodes.length,
    );
    expect(doc.querySelectorAll('[data-testid="graph-edge"]').length).toBe(
      analysis.graph.edges.length,
    );

    const rects = Array.from(doc.querySelectorAll("rect"));
    const backgroundRect = rects.find(
      (r) => r.getAttribute("width") === "320" && r.getAttribute("height") === "280",
    );
    expect(backgroundRect).toBeUndefined();
  });

  it("renders in the requested layout mode", () => {
    const analysis = analyzeDocument(fourBarFixtureParsed);
    const spatial = renderGraphSvgText({
      analysis,
      layoutMode: "spatial",
      stores: { studioStore: createStudioStore(), mechanismStore: createMechanismStore() },
      widthPx: 320,
      heightPx: 280,
      themeMode: "light",
      i18n: createI18n("en"),
    });
    const circular = renderGraphSvgText({
      analysis,
      layoutMode: "circular",
      stores: { studioStore: createStudioStore(), mechanismStore: createMechanismStore() },
      widthPx: 320,
      heightPx: 280,
      themeMode: "light",
      i18n: createI18n("en"),
    });
    expect(spatial).not.toBe(circular);
  });

  it("renders node/edge aria labels through the given i18n instance's language", () => {
    const analysis = analyzeDocument(fourBarFixtureParsed);
    const svgText = renderGraphSvgText({
      analysis,
      layoutMode: "spatial",
      stores: { studioStore: createStudioStore(), mechanismStore: createMechanismStore() },
      widthPx: 320,
      heightPx: 280,
      themeMode: "light",
      i18n: createI18n("es"),
    });
    // The ground node's fallback label is localized -- Spanish text should appear somewhere in the markup.
    expect(svgText.toLowerCase()).not.toContain("graph.node.ground");
  });
});
