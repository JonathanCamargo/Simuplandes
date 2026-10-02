/**
 * i18next instance factory. Every namespace under `./locales/<lang>/<ns>.json`
 * is loaded eagerly via `import.meta.glob`, so later plans add a namespace
 * (canvas, inspector, palette, ...) just by dropping a new
 * `locales/{es,en}/<ns>.json` file pair -- they never edit this module.
 * Every key is therefore `"<ns>.<path>"`, e.g. `t("tools.bar.label")`.
 */

import i18next, { type i18n, type Resource } from "i18next";
import { initReactI18next } from "react-i18next";
import type { Language } from "./numberFormat";

export type { Language } from "./numberFormat";
export { SUPPORTED_LANGUAGES } from "./numberFormat";

/** A nested object whose leaves are all strings (a parsed locale namespace file). */
type LocaleTree = { [key: string]: string | LocaleTree };

function isLocaleTree(value: unknown): value is LocaleTree {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  return Object.values(value as Record<string, unknown>).every(
    (v) => typeof v === "string" || isLocaleTree(v),
  );
}

/** Throws unless `value` is a string-leaves-only tree. Exported so the failure path is directly testable. */
export function assertLocaleTree(path: string, value: unknown): asserts value is LocaleTree {
  if (!isLocaleTree(value)) {
    throw new Error(`Invalid locale data in "${path}": every leaf must be a non-empty string`);
  }
}

export interface LocaleResources {
  es: { translation: Record<string, LocaleTree> };
  en: { translation: Record<string, LocaleTree> };
}

const LOCALE_PATH_PATTERN = /\.\/locales\/(es|en)\/([^/]+)\.json$/;

/**
 * Eagerly loads every `./locales/<lang>/<ns>.json` file and assembles the
 * i18next resource bundle `{ es: { translation: { [ns]: json } }, en: {...} }`.
 * Validates every value with a recursive string-leaves-only type guard;
 * throws on malformed locale data instead of silently rendering `undefined`.
 */
export function loadLocaleResources(): LocaleResources {
  const modules = import.meta.glob("./locales/*/*.json", {
    eager: true,
    import: "default",
  });

  const byLang: { es: Record<string, LocaleTree>; en: Record<string, LocaleTree> } = {
    es: {},
    en: {},
  };

  for (const [path, value] of Object.entries(modules)) {
    const match = LOCALE_PATH_PATTERN.exec(path);
    if (!match) continue;
    const lang = match[1] as "es" | "en";
    const ns = match[2];
    assertLocaleTree(path, value);
    byLang[lang][ns] = value;
  }

  return {
    es: { translation: byLang.es },
    en: { translation: byLang.en },
  };
}

/** Recursively collects dotted key paths from a nested string tree, e.g. `"tools.bar.label"`. */
export function collectKeys(obj: Record<string, unknown>, prefix = ""): string[] {
  const keys: string[] = [];
  for (const [key, value] of Object.entries(obj)) {
    const dotted = prefix === "" ? key : `${prefix}.${key}`;
    if (typeof value === "string") {
      keys.push(dotted);
    } else if (typeof value === "object" && value !== null) {
      keys.push(...collectKeys(value as Record<string, unknown>, dotted));
    }
  }
  return keys;
}

/**
 * Creates a fresh, synchronously-initialized i18next instance (no module
 * singleton -- each call is independent, so tests and `main.tsx` each get
 * their own). `initAsync: false` is the i18next v26 option name (verified
 * against the installed typings) that makes `.t()` usable immediately after
 * this call returns, with no need to await the init promise.
 */
export function createI18n(lang: Language): i18n {
  const instance = i18next.createInstance();
  // i18next's `Resource` type requires a bare string index signature; our
  // stricter `LocaleResources` shape (validated leaf-by-leaf in
  // `loadLocaleResources`) is structurally compatible but not nominally
  // assignable without this bridge.
  const resources = loadLocaleResources() as unknown as Resource;
  void instance.use(initReactI18next).init({
    resources,
    lng: lang,
    fallbackLng: "en",
    interpolation: { escapeValue: false },
    returnNull: false,
    initAsync: false,
  });
  return instance;
}
