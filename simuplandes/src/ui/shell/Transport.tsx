/**
 * The real Simulate-mode transport bar (replaces `TransportPlaceholder`):
 * play/pause, step, reset, speed, loop, the input scrubber, lock-up/near
 * -singular chips, a status caption, and the "Gráficas ▾" plots toggle.
 *
 * A Kinematics/Dynamics switch leads the bar. In Dynamics the scrubber is
 * time over the computed trajectory, a duration select replaces nothing
 * else, and the caption reports computing progress or why integration
 * stopped.
 *
 * The compact layout stacks it: the playback buttons and a full-width
 * scrubber first, then the analysis, speed, loop and plot controls, then
 * the status caption (wrapped, never cut off).
 *
 * Selectors are limited to `session`, `range`, `playing`, `speed`, `loop`,
 * `readout`, `plot.open` -- NEVER `poses` (that field is per-frame and read
 * imperatively by the canvas; selecting it here would re-render this
 * component every simulation frame, defeating the whole point of
 * `simStore`'s throttled-readout split -- see `simStore.ts`'s own TSDoc).
 */

import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { useStore, type StoreApi } from "zustand";
import {
  Chip,
  FormControlLabel,
  Checkbox,
  IconButton,
  MenuItem,
  Select,
  Slider,
  Stack,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from "@mui/material";
// Imported from the `esm/` subpath: see TopBar.tsx's TSDoc.
import PlayArrowIcon from "@mui/icons-material/esm/PlayArrow";
import ShowChartIcon from "@mui/icons-material/esm/ShowChart";
import PauseIcon from "@mui/icons-material/esm/Pause";
import SkipPreviousIcon from "@mui/icons-material/esm/SkipPrevious";
import NavigateBeforeIcon from "@mui/icons-material/esm/NavigateBefore";
import NavigateNextIcon from "@mui/icons-material/esm/NavigateNext";
import { formatNumber } from "../../i18n/numberFormat";
import { inputDisplayValue } from "../../sim/session";
import {
  DURATION_OPTIONS,
  SPEED_OPTIONS,
  type DynamicsReadout,
  type SimAnalysis,
  type SimStore,
} from "../../sim/simStore";
import type { SimRuntime } from "../../sim/runtime";
import type { StudioMode, StudioState } from "../../uiState/studioStore";
import type { PreferencesState } from "../../uiState/preferences";

export interface TransportProps {
  studioStore: StoreApi<StudioState>;
  simStore: SimStore;
  runtime: SimRuntime;
  preferencesStore: StoreApi<PreferencesState>;
  /** `session.store.getState().document.units.length` -- only used for a linear input's value label. */
  lengthUnit: string;
  /** The compact (phone) layout: see this file's TSDoc. */
  compact?: boolean;
}

function statusKeyAndValues(
  mode: StudioMode,
  session: import("../../sim/session").SimSessionSummary | null,
): { key: string; values?: Record<string, string | number> } | null {
  if (mode !== "simulate") return { key: "sim.transport.enterSimulate" };
  if (!session) return null;
  switch (session.status) {
    case "invalid":
      return { key: "sim.status.invalid", values: { message: session.errorMessage ?? "" } };
    case "assembly-failed":
      return {
        key: "sim.status.assemblyFailed",
        values: { joints: session.violations.map((v) => v.label).join(", ") },
      };
    case "empty":
      return { key: "sim.status.empty" };
    case "not-drivable": {
      const reasonKey =
        session.reason === "no-dof"
          ? "noDof"
          : session.reason === "multi-dof"
            ? "multiDof"
            : "noInput";
      return {
        key: `sim.status.notDrivable.${reasonKey}`,
        values: { dof: session.rankDof ?? 0 },
      };
    }
    case "ready":
      if (session.drivingMode === "temporary") return { key: "sim.status.temporaryDriver" };
      if (session.ignoredMotorCount > 0) {
        return { key: "sim.status.ignoredMotors", values: { count: session.ignoredMotorCount } };
      }
      return null;
    default:
      return null;
  }
}

/** The Dynamics caption: why the session cannot run, computing progress, or where integration stopped. */
function dynamicsStatus(
  dynamics: DynamicsReadout | null,
  lang: "es" | "en",
  t: TFunction,
): { key: string; values?: Record<string, string | number> } | null {
  if (!dynamics) return null;
  const { summary } = dynamics;
  switch (summary.status) {
    case "empty":
      return { key: "sim.dynamics.status.empty" };
    case "invalid":
      return {
        key: "sim.dynamics.status.invalid",
        values: { message: summary.errorMessage ?? "" },
      };
    case "invalid-expression":
      return {
        key: "sim.dynamics.status.invalidExpression",
        values: { motors: summary.invalidMotorIds.join(", ") },
      };
    case "assembly-failed":
      return {
        key: "sim.dynamics.status.assemblyFailed",
        values: { joints: summary.violations.map((v) => v.label).join(", ") },
      };
    case "over-driven":
      return { key: "sim.dynamics.status.overDriven" };
    default:
      break;
  }
  if (dynamics.status === "computing") {
    return {
      key: "sim.dynamics.computing",
      values: {
        time: formatNumber(dynamics.computedTime, lang, 1),
        duration: dynamics.duration,
      },
    };
  }
  if (dynamics.stop) {
    return {
      key: "sim.dynamics.stopped",
      values: {
        time: formatNumber(dynamics.stop.time, lang, 2),
        reason: t(`sim.dynamics.stop.${dynamics.stop.reason}`),
      },
    };
  }
  return { key: "sim.dynamics.status.ready", values: { count: summary.dof ?? 0 } };
}

export function Transport({
  studioStore,
  simStore,
  runtime,
  preferencesStore,
  lengthUnit,
  compact = false,
}: TransportProps): ReactNode {
  const { t } = useTranslation();
  const lang = useStore(preferencesStore, (s) => s.language);
  const mode = useStore(studioStore, (s) => s.mode);
  const session = useStore(simStore, (s) => s.session);
  const range = useStore(simStore, (s) => s.range);
  const playing = useStore(simStore, (s) => s.playing);
  const speed = useStore(simStore, (s) => s.speed);
  const loop = useStore(simStore, (s) => s.loop);
  const readout = useStore(simStore, (s) => s.readout);
  const plotOpen = useStore(simStore, (s) => s.plot.open);
  const analysis = useStore(simStore, (s) => s.analysis);
  const dynamics = useStore(simStore, (s) => s.dynamics);
  const duration = useStore(simStore, (s) => s.dynamicsDuration);
  const isDynamics = analysis === "dynamics";

  // Local scrub value, held only while the user is dragging the thumb (never
  // throttled -- research Pattern 2 says drive the motor synchronously on
  // every `onChange`); cleared on `onChangeCommitted` so the slider then
  // tracks the throttled `readout.display` again.
  const [localDisplay, setLocalDisplay] = useState<number | null>(null);

  const canOperate = isDynamics
    ? dynamics?.status != null
    : session?.status === "ready" && session?.drivingMode === "motor";
  const playDisabled = mode === "simulate" && !canOperate;
  const otherControlsDisabled = mode !== "simulate" || !canOperate;

  const isLinear = !isDynamics && session?.inputKind === "linear";
  const unitSuffix = isDynamics ? " s" : isLinear ? ` ${lengthUnit}` : "°";

  const sliderRange = isDynamics
    ? { min: 0, max: duration }
    : !session || !range
      ? { min: 0, max: 0 }
      : range.fullRotation
        ? { min: 0, max: 360 }
        : {
            min: inputDisplayValue(session, range, range.min),
            max: inputDisplayValue(session, range, range.max),
          };
  const stepSize = isDynamics
    ? duration / 600
    : isLinear
      ? Math.max((sliderRange.max - sliderRange.min) / 200, 1e-6)
      : 1;

  const displayValue = localDisplay ?? readout?.display ?? 0;

  function handlePlayClick(): void {
    if (mode !== "simulate") {
      studioStore.getState().setMode("simulate");
    }
    runtime.togglePlay();
  }

  function handleSliderChange(_event: Event, value: number | number[]): void {
    const v = Array.isArray(value) ? value[0] : value;
    setLocalDisplay(v);
    runtime.scrubTo(v);
  }

  function handleSliderCommitted(): void {
    setLocalDisplay(null);
  }

  const status =
    isDynamics && mode === "simulate"
      ? dynamicsStatus(dynamics, lang, t)
      : statusKeyAndValues(mode, session);
  const fractionDigits = isDynamics ? 2 : 1;

  function handleAnalysisChange(_event: unknown, value: SimAnalysis | null): void {
    if (value) runtime.setAnalysis(value);
  }

  // Touch targets: 40px icon buttons in the compact layout.
  const iconSize = compact ? "medium" : "small";

  const analysisToggle = (
    <ToggleButtonGroup
      exclusive
      size="small"
      value={analysis}
      onChange={handleAnalysisChange}
      aria-label={t("sim.transport.analysis")}
      sx={{
        "& .MuiToggleButton-root": compact
          ? { py: 0.75, px: 1.25, fontSize: "0.8125rem" }
          : { py: 0.25, px: 1, fontSize: "0.75rem" },
      }}
    >
      <ToggleButton value="kinematics">{t("sim.transport.analysisKinematics")}</ToggleButton>
      <ToggleButton value="dynamics">{t("sim.transport.analysisDynamics")}</ToggleButton>
    </ToggleButtonGroup>
  );

  const playbackButtons = (
    <>
      {/* Play is the main action in Simulate: a filled primary button. */}
      <IconButton
        size={iconSize}
        onClick={handlePlayClick}
        disabled={playDisabled}
        aria-label={t(playing ? "sim.transport.pause" : "sim.transport.play")}
        sx={{
          bgcolor: "primary.main",
          color: "primary.contrastText",
          "&:hover": { bgcolor: "primary.dark" },
          "&.Mui-disabled": { bgcolor: "action.disabledBackground" },
        }}
      >
        {playing ? <PauseIcon fontSize={iconSize} /> : <PlayArrowIcon fontSize={iconSize} />}
      </IconButton>
      <IconButton
        size={iconSize}
        onClick={() => runtime.reset()}
        disabled={otherControlsDisabled}
        aria-label={t("sim.transport.reset")}
      >
        <SkipPreviousIcon fontSize={iconSize} />
      </IconButton>
      <IconButton
        size={iconSize}
        onClick={() => runtime.step(-1)}
        disabled={otherControlsDisabled}
        aria-label={t("sim.transport.stepBack")}
      >
        <NavigateBeforeIcon fontSize={iconSize} />
      </IconButton>
      <IconButton
        size={iconSize}
        onClick={() => runtime.step(1)}
        disabled={otherControlsDisabled}
        aria-label={t("sim.transport.stepForward")}
      >
        <NavigateNextIcon fontSize={iconSize} />
      </IconButton>
    </>
  );

  const scrubber = (
    <>
      <Slider
        size={compact ? "medium" : "small"}
        aria-label={
          isDynamics
            ? t("sim.transport.time")
            : t("sim.transport.scrubber", { input: session?.inputLabel ?? "" })
        }
        min={sliderRange.min}
        max={sliderRange.max}
        step={stepSize}
        value={displayValue}
        disabled={otherControlsDisabled}
        valueLabelDisplay="auto"
        valueLabelFormat={(v) => `${formatNumber(v, lang, fractionDigits)}${unitSuffix}`}
        onChange={handleSliderChange}
        onChangeCommitted={handleSliderCommitted}
        sx={
          compact
            ? { flex: 1, minWidth: 0, mx: 1.5 }
            : { flex: "1 1 160px", minWidth: 120, maxWidth: 420, mx: 1 }
        }
      />
      <Typography
        variant="caption"
        sx={{ minWidth: 56, textAlign: compact ? "right" : undefined }}
        noWrap
      >
        {formatNumber(displayValue, lang, fractionDigits)}
        {unitSuffix}
      </Typography>
    </>
  );

  const options = (
    <>
      {isDynamics ? (
        <Select
          size="small"
          value={duration}
          onChange={(event) => runtime.setDuration(Number(event.target.value))}
          inputProps={{ "aria-label": t("sim.transport.duration") }}
          sx={{ minWidth: 72, fontSize: "0.8125rem", "& .MuiSelect-select": { py: 0.5 } }}
        >
          {DURATION_OPTIONS.map((option) => (
            <MenuItem key={option} value={option}>
              {t("sim.transport.durationOption", { seconds: option })}
            </MenuItem>
          ))}
        </Select>
      ) : null}

      <Select
        size="small"
        value={speed}
        onChange={(event) => runtime.setSpeed(Number(event.target.value))}
        aria-label={t("sim.transport.speed")}
        sx={{ minWidth: 64, fontSize: "0.8125rem", "& .MuiSelect-select": { py: 0.5 } }}
      >
        {SPEED_OPTIONS.map((option) => (
          <MenuItem key={option} value={option}>
            {option}×
          </MenuItem>
        ))}
      </Select>

      <FormControlLabel
        sx={{ mr: 0 }}
        control={
          <Checkbox
            size="small"
            checked={loop}
            onChange={(event) => runtime.setLoop(event.target.checked)}
          />
        }
        label={<Typography variant="caption">{t("sim.transport.loop")}</Typography>}
      />
    </>
  );

  const warningChips = (
    <>
      {readout?.lockUp ? (
        <Chip
          size="small"
          color="warning"
          label={t("sim.transport.lockUp", {
            value: `${formatNumber(readout.lockUp.display, lang, 1)}${unitSuffix}`,
          })}
        />
      ) : null}
      {readout?.nearSingular && !isDynamics ? (
        <Chip size="small" color="warning" label={t("sim.transport.nearSingular")} />
      ) : null}
      {isDynamics && dynamics?.singular ? (
        <Chip size="small" color="warning" label={t("sim.dynamics.singular")} />
      ) : null}
    </>
  );

  const statusCaption = status ? (
    <Typography variant="caption" color="text.secondary" noWrap={!compact}>
      {t(status.key, status.values)}
    </Typography>
  ) : null;

  const plotsToggle = (
    <Chip
      size={compact ? "medium" : "small"}
      clickable
      aria-pressed={plotOpen}
      disabled={mode !== "simulate"}
      onClick={() => simStore.getState().togglePlotOpen()}
      icon={<ShowChartIcon fontSize="small" aria-hidden="true" />}
      color={plotOpen ? "primary" : "default"}
      variant={plotOpen ? "filled" : "outlined"}
      label={`${t("sim.transport.plots")} ▾`}
    />
  );

  if (compact) {
    return (
      <Stack
        component="div"
        role="region"
        aria-label={t("sim.transport.label")}
        spacing={0.5}
        sx={{ gridArea: "tx", px: 1, py: 0.5, borderTop: 1, borderColor: "divider" }}
      >
        <Stack direction="row" spacing={0.5} alignItems="center">
          {playbackButtons}
          {scrubber}
        </Stack>
        <Stack direction="row" alignItems="center" flexWrap="wrap" useFlexGap spacing={1}>
          {analysisToggle}
          {options}
          {plotsToggle}
          {warningChips}
        </Stack>
        {statusCaption}
      </Stack>
    );
  }

  return (
    <Stack
      component="div"
      role="region"
      aria-label={t("sim.transport.label")}
      direction="row"
      spacing={1.5}
      alignItems="center"
      flexWrap="wrap"
      sx={{ gridArea: "tx", px: 1.5, py: 0.5, borderTop: 1, borderColor: "divider" }}
    >
      {analysisToggle}
      {playbackButtons}
      {scrubber}
      {options}
      {warningChips}
      {statusCaption}
      {plotsToggle}
    </Stack>
  );
}
