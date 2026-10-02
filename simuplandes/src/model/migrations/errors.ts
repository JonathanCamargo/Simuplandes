/**
 * `DocumentLoadError`: the one error type every mechanism-document load path
 * (localStorage restore, `.simup.json` open) can throw. Each failure mode
 * maps to a specific `reason`, with structured `issues` for schema failures
 * and a readable `message` the UI can show verbatim.
 */

import type { z } from "zod";

export type DocumentLoadErrorReason =
  "invalid-json" | "not-a-document" | "newer-version" | "no-migration" | "invalid";

/** One addressable problem with a document: a dotted path ("(root)" when empty) and a human-readable message. */
export interface DocumentIssue {
  path: string;
  message: string;
}

/** Converts a Zod error's issues into `DocumentIssue[]`, joining each issue's path with "." ("(root)" when empty). */
export function issuesFromZod(error: z.ZodError): DocumentIssue[] {
  return error.issues.map((issue) => ({
    path: issue.path.length > 0 ? issue.path.map(String).join(".") : "(root)",
    message: issue.message,
  }));
}

function formatMessage(summary: string, issues: readonly DocumentIssue[]): string {
  if (issues.length === 0) return summary;
  const shown = issues.slice(0, 5).map((issue) => `${issue.path}: ${issue.message}`);
  const more = issues.length > 5 ? ` (+${issues.length - 5} more)` : "";
  return `${summary}: ${shown.join("; ")}${more}`;
}

/**
 * Thrown by every load entry point (`migrateDocument`, `parseDocumentJson`)
 * on any failure. `message` is `summary` plus up to the first 5 `issues` as
 * "path: message", joined by "; ", plus "(+N more)" when there are more —
 * the UI shows this message verbatim.
 */
export class DocumentLoadError extends Error {
  override name = "DocumentLoadError";

  constructor(
    readonly reason: DocumentLoadErrorReason,
    readonly issues: readonly DocumentIssue[],
    summary: string,
  ) {
    super(formatMessage(summary, issues));
  }
}
