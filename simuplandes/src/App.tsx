import { useEffect, useMemo, type ReactNode } from "react";
import { useStore, type StoreApi } from "zustand";
import { ThemeProvider, CssBaseline, ScopedCssBaseline } from "@mui/material";
import { I18nextProvider } from "react-i18next";
import type { i18n as I18nInstance } from "i18next";
import { createStudioTheme } from "./ui/theme/studioTheme";
import { StudioShell } from "./ui/shell/StudioShell";
import type { Session } from "./persistence/session";
import type { PreferencesState } from "./uiState/preferences";
import type { StudioState } from "./uiState/studioStore";

export interface AppProps {
  session: Session;
  preferences: StoreApi<PreferencesState>;
  studio: StoreApi<StudioState>;
  i18n: I18nInstance;
  /**
   * Rendered inside a host page (`src/lib.tsx`) rather than owning the
   * document: the CSS baseline is scoped to the studio and `<html>` is left
   * untouched.
   */
  embedded?: boolean;
  /** CSS height of the studio shell; defaults to the full viewport. */
  height?: string;
}

/**
 * The app root: derives the MUI theme and the i18next language from the
 * preferences store (Pattern 7 -- theme/language live outside the document
 * and outside undo history), then renders the studio shell.
 */
export default function App({
  session,
  preferences,
  studio,
  i18n,
  embedded = false,
  height,
}: AppProps): ReactNode {
  const themeMode = useStore(preferences, (s) => s.themeMode);
  const language = useStore(preferences, (s) => s.language);

  const theme = useMemo(() => createStudioTheme(themeMode, language), [themeMode, language]);

  useEffect(() => {
    void i18n.changeLanguage(language);
  }, [i18n, language]);

  useEffect(() => {
    if (embedded) return;
    document.documentElement.lang = language;
    document.documentElement.dataset.theme = themeMode;
  }, [embedded, language, themeMode]);

  const shell = (
    <StudioShell
      session={session}
      preferencesStore={preferences}
      studioStore={studio}
      height={height}
    />
  );

  return (
    <I18nextProvider i18n={i18n}>
      <ThemeProvider theme={theme}>
        {embedded ? (
          <ScopedCssBaseline sx={{ fontVariantNumeric: "tabular-nums" }}>{shell}</ScopedCssBaseline>
        ) : (
          <>
            <CssBaseline />
            {shell}
          </>
        )}
      </ThemeProvider>
    </I18nextProvider>
  );
}
