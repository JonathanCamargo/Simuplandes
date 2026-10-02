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
import { Box, Tab, Tabs } from "@mui/material";
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
}

export function RightDock({
  studioStore,
  mechanismStore,
  preferencesStore,
  view,
  canvasSize,
  sim,
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
          padding keeps "INSPECTOR" unclipped at the default dock width. */}
      <Tabs
        value={tab}
        onChange={handleChange}
        variant="fullWidth"
        sx={{ "& .MuiTab-root": { minWidth: 0, px: 1 } }}
      >
        <Tab value="inspector" label={t("shell.dock.inspector")} />
        <Tab value="graph" label={t("shell.dock.graph")} />
        <Tab value="export" label={t("shell.dock.export")} />
      </Tabs>
      <Box
        sx={{
          flex: 1,
          overflow: "auto",
          minHeight: 0,
          display: "flex",
          flexDirection: "column",
        }}
      >
        {tab === "inspector" ? <InspectorPanel store={mechanismStore} /> : null}
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
