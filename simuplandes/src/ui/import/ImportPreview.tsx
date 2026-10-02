/**
 * `ImportPreview`: the Drawing / Graph tabs of the import dialog (XCH-07).
 * Both are rendered from the PLANNED document before anything is committed.
 * The Graph tab runs over throwaway stores, so a click in the preview never
 * touches the real selection / hover state.
 */

import { useMemo, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Box, Chip, Tab, Tabs } from "@mui/material";
import type { MechanismDocument } from "../../model";
import type { MobilityVerdict } from "../../interchange/importReport";
import { createMechanismStore } from "../../store";
import { createStudioStore } from "../../uiState/studioStore";
import { documentBounds } from "../../canvas/bounds";
import { defaultViewport, fitToBounds } from "../../canvas/viewport";
import { getGraphAnalysis, layoutGraph } from "../../graph";
import { DrawingSvg } from "../export/DrawingSvg";
import { GraphSvg } from "../graph/GraphSvg";
import { ChecksStrip } from "../graph/ChecksStrip";
import { computeGraphViewport } from "../graph/graphViewport";

export interface ImportPreviewProps {
  doc: MechanismDocument;
  verdict: MobilityVerdict | null;
  themeMode: "light" | "dark";
}

const WIDTH_PX = 440;
const HEIGHT_PX = 300;

function verdictKey(verdict: MobilityVerdict): "ready" | "range" | "notReady" {
  if (verdict.status !== "ready") return "notReady";
  return verdict.fullRotation || verdict.inputKind === "linear" ? "ready" : "range";
}

export function ImportPreview({ doc, verdict, themeMode }: ImportPreviewProps): ReactNode {
  const { t } = useTranslation();
  const [tab, setTab] = useState<"drawing" | "graph">("drawing");

  const view = useMemo(
    () => ({
      viewport: fitToBounds(defaultViewport(WIDTH_PX, HEIGHT_PX), documentBounds(doc), 30),
      widthPx: WIDTH_PX,
      heightPx: HEIGHT_PX,
    }),
    [doc],
  );
  const analysis = useMemo(() => getGraphAnalysis(doc), [doc]);
  const graphViewport = useMemo(() => computeGraphViewport(WIDTH_PX, HEIGHT_PX), []);
  const positions = useMemo(
    () => layoutGraph(analysis.graph, "spatial", { minSeparation: graphViewport.minSeparation }),
    [analysis, graphViewport],
  );
  const stores = useMemo(
    () => ({
      studio: createStudioStore(),
      mechanism: createMechanismStore({ initialDocument: doc }),
    }),
    [doc],
  );

  const rangeDeg = verdict ? Math.round(verdict.rangeDeg) : 0;

  return (
    <Box data-testid="import-preview">
      <Tabs value={tab} onChange={(_e, v: "drawing" | "graph") => setTab(v)} sx={{ minHeight: 36 }}>
        <Tab value="drawing" label={t("import.tabs.drawing")} data-testid="import-tab-drawing" />
        <Tab value="graph" label={t("import.tabs.graph")} data-testid="import-tab-graph" />
      </Tabs>
      {tab === "drawing" ? (
        <Box data-testid="import-preview-drawing" sx={{ overflow: "auto" }}>
          <DrawingSvg doc={doc} view={view} themeMode={themeMode} />
        </Box>
      ) : (
        <Box
          data-testid="import-preview-graph"
          sx={{ position: "relative", width: WIDTH_PX, maxWidth: "100%", height: HEIGHT_PX }}
        >
          <GraphSvg
            analysis={analysis}
            positions={positions}
            studioStore={stores.studio}
            mechanismStore={stores.mechanism}
            viewport={graphViewport}
          />
        </Box>
      )}
      <ChecksStrip analysis={analysis} />
      {verdict ? (
        <Chip
          data-testid="import-verdict"
          data-status={verdict.status}
          data-range-deg={rangeDeg}
          color={verdict.status === "ready" ? "success" : "warning"}
          label={t(`import.verdict.${verdictKey(verdict)}`, { rangeDeg })}
          sx={{ m: 1 }}
        />
      ) : null}
    </Box>
  );
}
