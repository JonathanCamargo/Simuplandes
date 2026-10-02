/**
 * The `?` shortcut sheet: an MUI `Dialog` with two tables built straight
 * from `TOOL_REGISTRY` (key, label, description) and `EDIT_SHORTCUTS` (key
 * combo, label) -- no hard-coded shortcut list. `display` strings show
 * "Ctrl" on Windows/Linux and "⌘" on macOS (see `formatShortcutDisplay`).
 */

import { type ReactNode } from "react";
import { useStore, type StoreApi } from "zustand";
import { useTranslation } from "react-i18next";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  IconButton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Typography,
} from "@mui/material";
// Imported from the `esm/` subpath: see `src/ui/shell/TopBar.tsx`'s TSDoc for
// why (a real-browser-only `@mui/icons-material` CJS/ESM interop break).
import CloseIcon from "@mui/icons-material/esm/Close";
import { EDIT_SHORTCUTS, TOOL_REGISTRY } from "../../tools/registry";
import type { StudioState } from "../../uiState/studioStore";

export interface ShortcutSheetProps {
  studioStore: StoreApi<StudioState>;
}

/** `navigator.userAgentData.platform` when present, else `navigator.platform`. */
function detectPlatform(): string {
  if (typeof navigator === "undefined") return "";
  const uaData = (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData;
  return uaData?.platform ?? navigator.platform ?? "";
}

function isMacPlatform(): boolean {
  return /mac/i.test(detectPlatform());
}

/**
 * Renders a registry `display` string ("Ctrl/Cmd+Z") for the current OS:
 * "Ctrl+Z" on Windows/Linux, "⌘+Z" on macOS. Strings with no "Ctrl/Cmd"
 * token (e.g. "Delete/Backspace", "Esc", "F") pass through unchanged.
 * Exported (alongside the `ShortcutSheet` component) so it is directly
 * unit-testable without stubbing `navigator.platform` through a full render.
 */
// eslint-disable-next-line react-refresh/only-export-components -- pure helper, directly unit-tested; see TSDoc above.
export function formatShortcutDisplay(display: string): string {
  return isMacPlatform()
    ? display.replace(/Ctrl\/Cmd/g, "⌘")
    : display.replace(/Ctrl\/Cmd/g, "Ctrl");
}

export function ShortcutSheet({ studioStore }: ShortcutSheetProps): ReactNode {
  const { t } = useTranslation();
  const open = useStore(studioStore, (s) => s.shortcutSheetOpen);

  function close(): void {
    studioStore.getState().closeShortcutSheet();
  }

  return (
    <Dialog open={open} onClose={close} fullWidth maxWidth="sm">
      <DialogTitle sx={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        {t("palette.shortcutSheet.title")}
        <IconButton aria-label={t("palette.shortcutSheet.close")} size="small" onClick={close}>
          <CloseIcon fontSize="small" />
        </IconButton>
      </DialogTitle>
      <DialogContent dividers>
        <Typography variant="subtitle2" sx={{ mt: 1, mb: 0.5 }}>
          {t("palette.shortcutSheet.toolsHeading")}
        </Typography>
        <Table size="small" aria-label={t("palette.shortcutSheet.toolsHeading")}>
          <TableHead>
            <TableRow>
              <TableCell component="th">{t("palette.shortcutSheet.keyHeading")}</TableCell>
              <TableCell component="th">{t("palette.shortcutSheet.toolsHeading")}</TableCell>
              <TableCell component="th" />
            </TableRow>
          </TableHead>
          <TableBody>
            {TOOL_REGISTRY.map((tool) => (
              <TableRow key={tool.id}>
                <TableCell>
                  <Typography component="kbd">{tool.key.toUpperCase()}</Typography>
                </TableCell>
                <TableCell>{t(tool.labelKey)}</TableCell>
                <TableCell sx={{ color: "text.secondary" }}>{t(tool.descKey)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>

        <Typography variant="subtitle2" sx={{ mt: 2, mb: 0.5 }}>
          {t("palette.shortcutSheet.editHeading")}
        </Typography>
        <Table size="small" aria-label={t("palette.shortcutSheet.editHeading")}>
          <TableBody>
            {EDIT_SHORTCUTS.map((shortcut) => (
              <TableRow key={shortcut.id}>
                <TableCell>
                  <Typography component="kbd">{formatShortcutDisplay(shortcut.display)}</Typography>
                </TableCell>
                <TableCell>{t(shortcut.labelKey)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </DialogContent>
    </Dialog>
  );
}
