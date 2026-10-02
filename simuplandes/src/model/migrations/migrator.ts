/**
 * `createMigrator`: builds a `(raw: unknown) => T` function that runs
 * registered `vN -> vN+1` steps in order and validates the result against a
 * Zod schema. Generic over `T` so it can be proven with a small fake
 * multi-version chain in tests before it is ever used on the real document
 * schema (see `./index.ts`).
 */

import type { z } from "zod";
import { DocumentLoadError, issuesFromZod } from "./errors";

/** A `vN -> vN+1` step: takes a draft-shaped object at version `v` and returns one claiming version `v + 1`. */
export type MigrationStep = (doc: Record<string, unknown> & { schemaVersion: number }) => unknown;

export interface MigratorConfig<T> {
  /** The current (highest) schema version. */
  currentVersion: number;
  /** Migration steps keyed by the version they migrate FROM. */
  steps: Readonly<Record<number, MigrationStep>>;
  /** Validates (and fills defaults into) the fully-migrated document. */
  schema: z.ZodType<T>;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readSchemaVersion(value: Record<string, unknown>): number | null {
  const v = value["schemaVersion"];
  return typeof v === "number" && Number.isInteger(v) ? v : null;
}

/**
 * Builds a `(raw: unknown) => T` migrator. Algorithm:
 * 1. A non-object, an array, or `null` -> "not-a-document". A missing,
 *    non-number or non-integer `schemaVersion` -> "not-a-document".
 * 2. `schemaVersion` above `currentVersion` -> "newer-version". Below 1 ->
 *    "no-migration".
 * 3. While below `currentVersion`: look up `steps[v]`. Missing -> throw
 *    "no-migration". Run it; if the result isn't an object whose
 *    `schemaVersion` is exactly `v + 1` (guards against an infinite loop or
 *    a gap in the chain) -> "no-migration". Any exception thrown by a step
 *    is wrapped as "no-migration" with the step's message.
 * 4. `schema.safeParse(result)`; on failure -> "invalid" with `issuesFromZod`.
 */
export function createMigrator<T>(config: MigratorConfig<T>): (raw: unknown) => T {
  const { currentVersion, steps, schema } = config;

  return function migrate(raw: unknown): T {
    if (!isPlainObject(raw)) {
      throw new DocumentLoadError(
        "not-a-document",
        [],
        "not a Simuplandes document (missing schemaVersion)",
      );
    }
    const version = readSchemaVersion(raw);
    if (version === null) {
      throw new DocumentLoadError(
        "not-a-document",
        [],
        "not a Simuplandes document (missing schemaVersion)",
      );
    }
    if (version > currentVersion) {
      throw new DocumentLoadError(
        "newer-version",
        [],
        `file is from a newer version (v${version}); this app supports up to v${currentVersion}`,
      );
    }
    if (version < 1) {
      throw new DocumentLoadError("no-migration", [], `no migration path from v${version}`);
    }

    let doc: Record<string, unknown> & { schemaVersion: number } = raw as Record<
      string,
      unknown
    > & {
      schemaVersion: number;
    };
    let v = version;
    while (v < currentVersion) {
      const step = steps[v];
      if (!step) {
        throw new DocumentLoadError("no-migration", [], `no migration path from v${v}`);
      }
      let stepResult: unknown;
      try {
        stepResult = step(doc);
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        throw new DocumentLoadError(
          "no-migration",
          [],
          `migration step from v${v} failed: ${message}`,
        );
      }
      if (!isPlainObject(stepResult) || readSchemaVersion(stepResult) !== v + 1) {
        throw new DocumentLoadError(
          "no-migration",
          [],
          `migration step from v${v} did not advance schemaVersion by exactly 1`,
        );
      }
      doc = stepResult as Record<string, unknown> & { schemaVersion: number };
      v += 1;
    }

    const result = schema.safeParse(doc);
    if (!result.success) {
      throw new DocumentLoadError(
        "invalid",
        issuesFromZod(result.error),
        "Invalid mechanism document",
      );
    }
    return result.data;
  };
}
