/**
 * `ImageExportActions` (XCH-09): the four image export actions -- Drawing
 * as SVG/PNG, Graph as SVG/PNG -- plus the "Print (light)" switch that
 * forces the light theme for exports regardless of the app's current
 * mode. 08-05's ExportPanel mounts this; the component itself reads no
 * app singletons: every input is a plain prop (`doc`, `poses`, `traces`,
 * `view`, `analysis`, stores, `themeMode`), so it stays testable and
 * mountable anywhere.
 *
 * PNG goes through the SAME SVG text as the SVG action (rasterized at 2x
 * on a white background), so "Drawing as SVG" and "Drawing as PNG" never
 * diverge. The rasterizer and the saver are injectable (`rasterize`/
 * `save`) so jsdom tests can exercise the full click path without a real
 * Image/canvas decode.
 */

import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Button, FormControlLabel, Stack, Switch } from "@mui/material";
import type { StoreApi } from "zustand";
import type { i18n } from "i18next";
import type { Id, MechanismDocument, Pose } from "../../model";
import type { MechanismStore } from "../../store";
import type { GraphAnalysis } from "../../graph";
import type { GraphLayoutKind, StudioState } from "../../uiState/studioStore";
import type { ThemeMode } from "../../uiState/preferences";
import type { Language } from "../../i18n/numberFormat";
import type { TracePrimitive } from "../../canvas/posesSource";
import { isAbortError, saveBlobToFile, type SaveResult } from "../../persistence/fileIO";
import { imageFileName, svgTextToBlob, svgTextToPngBlob } from "./imageExport";
import { renderDrawingSvgText, type DrawingSvgView } from "./DrawingSvg";
import { renderGraphSvgText } from "./graphImage";

export type ImageActionKind = "drawing-svg" | "drawing-png" | "graph-svg" | "graph-png";

export interface ImageExportActionsProps {
  doc: MechanismDocument;
  /** Phase 5 seam override -- the currently-shown poses (Simulate mode); undefined = reference pose. */
  poses?: ReadonlyMap<Id, Pose>;
  /** Visible coupler-curve traces (Simulate mode only). */
  traces?: readonly TracePrimitive[];
  view: DrawingSvgView;
  analysis: GraphAnalysis;
  layoutMode: GraphLayoutKind;
  stores: { studioStore: StoreApi<StudioState>; mechanismStore: MechanismStore };
  themeMode: ThemeMode;
  i18n: i18n;
  lang?: Language;
  /** Injectable rasterizer (defaults to `svgTextToPngBlob`) -- jsdom cannot decode an Image/canvas. */
  rasterize?: typeof svgTextToPngBlob;
  /** Injectable saver (defaults to `saveBlobToFile`). */
  save?: typeof saveBlobToFile;
}

const SVG_SAVE_OPTIONS = {
  description: "SVG image",
  mimeTypes: ["image/svg+xml"],
  extensions: [".svg"],
};
const PNG_SAVE_OPTIONS = {
  description: "PNG image",
  mimeTypes: ["image/png"],
  extensions: [".png"],
};

/** `ImageExportActions`: four buttons + the print-light switch. */
export function ImageExportActions({
  doc,
  poses,
  traces,
  view,
  analysis,
  layoutMode,
  stores,
  themeMode,
  i18n: i18nInstance,
  lang,
  rasterize = svgTextToPngBlob,
  save = saveBlobToFile,
}: ImageExportActionsProps): ReactNode {
  const { t } = useTranslation();
  const [printLight, setPrintLight] = useState(false);
  const [error, setError] = useState(false);

  const effectiveTheme: ThemeMode = printLight ? "light" : themeMode;

  async function exportAs(kind: ImageActionKind): Promise<void> {
    setError(false);
    try {
      const isGraph = kind === "graph-svg" || kind === "graph-png";
      const isPng = kind === "drawing-png" || kind === "graph-png";

      const svgText = isGraph
        ? renderGraphSvgText({
            analysis,
            layoutMode,
            stores,
            widthPx: view.widthPx,
            heightPx: view.heightPx,
            themeMode: effectiveTheme,
            i18n: i18nInstance,
            lang,
          })
        : renderDrawingSvgText({ doc, poses, traces, view, themeMode: effectiveTheme });

      const fileName = imageFileName(doc, isGraph ? "graph" : "drawing", isPng ? "png" : "svg");

      const blob = isPng
        ? await rasterize(svgText, {
            widthPx: view.widthPx,
            heightPx: view.heightPx,
            scale: 2,
            background: "#FFFFFF",
          })
        : svgTextToBlob(svgText);

      const result: SaveResult = await save(
        blob,
        fileName,
        isPng ? PNG_SAVE_OPTIONS : SVG_SAVE_OPTIONS,
      );
      if (result.kind === "cancelled") return;
    } catch (e) {
      if (isAbortError(e)) return; // a cancelled picker shows nothing
      setError(true);
    }
  }

  return (
    <Stack spacing={1} data-testid="export-image-actions">
      <Button
        data-testid="export-drawing-svg"
        variant="outlined"
        size="small"
        onClick={() => void exportAs("drawing-svg")}
      >
        {t("export.images.drawingSvg")}
      </Button>
      <Button
        data-testid="export-drawing-png"
        variant="outlined"
        size="small"
        onClick={() => void exportAs("drawing-png")}
      >
        {t("export.images.drawingPng")}
      </Button>
      <Button
        data-testid="export-graph-svg"
        variant="outlined"
        size="small"
        onClick={() => void exportAs("graph-svg")}
      >
        {t("export.images.graphSvg")}
      </Button>
      <Button
        data-testid="export-graph-png"
        variant="outlined"
        size="small"
        onClick={() => void exportAs("graph-png")}
      >
        {t("export.images.graphPng")}
      </Button>
      <FormControlLabel
        control={
          <Switch
            data-testid="export-print-light"
            size="small"
            checked={printLight}
            onChange={(event) => setPrintLight(event.target.checked)}
          />
        }
        label={t("export.images.printLight")}
        labelPlacement="end"
      />
      {error ? <div role="alert">{t("export.images.error")}</div> : null}
    </Stack>
  );
}
