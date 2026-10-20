/**
 * The bundled examples (UX-02): five golden GraphThe fixtures, chosen by
 * measured input travel (>= 228 degrees, four of them full rotations), not by
 * name. They go through the same `importGraphthe(..., { anchoredPoses })`
 * path as a user import, so the gallery doubles as a living importer check.
 * Only these five files are bundled (an explicit list, not a glob over all 15).
 *
 * Two more examples are made for Dynamics analysis and built in code
 * (`dynamicsExamples.ts`): they have masses, springs and gravity, which
 * GraphThe fixtures do not carry.
 */

import { importGraphthe, parseGraphtheText } from "../interchange";
import type { GraphtheExport } from "../interchange";
import type { MechanismDocument } from "../model";
import { buildDoublePendulum, buildMassSpring } from "./dynamicsExamples";

export type ExampleId =
  | "four-bar"
  | "slider-crank"
  | "watt"
  | "stephenson"
  | "eight-bar"
  | "double-pendulum"
  | "mass-spring";

export interface ExampleEntry {
  readonly id: ExampleId;
  /** Basename of the bundled `fixtures/<fixture>.graphthe.json`, or `null` for a built-in dynamics example. */
  readonly fixture: string | null;
  readonly titleKey: string;
  readonly descriptionKey: string;
  /** The analysis the example is made for. */
  readonly analysis: "kinematics" | "dynamics";
}

function entry(
  id: ExampleId,
  fixture: string | null,
  analysis: ExampleEntry["analysis"] = "kinematics",
): ExampleEntry {
  return {
    id,
    fixture,
    titleKey: `gallery.examples.${id}.title`,
    descriptionKey: `gallery.examples.${id}.description`,
    analysis,
  };
}

export const EXAMPLES: readonly ExampleEntry[] = [
  entry("four-bar", "fourbar-crank-rocker"),
  entry("slider-crank", "slider-crank"),
  entry("watt", "watt-i"),
  entry("stephenson", "stephenson-i"),
  entry("eight-bar", "eightbar-T15"),
  entry("double-pendulum", null, "dynamics"),
  entry("mass-spring", null, "dynamics"),
];

const BUILT_IN: Partial<Record<ExampleId, () => MechanismDocument>> = {
  "double-pendulum": buildDoublePendulum,
  "mass-spring": buildMassSpring,
};

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
  if (found.fixture === null) return BUILT_IN[found.id]!();
  let envelope = envelopeCache.get(found.id);
  if (!envelope) {
    envelope = parseGraphtheText(rawFor(found.fixture));
    envelopeCache.set(found.id, envelope);
  }
  return importGraphthe(envelope, { anchoredPoses: true });
}
