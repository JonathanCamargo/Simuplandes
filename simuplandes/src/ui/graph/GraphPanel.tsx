/**
 * `GraphPanel`: the Graph tab's content -- a Spatial|Circular|Layered layout
 * toggle (GRF-05), the `GraphSvg` (GRF-01/GRF-02/GRF-03) and `ChecksStrip`
 * (GRF-03/GRF-04) below it, or an empty state (draw links / load the example
 * four-bar) when the document has no links yet.
 *
 * Reads `mechanismStore.document` and `studioStore.graphLayout` ONLY -- never
 * `simStore` (research Pitfall 3 / OQ4): the graph is always the Build-mode
 * reference-pose topology. `getGraphAnalysis` is memoized on `doc`'s own
 * object identity via `useMemo`, exactly like `DofBadge`'s
 * `useMemo(() => computeDofReport(doc), [doc])`, so hover/layout-only
 * re-renders never recompute it.
 *
 * 06-09: the SVG box is measured (ResizeObserver, guarded, same pattern as
 * `CanvasArea.tsx`) and converted to a `GraphViewport` via
 * `computeGraphViewport`; `viewport.minSeparation` is threaded into
 * `layoutGraph` and `viewport` itself into `GraphSvg`, so on-screen node/
 * label sizes stay fixed screen-px regardless of how much the flex layout
 * compresses the box. `GraphSvg` is positioned absolutely inside the
 * measured box (`position: relative` on the box, `inset: 0` on the SVG) so
 * the SVG's own rendered size can never feed back into what's measured.
 */

import { useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useStore, type StoreApi } from "zustand";
import { useTranslation } from "react-i18next";
import { Box, Button, Stack, ToggleButton, ToggleButtonGroup, Typography } from "@mui/material";
import type { MechanismStore } from "../../store";
import { buildExampleFourBar } from "../../store";
import type { GraphLayoutKind, StudioState } from "../../uiState/studioStore";
import { getGraphAnalysis, layoutGraph } from "../../graph";
import { computeGraphViewport } from "./graphViewport";
import { GraphSvg } from "./GraphSvg";
import { ChecksStrip } from "./ChecksStrip";

export interface GraphPanelProps {
  mechanismStore: MechanismStore;
  studioStore: StoreApi<StudioState>;
}

const LAYOUT_KINDS: readonly GraphLayoutKind[] = ["spatial", "circular", "layered"];

export function GraphPanel({ mechanismStore, studioStore }: GraphPanelProps): ReactNode {
  const { t } = useTranslation();
  const doc = useStore(mechanismStore, (s) => s.document);
  const layout = useStore(studioStore, (s) => s.graphLayout);
  const analysis = useMemo(() => getGraphAnalysis(doc), [doc]);
  const isEmpty = analysis.graph.nodes.length === 0;

  const boxRef = useRef<HTMLDivElement | null>(null);
  const [measured, setMeasured] = useState({ width: 0, height: 0 });

  // Re-attaches whenever the empty<->non-empty state flips: the measured
  // `<Box ref={boxRef}>` only exists in the non-empty render path below, so
  // the very first time a document goes from empty to non-empty, `boxRef`
  // just mounted and needs a fresh measurement/observer.
  useLayoutEffect(() => {
    const element = boxRef.current;
    if (!element) return;
    const rect = element.getBoundingClientRect();
    setMeasured((prev) =>
      prev.width === rect.width && prev.height === rect.height
        ? prev
        : { width: rect.width, height: rect.height },
    );
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      const { width, height } = entry.contentRect;
      setMeasured((prev) => {
        const w = Math.round(width);
        const h = Math.round(height);
        return prev.width === w && prev.height === h ? prev : { width: w, height: h };
      });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [isEmpty]);

  const viewport = useMemo(
    () => computeGraphViewport(measured.width, measured.height),
    [measured.width, measured.height],
  );
  const positions = useMemo(
    () => layoutGraph(analysis.graph, layout, { minSeparation: viewport.minSeparation }),
    [analysis, layout, viewport.minSeparation],
  );

  if (isEmpty) {
    return (
      <Stack data-testid="graph-panel-empty" spacing={2} sx={{ p: 2, alignItems: "flex-start" }}>
        <Typography color="text.secondary">{t("graph.panel.empty")}</Typography>
        <Button variant="outlined" size="small" onClick={() => buildExampleFourBar(mechanismStore)}>
          {t("graph.panel.loadExample")}
        </Button>
      </Stack>
    );
  }

  return (
    <Box
      data-testid="graph-panel"
      sx={{
        display: "flex",
        flexDirection: "column",
        flex: "1 1 auto",
        minHeight: 0,
        height: "100%",
      }}
    >
      <Box sx={{ flex: "0 0 auto", p: 1 }}>
        <ToggleButtonGroup
          exclusive
          size="small"
          value={layout}
          aria-label={t("graph.layout.label")}
          onChange={(_event, value: GraphLayoutKind | null) => {
            if (value !== null) studioStore.getState().setGraphLayout(value);
          }}
        >
          {LAYOUT_KINDS.map((kind) => (
            <ToggleButton key={kind} value={kind} aria-label={t(`graph.layout.${kind}`)}>
              {t(`graph.layout.${kind}`)}
            </ToggleButton>
          ))}
        </ToggleButtonGroup>
      </Box>
      <Box
        ref={boxRef}
        sx={{
          position: "relative",
          flex: "1 1 0",
          minHeight: 140,
          mx: 1,
        }}
      >
        <Box sx={{ position: "absolute", inset: 0 }}>
          <GraphSvg
            analysis={analysis}
            positions={positions}
            studioStore={studioStore}
            mechanismStore={mechanismStore}
            viewport={viewport}
          />
        </Box>
      </Box>
      <Box sx={{ flex: "0 0 auto" }}>
        <ChecksStrip analysis={analysis} />
      </Box>
    </Box>
  );
}
