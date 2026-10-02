/**
 * The single load entry point for a mechanism document (MDL-04): every load
 * path (file open, localStorage restore) goes through `migrateDocument` or
 * `parseDocumentJson`, and nothing else is ever thrown from here but
 * `DocumentLoadError`.
 */

import { CURRENT_SCHEMA_VERSION, MechanismDocumentSchema, type MechanismDocument } from "../schema";
import { DocumentLoadError } from "./errors";
import { createMigrator, type MigrationStep } from "./migrator";

/**
 * Registered `vN -> vN+1` migration steps, keyed by the version they migrate
 * FROM. Empty today: `CURRENT_SCHEMA_VERSION` is 1 and there is no prior
 * `.simup.json` format to migrate from (v0.1 never had save/load — see
 * 02-RESEARCH.md Pitfall 1). When the schema next changes:
 *   1. Bump `CURRENT_SCHEMA_VERSION` in `../schema.ts` and its `schemaVersion`
 *      literal.
 *   2. Add a step here, e.g. `1: (d) => ({ ...d, schemaVersion: 2, ... })`.
 *   3. Add a fixture test proving an old-shaped document migrates correctly.
 */
export const MIGRATIONS: Readonly<Record<number, MigrationStep>> = {};

/** Validates and migrates a raw, untrusted value into a `MechanismDocument`. The one function every load path calls. */
export const migrateDocument = createMigrator<MechanismDocument>({
  currentVersion: CURRENT_SCHEMA_VERSION,
  steps: MIGRATIONS,
  schema: MechanismDocumentSchema,
});

/** Parses JSON text into a `MechanismDocument` via `migrateDocument`. The only other load entry point. */
export function parseDocumentJson(text: string): MechanismDocument {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new DocumentLoadError("invalid-json", [], "not valid JSON");
  }
  return migrateDocument(raw);
}

export * from "./errors";
export * from "./migrator";
