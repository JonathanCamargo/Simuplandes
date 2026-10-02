/**
 * The always-visible status bar: cursor position, snap status, the active
 * tool's hint (or a tool-state-specific hint once tools publish one), the
 * Grid/Snap toggles, and -- while `mode === "simulate"` -- a solver-status
 * segment fed by the (optional) `simStore` prop.
 */

import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useStore, type StoreApi } from "zustand";
import { Box, Checkbox, FormControlLabel, Stack, Typography } from "@mui/material";
import { formatNumber } from "../../i18n/numberFormat";
import { toolById } from "../../tools/registry";
import type { StudioState } from "../../uiState/studioStore";
import type { PreferencesState } from "../../uiState/preferences";
import type { MechanismStore } from "../../store";
import { createSimStore, type SolverReadoutStatus, type SimStore } from "../../sim/simStore";

export interface StatusBarProps {
  studioStore: StoreApi<StudioState>;
  preferencesStore: StoreApi<PreferencesState>;
  mechanismStore: MechanismStore;
  /** Optional so existing callers/tests (Build-mode-only) keep working unchanged. */
  simStore?: SimStore;
}

/** A stable, never-mutated fallback so `useStore` is always called with a real store (no conditional hook call) when the caller omits `simStore`. */
const EMPTY_SIM_STORE: SimStore = createSimStore();

const SOLVER_KEY: Record<SolverReadoutStatus, string> = {
  ok: "sim.solver.ok",
  locked: "sim.solver.locked",
  "no-convergence": "sim.solver.noConvergence",
  "invalid-input": "sim.solver.invalidInput",
};

export function StatusBar({
  studioStore,
  preferencesStore,
  mechanismStore,
  simStore,
}: StatusBarProps): ReactNode {
  const { t } = useTranslation();
  const mode = useStore(studioStore, (s) => s.mode);
  const cursorWorld = useStore(studioStore, (s) => s.cursorWorld);
  const snapStatus = useStore(studioStore, (s) => s.snapStatus);
  const hint = useStore(studioStore, (s) => s.hint);
  const activeTool = useStore(studioStore, (s) => s.activeTool);
  const language = useStore(preferencesStore, (s) => s.language);
  const gridVisible = useStore(preferencesStore, (s) => s.gridVisible);
  const snapEnabled = useStore(preferencesStore, (s) => s.snapEnabled);
  const lengthUnit = useStore(mechanismStore, (s) => s.document.units.length);
  const solver = useStore(simStore ?? EMPTY_SIM_STORE, (s) => s.readout?.solver ?? null);

  const xText = cursorWorld === null ? "—" : formatNumber(cursorWorld.x, language, 1);
  const yText =
    cursorWorld === null ? "—" : `${formatNumber(cursorWorld.y, language, 1)} ${lengthUnit}`;
  const snapText = snapStatus === null ? "—" : t(snapStatus.labelKey, snapStatus.values);

  const hintKey = hint?.key ?? toolById(activeTool).hintKey;
  const hintText = t(hintKey, hint?.values);

  const solverText =
    mode === "simulate" && solver
      ? t(
          SOLVER_KEY[solver.status],
          solver.status === "ok" ? { residual: solver.residualNorm.toExponential(0) } : undefined,
        )
      : null;

  return (
    <Stack
      component="footer"
      role="contentinfo"
      direction="row"
      spacing={2}
      alignItems="center"
      sx={{
        gridArea: "sb",
        px: 1.5,
        py: 0.5,
        borderTop: 1,
        borderColor: "divider",
        fontVariantNumeric: "tabular-nums",
        overflow: "hidden",
      }}
    >
      <Typography variant="caption" noWrap>
        {t("shell.status.x")} {xText}
      </Typography>
      <Typography variant="caption" noWrap>
        {t("shell.status.y")} {yText}
      </Typography>
      <Typography variant="caption" noWrap>
        {t("shell.status.snap")}: {snapText}
      </Typography>
      <FormControlLabel
        sx={{ mr: 0 }}
        control={
          <Checkbox
            size="small"
            checked={gridVisible}
            onChange={(event) => preferencesStore.getState().setGridVisible(event.target.checked)}
          />
        }
        label={<Typography variant="caption">{t("shell.status.grid")}</Typography>}
      />
      <FormControlLabel
        sx={{ mr: 0 }}
        control={
          <Checkbox
            size="small"
            checked={snapEnabled}
            onChange={(event) => preferencesStore.getState().setSnapEnabled(event.target.checked)}
          />
        }
        label={<Typography variant="caption">{t("shell.status.snapToggle")}</Typography>}
      />
      <Box sx={{ flex: 1 }} />
      {solverText !== null ? (
        <Typography variant="caption" noWrap>
          {t("sim.solver.label")}: {solverText}
        </Typography>
      ) : null}
      <Typography variant="caption" noWrap sx={{ fontWeight: 600 }}>
        {t("shell.status.hintPrefix")}: {hintText}
      </Typography>
    </Stack>
  );
}
