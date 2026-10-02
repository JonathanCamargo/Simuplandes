/**
 * `ExportPanel` (XCH-01/XCH-02/XCH-09 UI): the Export tab's content —
 * the validation report above a live, read-only JSON preview
 * (`exportGraphthe(doc).text`, recomputed per document edit), Copy +
 * Download actions, and 08-03's `ImageExportActions`.
 *
 * Everything is derived from the CURRENT document via `useMemo` keyed on
 * `doc` (the same selector `GraphPanel`/`DofBadge` use), so playback/
 * hover/layout changes never re-serialize and a real edit updates the
 * preview on the next render.
 *
 * `ImageExportActions` receives the canvas view (view store + measured
 * size) and Simulate-mode poses/traces when provided by the shell —
 * WYSIWYG. Props stay optional so the dock can render Build-only too.
 */

import { useMemo, useState, type ReactNode } from "react";
import { useStore, type StoreApi } from "zustand";
import { useTranslation } from "react-i18next";
import { Box, Button, Stack, Typography } from "@mui/material";
import type { MechanismStore } from "../../store";
import type { StudioState } from "../../uiState/studioStore";
import type { PreferencesState } from "../../uiState/preferences";
import type { ViewStore } from "../../canvas/viewStore";
import { createViewStore } from "../../canvas/viewStore";
import { createSimStore, type SimStore } from "../../sim/simStore";
import { exportGraphthe, buildExportReport } from "../../interchange";
import { getGraphAnalysis } from "../../graph";
import { graphtheFileName, isAbortError, saveBlobToFile } from "../../persistence/fileIO";
import { ValidationReport } from "./ValidationReport";
import { ImageExportActions } from "./ImageExportActions";

export interface ExportPanelProps {
  mechanismStore: MechanismStore;
  studioStore: StoreApi<StudioState>;
  preferencesStore: StoreApi<PreferencesState>;
  /** The canvas's view store (WYSIWYG image framing); omitted in isolated tests. */
  view?: ViewStore;
  /** The canvas's measured CSS size; defaults to a sane panel size. */
  canvasSize?: { width: number; height: number };
  /** Phase 5 seam: Simulate-mode poses/traces read from this store (WYSIWYG image pose). */
  sim?: { store: SimStore };
}

const JSON_SAVE_OPTIONS = {
  description: "GraphThe Mechanism JSON (.graphthe.json)",
  mimeTypes: ["application/json"],
  extensions: [".graphthe.json", ".json"],
};

/** A stable, never-mutated fallback so `useStore` is always called with a real store when `sim` is undefined. */
const EMPTY_SIM_STORE: SimStore = createSimStore();

/** A stable fallback view store so `useStore` never receives undefined. */
const FALLBACK_VIEW_STORE = createViewStore({ widthPx: 480, heightPx: 320 });

/** `ExportPanel`: report + live JSON preview + copy/download + image actions. */
export function ExportPanel({
  mechanismStore,
  studioStore,
  preferencesStore,
  view,
  canvasSize,
  sim,
}: ExportPanelProps): ReactNode {
  const { t, i18n } = useTranslation();
  const doc = useStore(mechanismStore, (s) => s.document);
  const themeMode = useStore(preferencesStore, (s) => s.themeMode);
  const layoutMode = useStore(studioStore, (s) => s.graphLayout);
  const viewport = useStore(view ?? FALLBACK_VIEW_STORE, (s) => s.viewport);
  const simPoses = useStore(sim?.store ?? EMPTY_SIM_STORE, (s) => s.poses);
  const simTraces = useStore(sim?.store ?? EMPTY_SIM_STORE, (s) => s.traces);
  const [copied, setCopied] = useState(false);

  const result = useMemo(() => exportGraphthe(doc), [doc]);
  const report = useMemo(() => buildExportReport(doc, result), [doc, result]);
  const analysis = useMemo(() => getGraphAnalysis(doc), [doc]);

  // WYSIWYG: in Simulate mode the drawn geometry is the scrubbed pose;
  // traces are visible coupler curves. Build mode exports the reference
  // pose (poses = null there) with no traces.
  const poses = sim ? (simPoses ?? undefined) : undefined;
  const traces = sim
    ? simTraces.map((trace) => ({
        markerId: trace.markerId,
        points: trace.points,
        closed: trace.closed,
      }))
    : undefined;

  async function handleCopy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(result.text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  async function handleDownload(): Promise<void> {
    const blob = new Blob([result.text], { type: "application/json" });
    await saveBlobToFile(blob, graphtheFileName(doc), JSON_SAVE_OPTIONS);
  }

  const widthPx = canvasSize?.width || 480;
  const heightPx = canvasSize?.height || 320;

  return (
    <Stack spacing={1.5} sx={{ p: 1.5 }} data-testid="export-panel">
      <ValidationReport report={report} studioStore={studioStore} mechanismStore={mechanismStore} />

      <Stack direction="row" spacing={1}>
        <Button
          size="small"
          variant="outlined"
          data-testid="export-copy"
          onClick={() => void handleCopy()}
        >
          {copied ? t("export.panel.copied") : t("export.panel.copy")}
        </Button>
        <Button
          size="small"
          variant="outlined"
          data-testid="export-download"
          onClick={() =>
            void handleDownload().catch((e: unknown) => {
              if (!isAbortError(e)) throw e;
            })
          }
        >
          {t("export.panel.download")}
        </Button>
      </Stack>

      <Box
        component="pre"
        data-testid="export-json"
        aria-label={t("export.panel.jsonPreview")}
        sx={{
          m: 0,
          p: 1,
          flex: "1 1 auto",
          minHeight: 120,
          maxHeight: 320,
          overflow: "auto",
          fontFamily: "monospace",
          fontSize: 12,
          whiteSpace: "pre",
          bgcolor: "action.hover",
          borderRadius: 1,
        }}
      >
        <Typography component="code" sx={{ fontFamily: "inherit", fontSize: "inherit" }}>
          {result.text.trimEnd()}
        </Typography>
      </Box>

      <ImageExportActions
        doc={doc}
        poses={poses}
        traces={traces}
        view={{ viewport, widthPx, heightPx }}
        analysis={analysis}
        layoutMode={layoutMode}
        stores={{ studioStore, mechanismStore }}
        themeMode={themeMode}
        i18n={i18n}
      />
    </Stack>
  );
}
