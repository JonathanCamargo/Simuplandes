/**
 * `ImportReportList`: the import dialog's grouped, localized report. Item text
 * is `t("import.report.<code>", params)` (the plan carries codes + params only,
 * like `ValidationReport`); every item with fixes shows a toggle group of
 * `t("import.fix.<id>", params)` with the active resolution selected. Choosing
 * another fix hands its partial options up (`onFix`), which re-plans.
 *
 * Dynamic fix ids (`input-U-V`, `ground-N`) are mapped to their i18n key by
 * stripping the suffix (09-03).
 */

import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Box, List, ListItem, ToggleButton, ToggleButtonGroup, Typography } from "@mui/material";
// Imported from the `esm/` subpath: see TopBar.tsx's TSDoc for why.
import ErrorIcon from "@mui/icons-material/esm/Error";
import WarningIcon from "@mui/icons-material/esm/Warning";
import InfoIcon from "@mui/icons-material/esm/Info";
import type {
  ImportFix,
  ImportOptions,
  ImportReportItem,
  ImportSeverity,
} from "../../interchange/importReport";

export interface ImportReportListProps {
  items: readonly ImportReportItem[];
  onFix: (option: Partial<ImportOptions>) => void;
}

const GROUPS: readonly { severity: ImportSeverity; labelKey: string }[] = [
  { severity: "error", labelKey: "import.groups.errors" },
  { severity: "warning", labelKey: "import.groups.warnings" },
  { severity: "info", labelKey: "import.groups.info" },
];

type Params = Record<string, string | number>;

function formatList(values: readonly (string | number)[], language: string): string {
  try {
    return new Intl.ListFormat(language).format(values.map(String));
  } catch {
    return values.join(", ");
  }
}

function plainParams(
  params: Record<string, string | number | readonly (string | number)[]>,
  language: string,
): Params {
  const out: Params = {};
  for (const [key, value] of Object.entries(params)) {
    out[key] = typeof value === "object" ? formatList(value, language) : value;
  }
  return out;
}

/** `input-3-4` -> `input`, `ground-2` -> `ground`; static ids pass through. */
function fixI18nKey(id: string): string {
  if (id.startsWith("input-")) return "input";
  if (id.startsWith("ground-")) return "ground";
  return id;
}

function fixParams(fix: ImportFix): Params {
  const params: Params = { ...fix.params };
  const input = /^input-(\d+)-(\d+)$/.exec(fix.id);
  if (input) {
    params.u = Number(input[1]);
    params.v = Number(input[2]);
  }
  return params;
}

function SeverityIcon({ severity }: { severity: ImportSeverity }): ReactNode {
  if (severity === "error") return <ErrorIcon fontSize="small" color="error" />;
  if (severity === "warning") return <WarningIcon fontSize="small" color="warning" />;
  return <InfoIcon fontSize="small" color="info" />;
}

export function ImportReportList({ items, onFix }: ImportReportListProps): ReactNode {
  const { t, i18n } = useTranslation();
  return (
    <Box data-testid="import-report">
      {GROUPS.map(({ severity, labelKey }) => {
        const group = items.filter((i) => i.severity === severity);
        if (group.length === 0) return null;
        return (
          <Box key={severity} data-severity-group={severity} sx={{ mb: 1 }}>
            <Typography variant="subtitle2">{t(labelKey, { count: group.length })}</Typography>
            <List dense disablePadding>
              {group.map((item) => (
                <ListItem
                  key={item.key}
                  data-testid="import-report-item"
                  data-code={item.code}
                  data-severity={item.severity}
                  sx={{ alignItems: "flex-start", gap: 1, flexWrap: "wrap" }}
                >
                  <SeverityIcon severity={item.severity} />
                  <Box sx={{ flex: "1 1 200px", minWidth: 0 }}>
                    <Typography variant="body2">
                      {t(`import.report.${item.code}`, plainParams(item.params, i18n.language))}
                    </Typography>
                    {item.fixes.length > 0 ? (
                      <ToggleButtonGroup
                        exclusive
                        size="small"
                        value={item.activeFixId}
                        sx={{ mt: 0.5, flexWrap: "wrap" }}
                        onChange={(_e, value: string | null) => {
                          if (value === null) return;
                          const fix = item.fixes.find((f) => f.id === value);
                          if (fix) onFix(fix.option);
                        }}
                      >
                        {item.fixes.map((fix) => (
                          <ToggleButton key={fix.id} value={fix.id} data-fix-id={fix.id}>
                            {t(`import.fix.${fixI18nKey(fix.id)}`, fixParams(fix))}
                          </ToggleButton>
                        ))}
                      </ToggleButtonGroup>
                    ) : null}
                  </Box>
                </ListItem>
              ))}
            </List>
          </Box>
        );
      })}
    </Box>
  );
}
