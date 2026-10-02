/**
 * Persisted UI-preferences store: theme mode, language, grid/snap toggles
 * and the right-dock split size. Lives entirely outside `MechanismDocument`
 * and outside undo history (Pattern 7) -- switching theme or language is
 * never a Ctrl+Z step, and never touches the mechanism store.
 *
 * Persistence follows the project's explicit-subscriber style (see
 * `src/persistence/session.ts`'s `startAutosave`), not the zustand
 * `persist` middleware: an explicit `store.subscribe` writes JSON, and
 * storage failures (quota, private mode) are swallowed rather than thrown.
 */

import { createStore, type StoreApi } from "zustand/vanilla";
import { z } from "zod";
import { SUPPORTED_LANGUAGES, type Language } from "../i18n/numberFormat";

export const PREFERENCES_STORAGE_KEY = "simuplandes:ui-prefs";

export type ThemeMode = "light" | "dark";

export const MIN_DOCK_SIZE_PCT = 15;
export const MAX_DOCK_SIZE_PCT = 50;
export const DEFAULT_DOCK_SIZE_PCT = 26;
const DEFAULT_LANGUAGE: Language = "es";

/**
 * Storage-format marker for the dock size, bumped whenever the *meaning* of
 * `dockSizePct` changes in a way that makes a previously-persisted value
 * untrustworthy. v1 = the pre-04-07 build, whose `StudioShell.tsx` passed
 * bare numbers to react-resizable-panels v4's `Panel` size props (read as
 * PIXELS, not percent); any v1-saved `dockSizePct` is an artifact of that
 * bug (e.g. a ~50px-wide dock reporting as `dockSizePct: 15`), not a real
 * user choice, and must be discarded. v2 = percent-string props (this plan).
 */
export const DOCK_LAYOUT_VERSION = 2;

/** The subset of `PreferencesState` that is persisted (no setter functions). */
export interface PersistedPreferences {
  themeMode: ThemeMode;
  language: Language;
  gridVisible: boolean;
  snapEnabled: boolean;
  dockSizePct: number;
}

/** The on-disk JSON shape: persisted UI state plus the storage-format marker. */
type PersistedPayload = PersistedPreferences & { dockLayoutVersion: number };

export interface PreferencesState extends PersistedPreferences {
  setThemeMode(mode: ThemeMode): void;
  toggleThemeMode(): void;
  setLanguage(language: Language): void;
  setGridVisible(visible: boolean): void;
  setSnapEnabled(enabled: boolean): void;
  /** Clamped to [15, 50]. */
  setDockSizePct(pct: number): void;
}

function clampDockSizePct(pct: number): number {
  return Math.min(MAX_DOCK_SIZE_PCT, Math.max(MIN_DOCK_SIZE_PCT, pct));
}

/**
 * `readUrlPreferences(search)`: the `?theme=light|dark` and `?lang=es|en`
 * overrides a linking page (the robiolab website) passes so the studio opens
 * in the site's current theme and language. Unknown or missing values are
 * ignored, so a plain URL keeps the persisted preferences.
 */
export function readUrlPreferences(
  search: string,
): Partial<Pick<PersistedPreferences, "themeMode" | "language">> {
  const params = new URLSearchParams(search);
  const overrides: Partial<Pick<PersistedPreferences, "themeMode" | "language">> = {};
  const theme = params.get("theme");
  if (theme === "light" || theme === "dark") overrides.themeMode = theme;
  const lang = params.get("lang");
  const language = SUPPORTED_LANGUAGES.find((l) => l === lang);
  if (language !== undefined) overrides.language = language;
  return overrides;
}

export interface CreatePreferencesStoreOptions {
  /** `localStorage`-shaped storage, or `null` to run purely in memory. */
  storage?: Storage | null;
  /** `matchMedia("(prefers-color-scheme: dark)").matches`, used only for the very first default. */
  prefersDark?: boolean;
}

/**
 * `createPreferencesStore(options)`: a vanilla Zustand store seeded from
 * `options.storage` (validated field-by-field so one corrupt field never
 * discards the rest) and persisted back to it on every change.
 */
export function createPreferencesStore(
  options?: CreatePreferencesStoreOptions,
): StoreApi<PreferencesState> {
  const storage = options?.storage ?? null;
  const defaultThemeMode: ThemeMode = options?.prefersDark ? "dark" : "light";

  function defaults(): PersistedPreferences {
    return {
      themeMode: defaultThemeMode,
      language: DEFAULT_LANGUAGE,
      gridVisible: true,
      snapEnabled: true,
      dockSizePct: DEFAULT_DOCK_SIZE_PCT,
    };
  }

  const schema = z.object({
    themeMode: z.enum(["light", "dark"]).catch(defaultThemeMode),
    language: z.enum(SUPPORTED_LANGUAGES).catch(DEFAULT_LANGUAGE),
    gridVisible: z.boolean().catch(true),
    snapEnabled: z.boolean().catch(true),
    dockSizePct: z
      .number()
      .min(MIN_DOCK_SIZE_PCT)
      .max(MAX_DOCK_SIZE_PCT)
      .catch(DEFAULT_DOCK_SIZE_PCT),
  });

  function loadPersisted(): PersistedPreferences {
    if (!storage) return defaults();

    let raw: string | null;
    try {
      raw = storage.getItem(PREFERENCES_STORAGE_KEY);
    } catch {
      return defaults();
    }
    if (raw === null) return defaults();

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return defaults();
    }
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return defaults();
    }

    const result = schema.safeParse(parsed);
    if (!result.success) return defaults();

    const dockLayoutVersion = (parsed as Record<string, unknown>).dockLayoutVersion;
    if (dockLayoutVersion !== DOCK_LAYOUT_VERSION) {
      return { ...result.data, dockSizePct: DEFAULT_DOCK_SIZE_PCT };
    }
    return result.data;
  }

  const initial = loadPersisted();

  const store = createStore<PreferencesState>((set, get) => ({
    ...initial,
    setThemeMode(mode) {
      set({ themeMode: mode });
    },
    toggleThemeMode() {
      set({ themeMode: get().themeMode === "light" ? "dark" : "light" });
    },
    setLanguage(language) {
      set({ language });
    },
    setGridVisible(visible) {
      set({ gridVisible: visible });
    },
    setSnapEnabled(enabled) {
      set({ snapEnabled: enabled });
    },
    setDockSizePct(pct) {
      set({ dockSizePct: clampDockSizePct(pct) });
    },
  }));

  if (storage) {
    store.subscribe((state) => {
      const payload: PersistedPayload = {
        themeMode: state.themeMode,
        language: state.language,
        gridVisible: state.gridVisible,
        snapEnabled: state.snapEnabled,
        dockSizePct: state.dockSizePct,
        dockLayoutVersion: DOCK_LAYOUT_VERSION,
      };
      try {
        storage.setItem(PREFERENCES_STORAGE_KEY, JSON.stringify(payload));
      } catch {
        // Best-effort only; storage itself may be the thing failing (quota/private mode).
      }
    });
  }

  return store;
}
