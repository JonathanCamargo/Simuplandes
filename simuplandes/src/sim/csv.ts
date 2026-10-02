/**
 * RFC 4180 CSV export for a `MeasurementTable` (SIM-05). CSV is a
 * data-interchange format, not UI text: this module ALWAYS emits `.`
 * decimals and `,` field separators, RFC 4180 quoting, and units in the
 * header, with invariant English quantity tokens -- regardless of the
 * active UI language (research Pitfall 4). Header ENTITY labels are still
 * the user's own link/marker names (only the number formatting and
 * structural tokens are invariant). Never uses
 * `src/i18n/numberFormat.ts`'s locale-aware `formatNumber` or
 * `toLocaleString` -- an es-locale `,` decimal inside a `,`-delimited file
 * would silently corrupt every downstream field count.
 */

import type { MeasurementTable, QuantityDef, QuantityUnit } from "./plots";

/** A unit any header cell in this module needs to render: a quantity unit, or a table's own x-axis unit. */
export type CsvUnit = QuantityUnit | MeasurementTable["xUnit"];

/**
 * Formats a number for CSV: 12 significant digits, `.` decimal, JS's
 * exponential notation for very small magnitudes (parseable by `Number`,
 * Python's `float()` and pandas alike). Non-finite values (`NaN`,
 * `+/-Infinity`) become the empty string (no cell value).
 */
export function formatCsvNumber(value: number): string {
  if (!Number.isFinite(value)) return "";
  return String(Number(value.toPrecision(12)));
}

/**
 * Quotes a CSV field per RFC 4180 only when needed: a comma, double quote,
 * or newline forces quoting, with embedded double quotes doubled. A plain
 * value is returned unchanged.
 */
export function escapeCsvField(field: string): string {
  if (/[",\r\n]/.test(field)) {
    return `"${field.replace(/"/g, '""')}"`;
  }
  return field;
}

/** The invariant, English unit label for a quantity or x-axis unit, with the document's length unit substituted for every `len*` unit. `"deg"`/`"deg/s"`/`"deg/s^2"`/`"s"` are already their own label. */
export function unitLabel(unit: CsvUnit, lengthUnit: "mm" | "m"): string {
  if (unit === "len") return lengthUnit;
  if (unit === "len/s") return `${lengthUnit}/s`;
  if (unit === "len/s^2") return `${lengthUnit}/s^2`;
  return unit;
}

/** Options for `tableToCsv`: the input axis's display label, and the document's length unit (for `len*` unit headers). */
export interface TableToCsvOptions {
  readonly inputLabel: string;
  readonly lengthUnit: "mm" | "m";
}

/**
 * Serializes `table` to an RFC 4180 CSV string: one header row (`input
 * <inputLabel> [<unit>]` or `time [s]`, then `<entityLabel>.<token>
 * [<unit>]` per requested quantity id, all header cells escaped), then one
 * data row per sample, CRLF-terminated (including after the last row).
 * `quantityIds` not present in `table.quantities` are silently skipped.
 */
export function tableToCsv(
  table: MeasurementTable,
  quantityIds: readonly string[],
  opts: TableToCsvOptions,
): string {
  const xUnitLabel = unitLabel(table.xUnit, opts.lengthUnit);
  const xHeader =
    table.xKind === "input" ? `input ${opts.inputLabel} [${xUnitLabel}]` : `time [${xUnitLabel}]`;

  const selected: { readonly quantity: QuantityDef; readonly column: Float64Array }[] = [];
  for (const id of quantityIds) {
    const index = table.quantities.findIndex((q) => q.id === id);
    if (index === -1) continue; // unknown id: silently skipped
    selected.push({ quantity: table.quantities[index], column: table.columns[index] });
  }

  const headerCells = [
    xHeader,
    ...selected.map(
      ({ quantity }) =>
        `${quantity.entityLabel}.${quantity.token} [${unitLabel(quantity.unit, opts.lengthUnit)}]`,
    ),
  ];

  let out = headerCells.map(escapeCsvField).join(",") + "\r\n";

  for (let i = 0; i < table.length; i++) {
    const cells = [
      formatCsvNumber(table.x[i]),
      ...selected.map(({ column }) => formatCsvNumber(column[i])),
    ];
    out += cells.join(",") + "\r\n";
  }

  return out;
}

/** Lowercases, replaces every run of non `[a-z0-9]` with a single hyphen, and trims leading/trailing hyphens; `"mechanism"` if the result is empty. */
function slugify(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug.length > 0 ? slug : "mechanism";
}

/** The downloaded CSV file's name: `simuplandes-<slugified-doc-name>-vs-<xKind>.csv`. */
export function csvFileName(docName: string, xKind: "input" | "time"): string {
  return `simuplandes-${slugify(docName)}-vs-${xKind}.csv`;
}
