/**
 * The real Simulate-mode transport bar (replaces `TransportPlaceholder`):
 * play/pause, step, reset, speed, loop, the input scrubber, lock-up/near
 * -singular chips, a status caption, and the "Gráficas ▾" plots toggle.
 *
 * Selectors are limited to `session`, `range`, `playing`, `speed`, `loop`,
 * `readout`, `plot.open` -- NEVER `poses` (that field is per-frame and read
 * imperatively by the canvas; selecting it here would re-render this
 * component every simulation frame, defeating the whole point of
 * `simStore`'s throttled-readout split -- see `simStore.ts`'s own TSDoc).
 */

import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
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
  Typography,
} from "@mui/material";
// Imported from the `esm/` subpath: see TopBar.tsx's TSDoc.
import PlayArrowIcon from "@mui/icons-material/esm/PlayArrow";
import PauseIcon from "@mui/icons-material/esm/Pause";
import SkipPreviousIcon from "@mui/icons-material/esm/SkipPrevious";
import NavigateBeforeIcon from "@mui/icons-material/esm/NavigateBefore";
import NavigateNextIcon from "@mui/icons-material/esm/NavigateNext";
import { formatNumber } from "../../i18n/numberFormat";
import { inputDisplayValue } from "../../sim/session";
import { SPEED_OPTIONS, type SimStore } from "../../sim/simStore";
import type { SimRuntime } from "../../sim/runtime";
import type { StudioState } from "../../uiState/studioStore";
import type { PreferencesState } from "../../uiState/preferences";

export interface TransportProps {
  studioStore: StoreApi<StudioState>;
  simStore: SimStore;
  runtime: SimRuntime;
  preferencesStore: StoreApi<PreferencesState>;
  /** `session.store.getState().document.units.length` -- only used for a linear input's value label. */
  lengthUnit: string;
}

function statusKeyAndValues(
  mode: "build" | "simulate",
  session: import("../../sim/session").SimSessionSummary | null,
): { key: string; values?: Record<string, string | number> } | null {
  if (mode === "build") return { key: "sim.transport.enterSimulate" };
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

export function Transport({
  studioStore,
  simStore,
  runtime,
  preferencesStore,
  lengthUnit,
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

  // Local scrub value, held only while the user is dragging the thumb (never
  // throttled -- research Pattern 2 says drive the motor synchronously on
  // every `onChange`); cleared on `onChangeCommitted` so the slider then
  // tracks the throttled `readout.display` again.
  const [localDisplay, setLocalDisplay] = useState<number | null>(null);

  const canOperate = session?.status === "ready" && session?.drivingMode === "motor";
  const playDisabled = mode === "simulate" && !canOperate;
  const otherControlsDisabled = mode === "build" || !canOperate;

  const isLinear = session?.inputKind === "linear";
  const unitSuffix = isLinear ? ` ${lengthUnit}` : "°";

  const sliderRange =
    !session || !range
      ? { min: 0, max: 0 }
      : range.fullRotation
        ? { min: 0, max: 360 }
        : {
            min: inputDisplayValue(session, range, range.min),
            max: inputDisplayValue(session, range, range.max),
          };
  const stepSize = isLinear ? Math.max((sliderRange.max - sliderRange.min) / 200, 1e-6) : 1;

  const displayValue = localDisplay ?? readout?.display ?? 0;

  function handlePlayClick(): void {
    if (mode === "build") {
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

  const status = statusKeyAndValues(mode, session);

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
      <IconButton
        size="small"
        onClick={handlePlayClick}
        disabled={playDisabled}
        aria-label={t(playing ? "sim.transport.pause" : "sim.transport.play")}
      >
        {playing ? <PauseIcon fontSize="small" /> : <PlayArrowIcon fontSize="small" />}
      </IconButton>
      <IconButton
        size="small"
        onClick={() => runtime.reset()}
        disabled={otherControlsDisabled}
        aria-label={t("sim.transport.reset")}
      >
        <SkipPreviousIcon fontSize="small" />
      </IconButton>
      <IconButton
        size="small"
        onClick={() => runtime.step(-1)}
        disabled={otherControlsDisabled}
        aria-label={t("sim.transport.stepBack")}
      >
        <NavigateBeforeIcon fontSize="small" />
      </IconButton>
      <IconButton
        size="small"
        onClick={() => runtime.step(1)}
        disabled={otherControlsDisabled}
        aria-label={t("sim.transport.stepForward")}
      >
        <NavigateNextIcon fontSize="small" />
      </IconButton>

      <Slider
        size="small"
        aria-label={t("sim.transport.scrubber", { input: session?.inputLabel ?? "" })}
        min={sliderRange.min}
        max={sliderRange.max}
        step={stepSize}
        value={displayValue}
        disabled={otherControlsDisabled}
        valueLabelDisplay="auto"
        valueLabelFormat={(v) => `${formatNumber(v, lang, 1)}${unitSuffix}`}
        onChange={handleSliderChange}
        onChangeCommitted={handleSliderCommitted}
        sx={{ maxWidth: 200 }}
      />
      <Typography variant="caption" sx={{ minWidth: 56 }} noWrap>
        {formatNumber(displayValue, lang, 1)}
        {unitSuffix}
      </Typography>

      <Select
        size="small"
        value={speed}
        onChange={(event) => runtime.setSpeed(Number(event.target.value))}
        aria-label={t("sim.transport.speed")}
        sx={{ minWidth: 72 }}
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

      {readout?.lockUp ? (
        <Chip
          size="small"
          color="warning"
          label={t("sim.transport.lockUp", {
            value: `${formatNumber(readout.lockUp.display, lang, 1)}${unitSuffix}`,
          })}
        />
      ) : null}
      {readout?.nearSingular ? (
        <Chip size="small" color="warning" label={t("sim.transport.nearSingular")} />
      ) : null}

      {status ? (
        <Typography variant="caption" color="text.secondary" noWrap>
          {t(status.key, status.values)}
        </Typography>
      ) : null}

      <Chip
        size="small"
        clickable
        aria-pressed={plotOpen}
        disabled={mode !== "simulate"}
        onClick={() => simStore.getState().togglePlotOpen()}
        label={`${t("sim.transport.plots")} ▾`}
      />
    </Stack>
  );
}
