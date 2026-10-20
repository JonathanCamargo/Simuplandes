/**
 * `useCompactLayout(preferences)`: whether the studio uses its compact
 * (phone) layout. An explicit "desktop"/"compact" preference wins; "auto"
 * follows the viewport, so a phone, a narrow window and a browser zoomed far
 * in (which shrinks the CSS viewport the same way) all get the compact shell.
 */

import { useMediaQuery, useTheme } from "@mui/material";
import { useStore, type StoreApi } from "zustand";
import type { PreferencesState } from "../../uiState/preferences";

/** Narrower than MUI's `md` breakpoint, or too short for the desktop bars (a phone in landscape). */
export const COMPACT_MEDIA_QUERY = "(max-width: 899.95px), (max-height: 499.95px)";

export function useCompactLayout(preferences: StoreApi<PreferencesState>): boolean {
  const layoutMode = useStore(preferences, (s) => s.layoutMode);
  const viewportIsCompact = useMediaQuery(COMPACT_MEDIA_QUERY, { noSsr: true });
  if (layoutMode === "desktop") return false;
  if (layoutMode === "compact") return true;
  return viewportIsCompact;
}

/** Phone in landscape: the dock sheet sits beside the canvas instead of under it. */
export const LANDSCAPE_MEDIA_QUERY = "(orientation: landscape)";

/** Large dialogs take the whole screen on a phone (below MUI's `sm`), where a centered card leaves no room. */
export function useFullScreenDialog(): boolean {
  // `useTheme` falls back to MUI's default theme outside a ThemeProvider (tests).
  const theme = useTheme();
  return useMediaQuery(theme.breakpoints.down("sm"), { noSsr: true });
}
