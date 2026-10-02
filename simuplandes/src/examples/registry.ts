/**
 * The bundled examples (UX-02): five golden GraphThe fixtures, chosen by
 * measured input travel (>= 228 degrees, four of them full rotations), not by
 * name. They go through the same `importGraphthe(..., { anchoredPoses })`
 * path as a user import, so the gallery doubles as a living importer check.
 * Only these five files are bundled (an explicit list, not a glob over all 15).
 */

import { importGraphthe, parseGraphtheText } from "../interchange";
import type { GraphtheExport } from "../interchange";
import type { MechanismDocument } from "../model";

export type ExampleId = "four-bar" | "slider-crank" | "watt" | "stephenson" | "eight-bar";

export interface ExampleEntry {
  readonly id: ExampleId;
  /** Basename of the bundled `fixtures/<fixture>.graphthe.json`. */
  readonly fixture: string;
  readonly titleKey: string;
  readonly descriptionKey: string;
}

function entry(id: ExampleId, fixture: string): ExampleEntry {
  return {
    id,
    fixture,
    titleKey: `gallery.examples.${id}.title`,
    descriptionKey: `gallery.examples.${id}.description`,
  };
}

export const EXAMPLES: readonly ExampleEntry[] = [
  entry("four-bar", "fourbar-crank-rocker"),
  entry("slider-crank", "slider-crank"),
  entry("watt", "watt-i"),
  entry("stephenson", "stephenson-i"),
  entry("eight-bar", "eightbar-T15"),
];

const RAW_BY_PATH = import.meta.glob(
  [
    "../../fixtures/fourbar-crank-rocker.graphthe.json",
    "../../fixtures/slider-crank.graphthe.json",
    "../../fixtures/watt-i.graphthe.json",
    "../../fixtures/stephenson-i.graphthe.json",
    "../../fixtures/eightbar-T15.graphthe.json",
  ],
  { eager: true, query: "?raw", import: "default" },
);

function rawFor(fixture: string): string {
  const text = RAW_BY_PATH[`../../fixtures/${fixture}.graphthe.json`];
  if (typeof text !== "string") throw new Error(`example fixture not bundled: ${fixture}`);
  return text;
}

const envelopeCache = new Map<ExampleId, GraphtheExport>();

/** A fresh document (new ids on every call) for the example; throws on an unknown id. */
export function loadExampleDocument(id: string): MechanismDocument {
  const found = EXAMPLES.find((example) => example.id === id);
  if (!found) throw new Error(`unknown example: ${id}`);
  let envelope = envelopeCache.get(found.id);
  if (!envelope) {
    envelope = parseGraphtheText(rawFor(found.fixture));
    envelopeCache.set(found.id, envelope);
  }
  return importGraphthe(envelope, { anchoredPoses: true });
}
