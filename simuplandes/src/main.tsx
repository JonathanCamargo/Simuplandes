import "@fontsource/roboto/400.css";
import "@fontsource/roboto/500.css";
import "@fontsource/roboto/700.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { startSession, getLocalStorage } from "./persistence/session";
import { createPreferencesStore, readUrlPreferences } from "./uiState/preferences";
import { createStudioStore } from "./uiState/studioStore";
import { createI18n } from "./i18n/i18n";

const el = document.getElementById("root");
if (el === null) {
  throw new Error("#root element missing");
}

const session = startSession();
const preferences = createPreferencesStore({
  storage: getLocalStorage(),
  prefersDark: window.matchMedia("(prefers-color-scheme: dark)").matches,
});
preferences.setState(readUrlPreferences(window.location.search));
const studio = createStudioStore();
const i18n = createI18n(preferences.getState().language);

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    session.dispose();
  });
}

createRoot(el).render(
  <StrictMode>
    <App session={session} preferences={preferences} studio={studio} i18n={i18n} />
  </StrictMode>,
);
