import { describe, it, expect } from "vitest";
import {
  createPreferencesStore,
  PREFERENCES_STORAGE_KEY,
  MIN_DOCK_SIZE_PCT,
  MAX_DOCK_SIZE_PCT,
  DEFAULT_DOCK_SIZE_PCT,
  DOCK_LAYOUT_VERSION,
  readUrlPreferences,
} from "./preferences";
import { createMemoryStorage } from "../persistence/memoryStorage";
import { createMechanismStore, buildExampleFourBar } from "../store";

describe("createPreferencesStore defaults", () => {
  it("defaults to light theme, es, grid+snap on, and a 26% dock", () => {
    const store = createPreferencesStore({ storage: null });
    expect(store.getState()).toMatchObject({
      themeMode: "light",
      language: "es",
      gridVisible: true,
      snapEnabled: true,
      dockSizePct: 26,
    });
  });

  it("defaults to dark theme when prefersDark is true", () => {
    const store = createPreferencesStore({ storage: null, prefersDark: true });
    expect(store.getState().themeMode).toBe("dark");
  });

  it("works entirely in memory when storage is null", () => {
    const store = createPreferencesStore({ storage: null });
    store.getState().setThemeMode("dark");
    expect(store.getState().themeMode).toBe("dark");
  });
});

describe("createPreferencesStore persistence", () => {
  it("writes simuplandes:ui-prefs on every change, and a fresh store restores it", () => {
    const storage = createMemoryStorage();
    const store = createPreferencesStore({ storage });

    store.getState().setThemeMode("dark");
    store.getState().setLanguage("en");
    store.getState().setGridVisible(false);
    store.getState().setSnapEnabled(false);
    store.getState().setDockSizePct(40);

    const raw = storage.getItem(PREFERENCES_STORAGE_KEY);
    expect(raw).not.toBeNull();

    const restored = createPreferencesStore({ storage });
    expect(restored.getState()).toMatchObject({
      themeMode: "dark",
      language: "en",
      gridVisible: false,
      snapEnabled: false,
      dockSizePct: 40,
    });
  });

  it("clamps setDockSizePct to [15, 50]", () => {
    const store = createPreferencesStore({ storage: null });
    store.getState().setDockSizePct(5);
    expect(store.getState().dockSizePct).toBe(15);
    store.getState().setDockSizePct(90);
    expect(store.getState().dockSizePct).toBe(50);
  });

  it("toggleThemeMode flips between light and dark", () => {
    const store = createPreferencesStore({ storage: null });
    expect(store.getState().themeMode).toBe("light");
    store.getState().toggleThemeMode();
    expect(store.getState().themeMode).toBe("dark");
    store.getState().toggleThemeMode();
    expect(store.getState().themeMode).toBe("light");
  });
});

describe("createPreferencesStore corrupt/invalid storage", () => {
  it("falls back to defaults on corrupt JSON, without throwing", () => {
    const storage = createMemoryStorage({ [PREFERENCES_STORAGE_KEY]: "{not json" });
    expect(() => createPreferencesStore({ storage })).not.toThrow();
    const store = createPreferencesStore({ storage });
    expect(store.getState().themeMode).toBe("light");
  });

  it("falls back to defaults on a wrong-shape payload (an array)", () => {
    const storage = createMemoryStorage({ [PREFERENCES_STORAGE_KEY]: "[1,2,3]" });
    const store = createPreferencesStore({ storage });
    expect(store.getState()).toMatchObject({ themeMode: "light", language: "es" });
  });

  it("falls back to defaults on a wrong-shape payload (a string)", () => {
    const storage = createMemoryStorage({ [PREFERENCES_STORAGE_KEY]: '"hello"' });
    const store = createPreferencesStore({ storage });
    expect(store.getState()).toMatchObject({ themeMode: "light", language: "es" });
  });

  it("substitutes only the bad field for an unknown language, keeping the rest", () => {
    const storage = createMemoryStorage({
      [PREFERENCES_STORAGE_KEY]: JSON.stringify({
        themeMode: "dark",
        language: "fr",
        gridVisible: false,
        snapEnabled: false,
        dockSizePct: 33,
        dockLayoutVersion: DOCK_LAYOUT_VERSION,
      }),
    });
    const store = createPreferencesStore({ storage });
    expect(store.getState()).toMatchObject({
      themeMode: "dark",
      language: "es",
      gridVisible: false,
      snapEnabled: false,
      dockSizePct: 33,
    });
  });

  it("substitutes only an out-of-range dockSizePct, keeping the rest", () => {
    const storage = createMemoryStorage({
      [PREFERENCES_STORAGE_KEY]: JSON.stringify({
        themeMode: "dark",
        language: "en",
        gridVisible: true,
        snapEnabled: true,
        dockSizePct: 9999,
      }),
    });
    const store = createPreferencesStore({ storage });
    expect(store.getState()).toMatchObject({
      themeMode: "dark",
      language: "en",
      dockSizePct: 26,
    });
  });

  it("does not throw when storage.getItem/setItem throws (quota/private mode)", () => {
    const throwingStorage: Storage = {
      length: 0,
      key: () => null,
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => {
        throw new Error("denied");
      },
      removeItem: () => undefined,
      clear: () => undefined,
    };
    expect(() => {
      const store = createPreferencesStore({ storage: throwingStorage });
      store.getState().setThemeMode("dark");
    }).not.toThrow();
  });
});

describe("createPreferencesStore dock layout version migration", () => {
  it("migrates a pre-fix payload (dockSizePct 15, no dockLayoutVersion) to the default dock size, keeping other fields", () => {
    const storage = createMemoryStorage({
      [PREFERENCES_STORAGE_KEY]: JSON.stringify({
        themeMode: "dark",
        language: "en",
        gridVisible: true,
        snapEnabled: true,
        dockSizePct: 15,
      }),
    });
    const store = createPreferencesStore({ storage });
    expect(store.getState()).toMatchObject({
      themeMode: "dark",
      language: "en",
      gridVisible: true,
      snapEnabled: true,
      dockSizePct: DEFAULT_DOCK_SIZE_PCT,
    });
  });

  it("keeps a real post-fix choice when dockLayoutVersion matches (33)", () => {
    const storage = createMemoryStorage({
      [PREFERENCES_STORAGE_KEY]: JSON.stringify({
        themeMode: "light",
        language: "es",
        gridVisible: true,
        snapEnabled: true,
        dockSizePct: 33,
        dockLayoutVersion: DOCK_LAYOUT_VERSION,
      }),
    });
    const store = createPreferencesStore({ storage });
    expect(store.getState().dockSizePct).toBe(33);
  });

  it("keeps 15 as a legal post-fix choice when dockLayoutVersion matches", () => {
    const storage = createMemoryStorage({
      [PREFERENCES_STORAGE_KEY]: JSON.stringify({
        themeMode: "light",
        language: "es",
        gridVisible: true,
        snapEnabled: true,
        dockSizePct: 15,
        dockLayoutVersion: DOCK_LAYOUT_VERSION,
      }),
    });
    const store = createPreferencesStore({ storage });
    expect(store.getState().dockSizePct).toBe(15);
  });

  it("resets dockSizePct on any other dockLayoutVersion (1, or a non-numeric value), keeping other fields", () => {
    const storageV1 = createMemoryStorage({
      [PREFERENCES_STORAGE_KEY]: JSON.stringify({
        themeMode: "dark",
        language: "en",
        gridVisible: false,
        snapEnabled: false,
        dockSizePct: 40,
        dockLayoutVersion: 1,
      }),
    });
    const storeV1 = createPreferencesStore({ storage: storageV1 });
    expect(storeV1.getState()).toMatchObject({
      themeMode: "dark",
      language: "en",
      gridVisible: false,
      snapEnabled: false,
      dockSizePct: DEFAULT_DOCK_SIZE_PCT,
    });

    const storageX = createMemoryStorage({
      [PREFERENCES_STORAGE_KEY]: JSON.stringify({
        themeMode: "light",
        language: "es",
        gridVisible: true,
        snapEnabled: true,
        dockSizePct: 40,
        dockLayoutVersion: "x",
      }),
    });
    const storeX = createPreferencesStore({ storage: storageX });
    expect(storeX.getState().dockSizePct).toBe(DEFAULT_DOCK_SIZE_PCT);
  });

  it("every write to storage includes dockLayoutVersion: DOCK_LAYOUT_VERSION", () => {
    const storage = createMemoryStorage();
    const store = createPreferencesStore({ storage });
    store.getState().setDockSizePct(35);

    const raw = storage.getItem(PREFERENCES_STORAGE_KEY);
    expect(raw).not.toBeNull();
    const parsed = JSON.parse(raw as string) as { dockLayoutVersion: number };
    expect(parsed.dockLayoutVersion).toBe(DOCK_LAYOUT_VERSION);
  });

  it("exports the dock size bounds and default", () => {
    expect(MIN_DOCK_SIZE_PCT).toBe(15);
    expect(MAX_DOCK_SIZE_PCT).toBe(50);
    expect(DEFAULT_DOCK_SIZE_PCT).toBe(26);
  });
});

describe("preferences never touch the mechanism store", () => {
  it("a document edit then a theme toggle leaves canUndo/history labels unchanged", () => {
    const mechanism = createMechanismStore();
    buildExampleFourBar(mechanism);
    const undoLabelBefore = mechanism.getState().undoLabel;
    const canUndoBefore = mechanism.getState().canUndo;

    const preferences = createPreferencesStore({ storage: null });
    preferences.getState().toggleThemeMode();

    expect(mechanism.getState().canUndo).toBe(canUndoBefore);
    expect(mechanism.getState().undoLabel).toBe(undoLabelBefore);
  });
});

describe("readUrlPreferences", () => {
  it("reads ?theme and ?lang from a linking page", () => {
    expect(readUrlPreferences("?theme=dark&lang=en")).toEqual({
      themeMode: "dark",
      language: "en",
    });
  });

  it("ignores missing and unknown values", () => {
    expect(readUrlPreferences("")).toEqual({});
    expect(readUrlPreferences("?theme=blue&lang=fr")).toEqual({});
    expect(readUrlPreferences("?lang=es")).toEqual({ language: "es" });
  });
});
