/**
 * The collapsible plot dock (SIM-05): an x-axis (input/time) toggle, a
 * multi-select quantity picker (up to 4 series), the uPlot chart, a
 * nominal-rate note, and CSV export. Renders only in Simulate mode while
 * `simStore.plot.open` is true; collapses to nothing otherwise (the parent
 * `StudioShell` always mounts `<PlotDock>` -- this component itself decides
 * whether to render, so every hook below runs unconditionally regardless of
 * mode/open, per the rules of hooks).
 *
 * Two very different data paths feed the chart:
 * - `xAxis === "input"`: `simStore.sweepTable` (published once per session)
 *   is read via `useStore` and rebuilt into `uPlot.AlignedData` on demand --
 *   this changes rarely (a sweep only runs once per document/motor), so a
 *   normal React data flow is fine.
 * - `xAxis === "time"`: after the FIRST sample ever arrives (`historyVersion
 *   > 0`, a one-time `useStore` flip that mounts the chart), every further
 *   version bump is picked up by a raw `simStore.subscribe` inside a
 *   `useEffect` and pushed straight into the mounted `UPlotChart` via its
 *   imperative `setData` -- PlotDock itself never re-renders per bump.
 */

import { useEffect, useMemo, useRef, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useStore, type StoreApi } from "zustand";
import {
  Box,
  Button,
  Checkbox,
  Chip,
  FormControl,
  IconButton,
  ListItemText,
  MenuItem,
  Select,
  Stack,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
  useTheme,
  type SelectChangeEvent,
} from "@mui/material";
// Imported from the `esm/` subpath: see TopBar.tsx's TSDoc for why.
import CloseIcon from "@mui/icons-material/esm/Close";
import type uPlot from "uplot";
import { UPlotChart, type UPlotChartHandle, type UPlotSeriesSpec } from "./UPlotChart";
import { canvasTokensFor } from "../theme/studioTheme";
import { formatNumber } from "../../i18n/numberFormat";
import { tableToCsv, unitLabel, csvFileName } from "../../sim/csv";
import type { MeasurementTable, QuantityDef } from "../../sim/plots";
import type { SimStore, PlotXAxis } from "../../sim/simStore";
import type { SimSessionSummary } from "../../sim/session";
import type { SimRuntime } from "../../sim/runtime";
import type { StudioState } from "../../uiState/studioStore";
import type { MechanismStore } from "../../store";
import type { MechanismDocument } from "../../model";

export interface PlotDockProps {
  studioStore: StoreApi<StudioState>;
  simStore: SimStore;
  runtime: SimRuntime;
  mechanismStore: MechanismStore;
}

const MAX_SERIES = 4;
const CHART_HEIGHT = 140;

function seriesColors(mode: "light" | "dark"): readonly string[] {
  const tokens = canvasTokensFor(mode);
  return [tokens.accent, tokens.ok, tokens.warn, tokens.err];
}

function toAlignedData(table: MeasurementTable | null, ids: readonly string[]): uPlot.AlignedData {
  if (!table || table.length === 0) return [[]];
  const columns = ids.map((id) => {
    const index = table.quantities.findIndex((q) => q.id === id);
    return index === -1 ? new Float64Array(table.length) : table.columns[index];
  });
  return [table.x, ...columns] as uPlot.AlignedData;
}

/** Mirrors `runtime.ts`'s own `classifyDrive` rate rule (constant motor speed, defaulting to 1 when 0; 1 for a temporary driver or an expression drive) -- the same rate `computeSweep` was run with. */
function nominalRateFor(session: SimSessionSummary | null, doc: MechanismDocument): number {
  if (session?.drivingMode === "motor" && session.inputMotorId) {
    const motor = doc.motors.find((m) => m.id === session.inputMotorId);
    if (motor && motor.drive.mode === "constant") {
      return motor.drive.speed !== 0 ? motor.drive.speed : 1;
    }
  }
  return 1;
}

export function PlotDock({
  studioStore,
  simStore,
  runtime,
  mechanismStore,
}: PlotDockProps): ReactNode {
  const { t, i18n } = useTranslation();
  const theme = useTheme();
  const chartRef = useRef<UPlotChartHandle>(null);

  const mode = useStore(studioStore, (s) => s.mode);
  const open = useStore(simStore, (s) => s.plot.open);
  const xAxis = useStore(simStore, (s) => s.plot.xAxis);
  const quantityIds = useStore(simStore, (s) => s.plot.quantityIds);
  const session = useStore(simStore, (s) => s.session);
  const sweepTable = useStore(simStore, (s) => s.sweepTable);
  const quantities = useStore(simStore, (s) => s.quantities);
  const hasHistory = useStore(simStore, (s) => s.historyVersion > 0);
  const lengthUnit = useStore(mechanismStore, (s) => s.document.units.length);

  const themeMode = theme.palette.mode === "dark" ? "dark" : "light";
  const tokens = canvasTokensFor(themeMode);
  const colors = seriesColors(themeMode);

  const selectedQuantities = useMemo(
    () =>
      quantityIds
        .map((id) => quantities.find((q) => q.id === id))
        .filter((q): q is QuantityDef => q !== undefined),
    [quantityIds, quantities],
  );

  const seriesSpecs: UPlotSeriesSpec[] = useMemo(
    () =>
      selectedQuantities.map((q, index) => ({
        id: q.id,
        label: t(`sim.plots.quantity.${q.token}`, { entity: q.entityLabel }),
        stroke: colors[index % colors.length],
        unitLabel: unitLabel(q.unit, lengthUnit),
      })),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `colors` is a fresh array per render (theme-derived); its CONTENT only changes with `themeMode`, which is already a dep via `t`'s language change re-render + `themeMode` below.
    [selectedQuantities, t, lengthUnit, themeMode],
  );

  const chartData: uPlot.AlignedData = useMemo(() => {
    if (xAxis === "time") {
      return hasHistory ? toAlignedData(runtime.getHistoryTable(), quantityIds) : [[]];
    }
    return sweepTable ? toAlignedData(sweepTable, quantityIds) : [[]];
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `runtime` is stable for the shell's lifetime; deliberately NOT re-run per `historyVersion` bump (that path is pushed imperatively below).
  }, [xAxis, hasHistory, sweepTable, quantityIds]);

  const xLabel =
    xAxis === "time"
      ? t("sim.plots.xAxis.time")
      : (session?.inputLabel ?? t("sim.plots.xAxis.input"));

  // Time-mode: push every further history-version bump straight into the
  // mounted chart via its imperative handle. No React re-render here.
  useEffect(() => {
    if (xAxis !== "time") return undefined;
    return simStore.subscribe((state, prevState) => {
      if (state.historyVersion === prevState.historyVersion) return;
      chartRef.current?.setData(toAlignedData(runtime.getHistoryTable(), quantityIds));
    });
  }, [xAxis, quantityIds, simStore, runtime]);

  function handleXAxisChange(_event: unknown, value: PlotXAxis | null): void {
    if (value) simStore.getState().setPlotXAxis(value);
  }

  function handleQuantitiesChange(event: SelectChangeEvent<string[]>): void {
    const value = event.target.value;
    const ids = typeof value === "string" ? value.split(",") : value;
    simStore.getState().setPlotQuantities(ids.slice(0, MAX_SERIES));
  }

  function handleExport(): void {
    if (!session) return;
    const doc = mechanismStore.getState().document;
    const table = xAxis === "time" ? runtime.getHistoryTable() : sweepTable;
    if (!table) return;
    const csv = tableToCsv(table, quantityIds, {
      inputLabel: session.inputLabel,
      lengthUnit: doc.units.length,
    });
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = csvFileName(doc.name, xAxis);
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  }

  const currentTable =
    xAxis === "time" ? (hasHistory ? runtime.getHistoryTable() : null) : sweepTable;
  const rateDisplay = formatNumber(
    nominalRateFor(session, mechanismStore.getState().document),
    i18n.language === "en" ? "en" : "es",
    2,
  );
  const rateUnit = session?.inputKind === "linear" ? `${lengthUnit}/s` : "rad/s";

  if (mode !== "simulate" || !open) return null;

  const showEmptyTime = xAxis === "time" && !hasHistory;
  const showEmptyInput = xAxis === "input" && !sweepTable;

  return (
    <Box
      role="region"
      aria-label={t("sim.plots.region")}
      sx={{
        height: 220,
        borderTop: 1,
        borderColor: "divider",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        bgcolor: "background.paper",
      }}
    >
      <Stack direction="row" spacing={1.5} alignItems="center" sx={{ px: 1.5, py: 0.5 }}>
        <ToggleButtonGroup
          exclusive
          size="small"
          value={xAxis}
          aria-label={t("sim.plots.xAxis.label")}
          onChange={handleXAxisChange}
        >
          <ToggleButton value="input">{t("sim.plots.xAxis.input")}</ToggleButton>
          <ToggleButton value="time">{t("sim.plots.xAxis.time")}</ToggleButton>
        </ToggleButtonGroup>

        <FormControl size="small" sx={{ minWidth: 260 }}>
          <Select
            multiple
            displayEmpty
            value={[...quantityIds]}
            onChange={handleQuantitiesChange}
            inputProps={{ "aria-label": t("sim.plots.quantities") }}
            renderValue={(selected) => (
              <Stack direction="row" spacing={0.5} flexWrap="wrap">
                {selected.map((id) => {
                  const q = quantities.find((qq) => qq.id === id);
                  const label = q
                    ? t(`sim.plots.quantity.${q.token}`, { entity: q.entityLabel })
                    : id;
                  return <Chip key={id} size="small" label={label} />;
                })}
              </Stack>
            )}
          >
            {quantities.map((q) => {
              const checked = quantityIds.includes(q.id);
              const disabled = !checked && quantityIds.length >= MAX_SERIES;
              return (
                <MenuItem key={q.id} value={q.id} disabled={disabled}>
                  <Checkbox size="small" checked={checked} />
                  <ListItemText
                    primary={`${t(`sim.plots.quantity.${q.token}`, { entity: q.entityLabel })} [${unitLabel(q.unit, lengthUnit)}]`}
                  />
                </MenuItem>
              );
            })}
          </Select>
        </FormControl>

        <Box sx={{ flex: 1 }} />

        <Button size="small" onClick={handleExport} disabled={!currentTable}>
          {t("sim.plots.exportCsv")}
        </Button>
        <IconButton
          size="small"
          onClick={() => simStore.getState().setPlotOpen(false)}
          aria-label={t("sim.plots.close")}
        >
          <CloseIcon fontSize="small" />
        </IconButton>
      </Stack>

      {xAxis === "input" && session ? (
        <Typography variant="caption" color="text.secondary" sx={{ px: 1.5 }}>
          {t("sim.plots.nominalRate", { rate: `${rateDisplay} ${rateUnit}` })}
        </Typography>
      ) : null}

      <Box sx={{ flex: 1, minHeight: 0, px: 1.5, pb: 1 }}>
        {showEmptyTime ? (
          <Typography variant="body2" color="text.secondary">
            {t("sim.plots.emptyTime")}
          </Typography>
        ) : showEmptyInput ? (
          <Typography variant="body2" color="text.secondary">
            {t("sim.plots.emptyInput")}
          </Typography>
        ) : (
          <UPlotChart
            ref={chartRef}
            xLabel={xLabel}
            series={seriesSpecs}
            data={chartData}
            axisStroke={tokens.ink}
            gridStroke={tokens.grid}
            height={CHART_HEIGHT}
          />
        )}
      </Box>
    </Box>
  );
}
