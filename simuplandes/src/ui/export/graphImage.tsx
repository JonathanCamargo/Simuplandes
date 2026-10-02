/**
 * `renderGraphSvgText`: a standalone `<svg>` string for the graph panel's
 * OWN `GraphSvg` component (GRF-01/GRF-02/GRF-03), rendered via
 * `renderToStaticMarkup` with the SAME MUI theme + i18next providers the app
 * uses, in the SAME layout mode the Graph tab currently shows -- without
 * mounting the Graph tab. `GraphSvg`'s existing DOM contract (06-06/06-09
 * E2E) is untouched: this module never edits `GraphSvg.tsx`, it only wraps
 * it and post-processes the resulting string to guarantee an `xmlns`
 * attribute (the one thing a MOUNTED `<svg>` doesn't need but a STANDALONE
 * file does).
 */

import { renderToStaticMarkup } from "react-dom/server";
import { ThemeProvider } from "@mui/material";
import { I18nextProvider } from "react-i18next";
import type { i18n } from "i18next";
import type { StoreApi } from "zustand";
import type { MechanismStore } from "../../store";
import type { GraphLayoutKind, StudioState } from "../../uiState/studioStore";
import { layoutGraph, type GraphAnalysis } from "../../graph";
import { computeGraphViewport } from "../graph/graphViewport";
import { GraphSvg } from "../graph/GraphSvg";
import { createStudioTheme } from "../theme/studioTheme";
import type { ThemeMode } from "../../uiState/preferences";
import type { Language } from "../../i18n/numberFormat";

export interface RenderGraphSvgTextOptions {
  analysis: GraphAnalysis;
  layoutMode: GraphLayoutKind;
  stores: { studioStore: StoreApi<StudioState>; mechanismStore: MechanismStore };
  widthPx: number;
  heightPx: number;
  themeMode: ThemeMode;
  /** The app's i18next instance -- `GraphSvg` reads node/edge aria labels through it (`useTranslation`). */
  i18n: i18n;
  /** Only affects MUI's own locale text (`esES`/`enUS`); defaults to `"en"`. */
  lang?: Language;
}

/** Renders `GraphSvg` (the app's own graph component, same layout mode as the Graph tab) to a standalone SVG string, without mounting the Graph tab. */
export function renderGraphSvgText(options: RenderGraphSvgTextOptions): string {
  const {
    analysis,
    layoutMode,
    stores,
    widthPx,
    heightPx,
    themeMode,
    i18n: i18nInstance,
    lang = "en",
  } = options;

  const viewport = computeGraphViewport(widthPx, heightPx);
  const positions = layoutGraph(analysis.graph, layoutMode, {
    minSeparation: viewport.minSeparation,
  });
  const theme = createStudioTheme(themeMode, lang);

  const markup = renderToStaticMarkup(
    <ThemeProvider theme={theme}>
      <I18nextProvider i18n={i18nInstance}>
        <GraphSvg
          analysis={analysis}
          positions={positions}
          studioStore={stores.studioStore}
          mechanismStore={stores.mechanismStore}
          viewport={viewport}
        />
      </I18nextProvider>
    </ThemeProvider>,
  );

  return markup.includes("xmlns=")
    ? markup
    : markup.replace("<svg", '<svg xmlns="http://www.w3.org/2000/svg"');
}
