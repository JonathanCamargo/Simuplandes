/**
 * The studio's top-level CSS-grid layout: top bar, tool rail, a resizable
 * canvas/right-dock split, the transport placeholder and the status bar.
 * Grid ported literally from the approved `research/prototype.html` `.studio`
 * grid (top/rail/main/tx/sb areas).
 */

import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useStore, type StoreApi } from "zustand";
import { Box, Typography } from "@mui/material";
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

export interface StudioShellProps {
  session: Session;
  preferencesStore: StoreApi<PreferencesState>;
  studioStore: StoreApi<StudioState>;
}

export function StudioShell({
  session,
  preferencesStore,
  studioStore,
}: StudioShellProps): ReactNode {
  const { t } = useTranslation();
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

  function handleDockResize(panelSize: PanelSize): void {
    preferencesStore.getState().setDockSizePct(panelSize.asPercentage);
  }

  return (
    <Box
      sx={{
        display: "grid",
        gridTemplateColumns: "52px minmax(0,1fr)",
        gridTemplateRows: "auto minmax(0,1fr) auto auto auto",
        gridTemplateAreas: `"top top" "rail main" "plots plots" "tx tx" "sb sb"`,
        height: "100vh",
        width: "100%",
        bgcolor: "background.default",
      }}
    >
      <TopBar session={session} preferencesStore={preferencesStore} studioStore={studioStore} />
      <ToolRail studioStore={studioStore} />

      <Box sx={{ gridArea: "main", minHeight: 0, minWidth: 0 }}>
        {/* react-resizable-panels v4 treats a bare number Panel size prop as
            PIXELS, not percent -- always pass explicit "%"-suffixed strings. */}
        <Group orientation="horizontal" style={{ height: "100%" }}>
          <Panel
            id="canvas"
            defaultSize={`${100 - initialDockSizePct}%`}
            minSize={`${100 - MAX_DOCK_SIZE_PCT}%`}
          >
            <CanvasArea
              store={session.store}
              studio={studioStore}
              preferences={preferencesStore}
              sim={{ store: simStore, runtime }}
            />
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
            <RightDock
              studioStore={studioStore}
              mechanismStore={session.store}
              preferencesStore={preferencesStore}
              sim={{ store: simStore }}
            />
          </Panel>
        </Group>
      </Box>

      <Box sx={{ gridArea: "plots", minWidth: 0 }}>
        <PlotDock
          studioStore={studioStore}
          simStore={simStore}
          runtime={runtime}
          mechanismStore={session.store}
        />
      </Box>

      <Transport
        studioStore={studioStore}
        simStore={simStore}
        runtime={runtime}
        preferencesStore={preferencesStore}
        lengthUnit={lengthUnit}
      />
      <StatusBar
        studioStore={studioStore}
        preferencesStore={preferencesStore}
        mechanismStore={session.store}
        simStore={simStore}
      />
      <CommandPalette
        studioStore={studioStore}
        mechanismStore={session.store}
        preferencesStore={preferencesStore}
      />
      <ShortcutSheet studioStore={studioStore} />
      <ImportDialog studioStore={studioStore} mechanismStore={session.store} />
      <AtlasDialog studioStore={studioStore} mechanismStore={session.store} />
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
