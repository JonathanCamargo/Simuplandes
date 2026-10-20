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
 * FROM. When the schema next changes:
 *   1. Bump `CURRENT_SCHEMA_VERSION` in `../schema.ts`.
 *   2. Add a step here, e.g. `2: (d) => ({ ...d, schemaVersion: 3, ... })`.
 *   3. Add a fixture test proving an old-shaped document migrates correctly.
 */
export const MIGRATIONS: Readonly<Record<number, MigrationStep>> = {
  // v2 adds dynamics: link mass properties (optional), motor `dynamics`
  // (defaults to "motion"), `springs` and document `dynamics` settings. A v1
  // document has none of them, so the schema defaults fill them in.
  1: (d) => ({ ...d, schemaVersion: 2 }),
};

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
