/**
 * The studio's top-level CSS-grid layout: top bar, tool rail, a resizable
 * canvas/right-dock split, the transport placeholder and the status bar.
 * Grid ported literally from the approved `research/prototype.html` `.studio`
 * grid (top/rail/main/tx/sb areas).
 *
 * The compact layout (`useCompactLayout`: phones, narrow windows, heavy
 * browser zoom) drops the resizable split. In portrait the tools sit in a
 * bottom bar and the dock opens as a sheet under the canvas; in landscape
 * the rail stays at the left and the sheet opens at the right. The
 * transport shows only while simulating.
 */

import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useStore, type StoreApi } from "zustand";
import { Box, Typography, useMediaQuery } from "@mui/material";
import { alpha } from "@mui/material/styles";
import { Group, Panel, Separator, type PanelSize } from "react-resizable-panels";
import { TopBar } from "./TopBar";
import { ToolRail } from "./ToolRail";
import { CanvasArea } from "./CanvasArea";
import { RightDock } from "./RightDock";
import { Transport } from "./Transport";
import { StatusBar } from "./StatusBar";
import { PlotDock } from "../plots/PlotDock";
import { useStudioShortcuts } from "./useStudioShortcuts";
import { useFileDrop } from "../import/useFileDrop";
import { ImportDialog } from "../import/ImportDialog";
import { AtlasDialog } from "../atlas/AtlasDialog";
import { CommandPalette } from "../palette/CommandPalette";
import { ShortcutSheet } from "../palette/ShortcutSheet";
import { ShareLinkLoader } from "./ShareLinkLoader";
import { LANDSCAPE_MEDIA_QUERY, useCompactLayout } from "./useCompactLayout";
import type { Session } from "../../persistence/session";
import {
  MIN_DOCK_SIZE_PCT,
  MAX_DOCK_SIZE_PCT,
  type PreferencesState,
} from "../../uiState/preferences";
import type { StudioState } from "../../uiState/studioStore";
import { createSimStore } from "../../sim/simStore";
import { createSimRuntime } from "../../sim/runtime";
import { useSimRuntime } from "../../sim/react/useSimRuntime";
import { createViewStore } from "../../canvas/viewStore";

export interface StudioShellProps {
  session: Session;
  preferencesStore: StoreApi<PreferencesState>;
  studioStore: StoreApi<StudioState>;
  /** CSS height of the grid; the full viewport unless a host page embeds the studio. */
  height?: string;
}

/** The full visible viewport: `dvh` excludes a phone browser's collapsing URL bar; `vh` is the fallback. */
const FULL_VIEWPORT_HEIGHT = {
  height: "100vh",
  "@supports (height: 100dvh)": { height: "100dvh" },
} as const;

/** Grid templates for the compact layout; the desktop one is inline below. */
const COMPACT_PORTRAIT_GRID = {
  gridTemplateColumns: "minmax(0,1fr)",
  gridTemplateRows: "auto minmax(0,1fr) auto auto auto auto auto",
  gridTemplateAreas: `"top" "main" "dock" "plots" "tx" "rail" "sb"`,
} as const;

const COMPACT_LANDSCAPE_GRID = {
  gridTemplateColumns: "auto minmax(0,1fr) auto",
  gridTemplateRows: "auto minmax(0,1fr) auto auto auto",
  gridTemplateAreas: `"top top top" "rail main dock" "plots plots plots" "tx tx tx" "sb sb sb"`,
} as const;

export function StudioShell({
  session,
  preferencesStore,
  studioStore,
  height,
}: StudioShellProps): ReactNode {
  const { t } = useTranslation();
  const compact = useCompactLayout(preferencesStore);
  const landscape = useMediaQuery(LANDSCAPE_MEDIA_QUERY, { noSsr: true });
  const mode = useStore(studioStore, (s) => s.mode);
  const dockSheetOpen = useStore(studioStore, (s) => s.dockSheetOpen);
  useStudioShortcuts(studioStore, session.store);
  const { dragging } = useFileDrop((text, name) =>
    studioStore.getState().requestImport(text, name),
  );
  const dockSizePct = useStore(preferencesStore, (s) => s.dockSizePct);
  const [initialDockSizePct] = useState(dockSizePct);
  const lengthUnit = useStore(session.store, (s) => s.document.units.length);

  // One simStore/runtime per shell mount (`useState`'s lazy initializer runs
  // exactly once) -- `useSimRuntime` wires them to `studioStore`'s mode and
  // `session.store`'s document; it never constructs either itself, which is
  // what lets tests inject a fake runtime the same way plan 05-04's own
  // tests do.
  const [simStore] = useState(createSimStore);
  const [runtime] = useState(() => createSimRuntime({ store: simStore }));
  useSimRuntime({ studioStore, mechanismStore: session.store, simStore, runtime });
  // One view store shared by the canvas and the export dock, so image exports
  // use the canvas's real viewport and size (WYSIWYG) instead of a default view.
  const [viewStore] = useState(() => createViewStore());

  function handleDockResize(panelSize: PanelSize): void {
    preferencesStore.getState().setDockSizePct(panelSize.asPercentage);
  }

  const canvas = (
    <CanvasArea
      store={session.store}
      studio={studioStore}
      preferences={preferencesStore}
      view={viewStore}
      sim={{ store: simStore, runtime }}
      compact={compact}
    />
  );

  function renderDock(onClose?: () => void): ReactNode {
    return (
      <RightDock
        studioStore={studioStore}
        mechanismStore={session.store}
        preferencesStore={preferencesStore}
        view={viewStore}
        sim={{ store: simStore }}
        onClose={onClose}
      />
    );
  }

  return (
    <Box
      sx={[
        {
          display: "grid",
          width: "100%",
          bgcolor: "background.default",
          // Keeps a phone's pull-to-refresh and scroll chaining out of canvas gestures.
          overscrollBehavior: "none",
        },
        compact
          ? landscape
            ? COMPACT_LANDSCAPE_GRID
            : COMPACT_PORTRAIT_GRID
          : {
              gridTemplateColumns: (theme) => `${theme.spacing(6.5)} minmax(0,1fr)`,
              gridTemplateRows: "auto minmax(0,1fr) auto auto auto",
              gridTemplateAreas: `"top top" "rail main" "plots plots" "tx tx" "sb sb"`,
            },
        height === undefined ? FULL_VIEWPORT_HEIGHT : { height },
      ]}
    >
      <TopBar
        session={session}
        preferencesStore={preferencesStore}
        studioStore={studioStore}
        compact={compact}
      />
      <ToolRail
        studioStore={studioStore}
        orientation={compact && !landscape ? "horizontal" : "vertical"}
        touch={compact}
      />

      {compact ? (
        <>
          <Box sx={{ gridArea: "main", minHeight: 0, minWidth: 0, position: "relative" }}>
            {canvas}
            {/* Landscape has no room for a column beside the canvas: the sheet overlays its right edge. */}
            {dockSheetOpen && landscape ? (
              <Box
                sx={{
                  position: "absolute",
                  top: 0,
                  right: 0,
                  bottom: 0,
                  width: "min(60vw, 420px)",
                  zIndex: 2,
                  bgcolor: "background.paper",
                  borderLeft: 1,
                  borderColor: "divider",
                  boxShadow: 6,
                }}
              >
                {renderDock(() => studioStore.getState().setDockSheetOpen(false))}
              </Box>
            ) : null}
          </Box>
          {dockSheetOpen && !landscape ? (
            <Box
              sx={{
                gridArea: "dock",
                height: "min(45vh, 420px)",
                "@supports (height: 45dvh)": { height: "min(45dvh, 420px)" },
                minWidth: 0,
                borderTop: 1,
                borderColor: "divider",
              }}
            >
              {renderDock(() => studioStore.getState().setDockSheetOpen(false))}
            </Box>
          ) : null}
        </>
      ) : (
        <Box sx={{ gridArea: "main", minHeight: 0, minWidth: 0 }}>
          {/* react-resizable-panels v4 treats a bare number Panel size prop as
            PIXELS, not percent -- always pass explicit "%"-suffixed strings. */}
          <Group orientation="horizontal" style={{ height: "100%" }}>
            <Panel
              id="canvas"
              defaultSize={`${100 - initialDockSizePct}%`}
              minSize={`${100 - MAX_DOCK_SIZE_PCT}%`}
            >
              {canvas}
            </Panel>
            <Separator
              style={{
                width: 4,
                cursor: "col-resize",
                background: "var(--mui-palette-divider, #ccc)",
              }}
            />
            <Panel
              id="dock"
              defaultSize={`${initialDockSizePct}%`}
              minSize={`${MIN_DOCK_SIZE_PCT}%`}
              maxSize={`${MAX_DOCK_SIZE_PCT}%`}
              onResize={handleDockResize}
            >
              {renderDock()}
            </Panel>
          </Group>
        </Box>
      )}

      <Box sx={{ gridArea: "plots", minWidth: 0 }}>
        <PlotDock
          studioStore={studioStore}
          simStore={simStore}
          runtime={runtime}
          mechanismStore={session.store}
          compact={compact}
        />
      </Box>

      {compact && mode !== "simulate" ? null : (
        <Transport
          studioStore={studioStore}
          simStore={simStore}
          runtime={runtime}
          preferencesStore={preferencesStore}
          lengthUnit={lengthUnit}
          compact={compact}
        />
      )}
      <StatusBar
        studioStore={studioStore}
        preferencesStore={preferencesStore}
        mechanismStore={session.store}
        simStore={simStore}
        compact={compact}
      />
      <CommandPalette
        studioStore={studioStore}
        mechanismStore={session.store}
        preferencesStore={preferencesStore}
      />
      <ShortcutSheet studioStore={studioStore} />
      <ImportDialog studioStore={studioStore} mechanismStore={session.store} />
      <AtlasDialog studioStore={studioStore} mechanismStore={session.store} />
      <ShareLinkLoader mechanismStore={session.store} studioStore={studioStore} />
      {dragging ? (
        <Box
          data-testid="drop-overlay"
          sx={{
            position: "fixed",
            inset: 0,
            zIndex: (theme) => theme.zIndex.modal + 1,
            pointerEvents: "none",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            bgcolor: (theme) => alpha(theme.palette.primary.main, 0.12),
            border: 4,
            borderStyle: "dashed",
            borderColor: "primary.main",
          }}
        >
          <Typography variant="h4" color="primary">
            {t("shell.dropOverlay")}
          </Typography>
        </Box>
      ) : null}
    </Box>
  );
}
