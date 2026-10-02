/**
 * The live "F = n" mobility badge (SIM-06): a small MUI `Chip` headlining
 * Gruebler's F, colored by `computeDofReport`'s severity, that opens a
 * `Popover` explaining the result (formula, counts, instantaneous rank, the
 * plain-language explanation, and an optional motor note).
 *
 * `computeDofReport` is recomputed via `useMemo` keyed on the document
 * OBJECT ITSELF (`[doc]`), never per-frame: playback only ever mutates
 * `simStore`'s ephemeral poses/readout, never `mechanismStore`'s document,
 * so the badge is stable across every simulation frame and only recomputes
 * on a real document edit (add/remove link or joint, undo/redo, load).
 *
 * The severity glyph is a real MUI SVG icon (not a literal "✓"/"⚠" text
 * character): an inline text glyph would become part of the Chip's own
 * `textContent` (`icon` and `label` are DOM siblings), which would break
 * both `toHaveTextContent("F = 1")`-style jsdom assertions and Playwright's
 * exact-match `toHaveText("F = 1")` E2E assertions. An SVG icon (path-only,
 * no text nodes) conveys the same severity visually -- on top of the Chip's
 * own `color` prop, which already changes the chip's background/text color
 * per severity -- while leaving the accessible/DOM text exactly "F = n".
 */

import { useMemo, useState, type MouseEvent, type ReactElement, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useStore } from "zustand";
import { Chip, Popover, Stack, Typography, type ChipProps } from "@mui/material";
// Imported from the `esm/` subpath: see TopBar.tsx's TSDoc for why.
import CheckCircleIcon from "@mui/icons-material/esm/CheckCircle";
import WarningIcon from "@mui/icons-material/esm/Warning";
import ErrorIcon from "@mui/icons-material/esm/Error";
import { computeDofReport, type DofSeverity } from "../../sim/dof";
import type { MechanismStore } from "../../store";

export interface DofBadgeProps {
  mechanismStore: MechanismStore;
}

const SEVERITY_COLOR: Record<DofSeverity, ChipProps["color"]> = {
  ok: "success",
  warn: "warning",
  error: "error",
  neutral: "default",
};

function severityIcon(severity: DofSeverity): ReactElement | undefined {
  switch (severity) {
    case "ok":
      return <CheckCircleIcon fontSize="small" />;
    case "warn":
      return <WarningIcon fontSize="small" />;
    case "error":
      return <ErrorIcon fontSize="small" />;
    default:
      return undefined;
  }
}

const POPOVER_HEADING_ID = "dof-badge-popover-heading";

export function DofBadge({ mechanismStore }: DofBadgeProps): ReactNode {
  const { t } = useTranslation();
  const doc = useStore(mechanismStore, (s) => s.document);
  const report = useMemo(() => computeDofReport(doc), [doc]);
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);

  const label = t(report.headlineKey, report.values);
  const open = anchorEl !== null;

  function handleOpen(event: MouseEvent<HTMLElement>): void {
    setAnchorEl(event.currentTarget);
  }

  function handleClose(): void {
    setAnchorEl(null);
  }

  return (
    <>
      <Chip
        size="small"
        data-testid="dof-badge"
        data-severity={report.severity}
        color={SEVERITY_COLOR[report.severity]}
        icon={severityIcon(report.severity)}
        label={label}
        onClick={handleOpen}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={`${t("sim.dof.title")}: ${label}`}
      />
      <Popover
        open={open}
        anchorEl={anchorEl}
        onClose={handleClose}
        anchorOrigin={{ vertical: "bottom", horizontal: "left" }}
        PaperProps={{
          role: "dialog",
          "aria-labelledby": POPOVER_HEADING_ID,
          sx: { p: 2, maxWidth: 360 },
        }}
      >
        <Stack spacing={1}>
          <Typography id={POPOVER_HEADING_ID} variant="subtitle2">
            {t("sim.dof.title")}
          </Typography>
          {report.gruebler !== null ? (
            <Typography variant="body2">{t("sim.dof.formula", report.values)}</Typography>
          ) : null}
          <Typography variant="body2">{t("sim.dof.counts", report.values)}</Typography>
          {report.rankDof !== null ? (
            <Typography variant="body2">{t("sim.dof.rank", report.values)}</Typography>
          ) : null}
          <Typography variant="body2">
            {t(report.explanationKey, { ...report.values, count: report.values.count })}
          </Typography>
          {report.motorNoteKey ? (
            <Typography variant="body2" color="text.secondary">
              {t(report.motorNoteKey, { count: report.values.motorCount })}
            </Typography>
          ) : null}
        </Stack>
      </Popover>
    </>
  );
}
