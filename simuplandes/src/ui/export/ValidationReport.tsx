/**
 * `ValidationReport` (XCH-02 UI): the Export tab's grouped, clickable,
 * localized pre-export report. Renders `buildExportReport`'s items as
 * three severity groups (errors / warnings / info) with counts — only
 * non-empty groups — or a localized "ready to export" line when the
 * report is empty.
 *
 * Item text comes from `t("export.report.<code>", params)` — the report
 * itself carries codes + params + ids only (08-04's contract), so this
 * component is where localization happens. Array params (names/links)
 * are joined with `Intl.ListFormat` in the current language.
 *
 * Interaction mirrors `GraphSvg`'s own click/hover pair: clicking an
 * item selects its `[...linkIds, ...jointIds]` and hover-halos the first
 * id via `studioStore.setHoveredId` (Phase 6's halo mechanism — the
 * canvas draws selection + hover halos from those same stores). Pointer
 * leave clears the hover ONLY if this list set it. Items are keyboard-
 * focusable MUI `ListItemButton`s.
 */

import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { List, ListItemButton, Typography } from "@mui/material";
// Imported from the `esm/` subpath: see TopBar.tsx's TSDoc for why.
import ErrorIcon from "@mui/icons-material/esm/Error";
import WarningIcon from "@mui/icons-material/esm/Warning";
import InfoIcon from "@mui/icons-material/esm/Info";
import type { StoreApi } from "zustand";
import type { Id } from "../../model";
import type { MechanismStore } from "../../store";
import type { StudioState } from "../../uiState/studioStore";
import type { ReportItem, ReportSeverity, ExportReport } from "../../interchange";

export interface ValidationReportProps {
  report: ExportReport;
  studioStore: StoreApi<StudioState>;
  mechanismStore: MechanismStore;
}

const GROUPS: readonly { severity: ReportSeverity; labelKey: string }[] = [
  { severity: "error", labelKey: "export.report.group.errors" },
  { severity: "warning", labelKey: "export.report.group.warnings" },
  { severity: "info", labelKey: "export.report.group.info" },
];

/** Formats an array param (names/links/ids) for the current language. */
function formatList(values: readonly (string | number)[], language: string): string {
  try {
    return new Intl.ListFormat(language).format(values.map(String));
  } catch {
    return values.join(", ");
  }
}

/** `t("export.report.<code>", params)` with array params pre-formatted. */
function itemText(
  t: (key: string, params?: Record<string, string | number>) => string,
  language: string,
  item: ReportItem,
): string {
  const params: Record<string, string | number> = {};
  for (const [key, value] of Object.entries(item.params)) {
    if (Array.isArray(value)) {
      params[key] = formatList(value, language);
    } else if (typeof value === "string" || typeof value === "number") {
      params[key] = value;
    }
  }
  return t(`export.report.${item.code}`, params);
}

function severityIcon(severity: ReportSeverity): ReactNode {
  switch (severity) {
    case "error":
      return <ErrorIcon fontSize="small" color="error" />;
    case "warning":
      return <WarningIcon fontSize="small" color="warning" />;
    default:
      return <InfoIcon fontSize="small" color="info" />;
  }
}

/** `ValidationReport`: the grouped, clickable, localized report list. */
export function ValidationReport({
  report,
  studioStore,
  mechanismStore,
}: ValidationReportProps): ReactNode {
  const { t, i18n } = useTranslation();
  const [hoveredOwned, setHoveredOwned] = useState<Id | null>(null);

  function handleEnter(item: ReportItem): void {
    const firstId = [...item.linkIds, ...item.jointIds][0];
    if (firstId === undefined) return;
    setHoveredOwned(firstId);
    studioStore.getState().setHoveredId(firstId);
  }

  function handleLeave(): void {
    if (hoveredOwned !== null) {
      studioStore.getState().setHoveredId(null);
      setHoveredOwned(null);
    }
  }

  function handleClick(item: ReportItem): void {
    const ids = [...item.linkIds, ...item.jointIds];
    if (ids.length === 0) return;
    mechanismStore.getState().select(ids, "replace");
    studioStore.getState().setHoveredId(ids[0]);
    setHoveredOwned(ids[0]);
  }

  if (report.items.length === 0) {
    return (
      <Typography data-testid="export-report-empty" color="text.secondary" sx={{ px: 1 }}>
        {t("export.report.ready")}
      </Typography>
    );
  }

  return (
    <List dense disablePadding data-testid="export-report">
      {GROUPS.map(({ severity, labelKey }) => {
        const items = report.items.filter((item) => item.severity === severity);
        if (items.length === 0) return null;
        return (
          <div key={severity} data-group={severity}>
            <Typography
              variant="caption"
              color="text.secondary"
              sx={{ px: 2, pt: 1, display: "block" }}
            >
              {t(labelKey, { count: items.length })}
            </Typography>
            {items.map((item) => (
              <ListItemButton
                key={item.key}
                data-testid="export-report-item"
                data-code={item.code}
                data-severity={item.severity}
                onClick={() => handleClick(item)}
                onMouseEnter={() => handleEnter(item)}
                onFocus={() => handleEnter(item)}
                onMouseLeave={handleLeave}
                onBlur={handleLeave}
              >
                {severityIcon(severity)}
                <Typography variant="body2" sx={{ ml: 1, pr: 1 }}>
                  {itemText(t, i18n.language, item)}
                </Typography>
              </ListItemButton>
            ))}
          </div>
        );
      })}
    </List>
  );
}
