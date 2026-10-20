/**
 * Builds the MUI theme driving all Studio chrome from the approved
 * `CANVAS_TOKENS` (Pattern 7): theme mode and language live outside the
 * document and outside undo history, and this factory is the single place
 * that turns them into a `Theme`.
 */

import { createTheme, type Theme } from "@mui/material/styles";
import { esES, enUS } from "@mui/material/locale";
import { CANVAS_TOKENS, type CanvasTokens } from "./tokens";
import type { ThemeMode } from "../../uiState/preferences";
import type { Language } from "../../i18n/numberFormat";

/** The prototype-approved canvas tokens for `mode` (also usable directly by canvas layers). */
export function canvasTokensFor(mode: ThemeMode): CanvasTokens {
  return CANVAS_TOKENS[mode];
}

const TABULAR_NUMS = { fontVariantNumeric: "tabular-nums" } as const;

/**
 * Size of the Studio chrome relative to MUI's defaults. Scales text and icons
 * (both derive from `typography.fontSize`) and the spacing unit together; the
 * canvas is unaffected. This is the one knob for "the buttons are too small".
 */
export const UI_SCALE = 1.2;

/**
 * `createStudioTheme(mode, lang)`: an MUI theme whose palette is derived
 * from `CANVAS_TOKENS[mode]` and whose locale (`esES`/`enUS`, from
 * `@mui/material/locale`) matches `lang`. Body typography is the robiolab
 * website's `--base-font` stack; Roboto is self-hosted via
 * `@fontsource/roboto` (imported in `main.tsx`), as the website does.
 */
export function createStudioTheme(mode: ThemeMode, lang: Language): Theme {
  const tokens = canvasTokensFor(mode);
  const localeTheme = lang === "es" ? esES : enUS;

  return createTheme(
    {
      palette: {
        mode,
        background: {
          default: tokens.paper,
          paper: tokens.panel,
        },
        text: {
          primary: tokens.ink,
          secondary: tokens.muted,
        },
        primary: {
          main: tokens.accent,
        },
        divider: tokens.line,
        success: {
          main: tokens.ok,
        },
        warning: {
          main: tokens.warn,
        },
        error: {
          main: tokens.err,
        },
      },
      typography: {
        fontFamily: '"Roboto",Arial,sans-serif',
        fontSize: 14 * UI_SCALE,
        // Sentence case for buttons, toggles and tabs: calmer than MUI's
        // all-caps default, and long Spanish labels stay readable.
        button: { textTransform: "none", fontWeight: 600 },
      },
      spacing: 8 * UI_SCALE,
      components: {
        MuiCssBaseline: {
          styleOverrides: {
            body: TABULAR_NUMS,
          },
        },
        MuiInputBase: {
          styleOverrides: {
            root: TABULAR_NUMS,
          },
        },
      },
    },
    localeTheme,
  );
}
