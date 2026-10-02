/**
 * Locale-aware number parsing/formatting for the Studio UI (pure, no
 * React/i18next dependency). `Language`/`SUPPORTED_LANGUAGES` are defined
 * here and re-exported from `i18n.ts`.
 */

export type Language = "es" | "en";
export const SUPPORTED_LANGUAGES = ["es", "en"] as const;

const NUMBER_PATTERN = /^(-?)(\d+)(?:[.,](\d+))?$/;

/**
 * Parses a user-typed number that may use `.` or `,` as its single decimal
 * separator. Returns `null` for empty or invalid input. Unlike
 * `parseFloat`/`Number`, malformed input such as `"1.2.3"` is rejected
 * rather than lenient-prefix-parsed.
 */
export function parseNumberInput(text: string): number | null {
  const trimmed = text.trim();
  if (trimmed === "") return null;

  const match = NUMBER_PATTERN.exec(trimmed);
  if (!match) return null;

  const [, sign, intPart, fracPart] = match;
  const normalized = `${sign}${intPart}${fracPart !== undefined ? `.${fracPart}` : ""}`;
  const value = Number(normalized);
  return Number.isFinite(value) ? value : null;
}

/**
 * Formats `value` with `fractionDigits` decimals using the locale's decimal
 * separator (`,` for `es-ES`, `.` for `en-US`) and no thousands grouping.
 * Rounds before formatting so a value that rounds to zero never renders as
 * `"-0"`/`"-0,0"`.
 */
export function formatNumber(value: number, lang: Language, fractionDigits: number): string {
  const factor = 10 ** fractionDigits;
  const rounded = Math.round(value * factor) / factor;
  const normalized = Object.is(rounded, -0) ? 0 : rounded;

  const formatter = new Intl.NumberFormat(lang === "es" ? "es-ES" : "en-US", {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
    useGrouping: false,
  });
  return formatter.format(normalized);
}
