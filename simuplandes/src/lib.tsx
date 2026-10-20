/**
 * Library entry (`npm run build:lib`): the studio as a component a host page
 * (the robiolab website) mounts inside its own layout. Same boot as
 * `main.tsx`, but tied to the component's lifetime, without the global CSS
 * baseline, and without the Roboto font files -- the host already serves
 * them.
 */

import { useEffect, useState, type ReactNode } from "react";
import App, { type AppProps } from "./App";
import { startSession, getLocalStorage } from "./persistence/session";
import { createPreferencesStore, readUrlPreferences } from "./uiState/preferences";
import { createStudioStore } from "./uiState/studioStore";
import { createI18n } from "./i18n/i18n";
import type { Language } from "./i18n/numberFormat";

export interface SimuplandesStudioProps {
  /** CSS height of the studio; defaults to the full viewport. */
  height?: string;
  /**
   * The host page's language. When given it wins over the persisted
   * preference and `?lang=`, and the studio follows it whenever it changes.
   */
  language?: Language;
}

type Boot = Pick<AppProps, "session" | "preferences" | "studio" | "i18n">;

export function SimuplandesStudio({ height, language }: SimuplandesStudioProps): ReactNode {
  const [boot, setBoot] = useState<Boot | null>(null);

  // Booted in an effect (not a `useState` initializer) so the session's
  // autosave and `pagehide` listener are always paired with a dispose, and
  // so nothing touches `window` during the host's server-side render.
  useEffect(() => {
    const session = startSession();
    const preferences = createPreferencesStore({
      storage: getLocalStorage(),
      prefersDark: window.matchMedia("(prefers-color-scheme: dark)").matches,
    });
    preferences.setState(readUrlPreferences(window.location.search));
    if (language !== undefined) preferences.getState().setLanguage(language);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the session is an external resource owned by this effect
    setBoot({
      session,
      preferences,
      studio: createStudioStore(),
      i18n: createI18n(preferences.getState().language),
    });
    return () => {
      session.dispose();
    };
    // Only the initial `language` seeds the boot; later changes are applied by
    // the effect below without restarting the session.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (boot === null || language === undefined) return;
    boot.preferences.getState().setLanguage(language);
  }, [boot, language]);

  if (boot === null) return null;
  return <App {...boot} embedded height={height} />;
}
