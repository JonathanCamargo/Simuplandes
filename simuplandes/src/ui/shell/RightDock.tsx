/**
 * The right dock: Inspector | Graph | Export tabs bound to
 * `studioStore.rightDockTab`. Inspector and Graph are the real panels
 * (06-05 wires in `GraphPanel`); the Export tab is `ExportPanel` (08-05):
 * validation report, live JSON preview, copy/download, and image
 * actions. Everything `ExportPanel`/`ImageExportActions` need beyond the
 * two stores arrives as optional props threaded from `StudioShell` (the
 * canvas view store + size and the sim store) so existing Build-only
 * callers/tests keep compiling.
 */

import type { ReactNode, SyntheticEvent } from "react";
import { useTranslation } from "react-i18next";
import { useStore, type StoreApi } from "zustand";
import { Box, IconButton, Tab, Tabs } from "@mui/material";
// Imported from the `esm/` subpath: see TopBar.tsx's TSDoc.
import CloseIcon from "@mui/icons-material/esm/Close";
import { InspectorPanel } from "../inspector/InspectorPanel";
import { GraphPanel } from "../graph/GraphPanel";
import { ExportPanel } from "../export/ExportPanel";
import type { RightDockTab, StudioState } from "../../uiState/studioStore";
import type { MechanismStore } from "../../store";
import type { PreferencesState } from "../../uiState/preferences";
import type { ViewStore } from "../../canvas/viewStore";
import type { SimStore } from "../../sim/simStore";

export interface RightDockProps {
  studioStore: StoreApi<StudioState>;
  mechanismStore: MechanismStore;
  /** Threaded to `ExportPanel` (08-05): the canvas's view store + measured size. */
  preferencesStore?: StoreApi<PreferencesState>;
  view?: ViewStore;
  canvasSize?: { width: number; height: number };
  /** Threaded to `ExportPanel`: the sim store (Simulate-mode poses/traces for WYSIWYG images). */
  sim?: { store: SimStore };
  /** The compact layout's sheet: shows a close button beside the tabs. */
  onClose?: () => void;
}

export function RightDock({
  studioStore,
  mechanismStore,
  preferencesStore,
  view,
  canvasSize,
  sim,
  onClose,
}: RightDockProps): ReactNode {
  const { t } = useTranslation();
  const tab = useStore(studioStore, (s) => s.rightDockTab);

  function handleChange(_event: SyntheticEvent, value: RightDockTab): void {
    studioStore.getState().setRightDockTab(value);
  }

  return (
    <Box
      component="aside"
      role="complementary"
      aria-label={t("shell.dock.label")}
      sx={{ display: "flex", flexDirection: "column", height: "100%" }}
    >
      {/* Roboto (robiolab theme) is wider than the old stack: tighter tab
          padding and sentence case keep "Inspector" unclipped down to the
          narrowest dock width an embedded studio gets. */}
      <Box sx={{ display: "flex", alignItems: "center", borderBottom: 1, borderColor: "divider" }}>
        <Tabs
          value={tab}
          onChange={handleChange}
          variant="fullWidth"
          sx={{
            flex: 1,
            minHeight: 44,
            "& .MuiTab-root": {
              minWidth: 0,
              minHeight: 44,
              px: 1,
              fontSize: "0.9rem",
            },
          }}
        >
          <Tab value="inspector" label={t("shell.dock.inspector")} />
          <Tab value="graph" label={t("shell.dock.graph")} />
          <Tab value="export" label={t("shell.dock.export")} />
        </Tabs>
        {onClose ? (
          <IconButton onClick={onClose} aria-label={t("shell.dock.close")} sx={{ mx: 0.5 }}>
            <CloseIcon fontSize="small" />
          </IconButton>
        ) : null}
      </Box>
      <Box
        sx={{
          flex: 1,
          overflow: "auto",
          minHeight: 0,
          display: "flex",
          flexDirection: "column",
        }}
      >
        {tab === "inspector" ? (
          <InspectorPanel store={mechanismStore} simStore={sim?.store} />
        ) : null}
        {tab === "graph" ? (
          <GraphPanel mechanismStore={mechanismStore} studioStore={studioStore} />
        ) : null}
        {tab === "export" && preferencesStore ? (
          <ExportPanel
            mechanismStore={mechanismStore}
            studioStore={studioStore}
            preferencesStore={preferencesStore}
            view={view}
            canvasSize={canvasSize}
            sim={sim}
          />
        ) : null}
      </Box>
    </Box>
  );
}
