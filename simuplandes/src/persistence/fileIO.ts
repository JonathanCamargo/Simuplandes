/**
 * `.simup.json` Save/Open via `browser-fs-access`, which picks the native
 * File System Access API when available and falls back to a download/
 * `<input type=file>` otherwise (Firefox, Safari, mobile). Every opened
 * file goes through `parseDocumentJson` — the one load entry point (MDL-04).
 */

import { fileOpen, fileSave } from "browser-fs-access";
import { parseDocumentJson, serializeDocument, type MechanismDocument } from "../model";

/** The on-disk suffix for a Simuplandes mechanism document. */
export const FILE_SUFFIX = ".simup.json";

/** The on-disk suffix for a Phase 8 GraphThe Mechanism JSON export (XCH-01). */
const GRAPHTHE_FILE_SUFFIX = ".graphthe.json";

function pickerOptions(): {
  extensions: string[];
  mimeTypes: string[];
  description: string;
  id: string;
} {
  return {
    extensions: [".json"],
    mimeTypes: ["application/json"],
    description: "Simuplandes mechanism (.simup.json)",
    id: "simuplandes-document",
  };
}

/** The shared slug rule (`toLowerCase`, `[^a-z0-9]+` -> `-`, trim) every `<slug>.<suffix>` file name is built from. */
export function slugifyName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Slugifies `doc.name` into a `<slug>.simup.json` file name ("mechanism.simup.json" when the name is empty). */
export function suggestFileName(doc: Pick<MechanismDocument, "name">): string {
  const slug = slugifyName(doc.name);
  return `${slug === "" ? "mechanism" : slug}${FILE_SUFFIX}`;
}

/** Slugifies `doc.name` into a `<slug>.graphthe.json` file name ("mechanism.graphthe.json" when the name is empty). Same slug rule as `<slug>.simup.json` (XCH-01's file name decision). */
export function graphtheFileName(doc: Pick<MechanismDocument, "name">): string {
  const slug = slugifyName(doc.name);
  return `${slug === "" ? "mechanism" : slug}${GRAPHTHE_FILE_SUFFIX}`;
}

/** True for a `DOMException`/`Error` named "AbortError" — a user-cancelled picker. */
export function isAbortError(e: unknown): boolean {
  return (e instanceof DOMException || e instanceof Error) && e.name === "AbortError";
}

export type SaveResult =
  { kind: "saved"; fileName: string; handle: FileSystemFileHandle | null } | { kind: "cancelled" };

/**
 * Saves `doc` as pretty-JSON `.simup.json`. Pass `options.handle` (from a
 * previous save/open) for a plain "Save"; omit it for "Save as…". A
 * cancelled picker resolves `{kind:"cancelled"}` rather than throwing.
 */
export async function saveDocumentToFile(
  doc: MechanismDocument,
  options?: { handle?: FileSystemFileHandle | null; fileName?: string },
): Promise<SaveResult> {
  const fileName = options?.fileName ?? suggestFileName(doc);
  const blob = new Blob([serializeDocument(doc)], { type: "application/json" });
  try {
    const handle = await fileSave(blob, { ...pickerOptions(), fileName }, options?.handle ?? null);
    return { kind: "saved", fileName, handle };
  } catch (e) {
    if (isAbortError(e)) return { kind: "cancelled" };
    throw e;
  }
}

export type OpenResult =
  | {
      kind: "opened";
      document: MechanismDocument;
      fileName: string;
      handle: FileSystemFileHandle | null;
    }
  | { kind: "cancelled" };

/**
 * Opens a `.simup.json` file and parses it via `parseDocumentJson`. Throws
 * `DocumentLoadError` on malformed/unsupported content; a cancelled picker
 * resolves `{kind:"cancelled"}`.
 */
export async function openDocumentFromFile(): Promise<OpenResult> {
  let file;
  try {
    file = await fileOpen(pickerOptions());
  } catch (e) {
    if (isAbortError(e)) return { kind: "cancelled" };
    throw e;
  }
  const text = await file.text();
  const document = parseDocumentJson(text);
  return { kind: "opened", document, fileName: file.name, handle: file.handle ?? null };
}

export type OpenTextResult =
  | {
      kind: "opened";
      text: string;
      fileName: string;
      handle: FileSystemFileHandle | null;
    }
  | { kind: "cancelled" };

/**
 * Opens any JSON-ish file and returns its raw text plus the file handle (for
 * a later overwrite-Save). The caller decides how to interpret the text
 * (see `sniffDocumentText`). A cancelled picker resolves `{kind:"cancelled"}`.
 */
export async function openTextFromFile(): Promise<OpenTextResult> {
  let file;
  try {
    file = await fileOpen({
      extensions: [".json"],
      mimeTypes: ["application/json"],
      description: "Simuplandes / GraphThe graph (.simup.json, .graphthe.json, .gtm.json, .json)",
      id: "simuplandes-document",
    });
  } catch (e) {
    if (isAbortError(e)) return { kind: "cancelled" };
    throw e;
  }
  const text = await file.text();
  return { kind: "opened", text, fileName: file.name, handle: file.handle ?? null };
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * Classifies an opened file's text: a Simuplandes `MechanismDocument` (links +
 * joints + `schemaVersion`/`version`), a graph for the import pipeline
 * (GraphThe export/fixture envelope, or node-link with nodes + edges/links),
 * or `"unknown"` (unparseable or anything else).
 */
export function sniffDocumentText(text: string): "simuplandes" | "graph" | "unknown" {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return "unknown";
  }
  if (!isRecord(data)) return "unknown";
  if (
    Array.isArray(data.links) &&
    Array.isArray(data.joints) &&
    (data.schemaVersion !== undefined || data.version !== undefined)
  ) {
    return "simuplandes";
  }
  if (
    data.format === "simuplandes-graphthe-export" ||
    data.format === "simuplandes-parity-fixture"
  ) {
    return "graph";
  }
  if (Array.isArray(data.nodes) && (Array.isArray(data.edges) || Array.isArray(data.links))) {
    return "graph";
  }
  return "unknown";
}

/**
 * Saves an arbitrary `blob` (a `.graphthe.json`/image export, XCH-01/XCH-09)
 * via `browser-fs-access`'s `fileSave`, returning the same `SaveResult`
 * union `saveDocumentToFile` does (`{kind:"cancelled"}` on an aborted
 * picker, never a throw for that one case).
 */
export async function saveBlobToFile(
  blob: Blob,
  fileName: string,
  options: { description: string; mimeTypes: string[]; extensions: string[] },
): Promise<SaveResult> {
  try {
    const handle = await fileSave(blob, { ...options, fileName, id: "simuplandes-export" }, null);
    return { kind: "saved", fileName, handle };
  } catch (e) {
    if (isAbortError(e)) return { kind: "cancelled" };
    throw e;
  }
}
