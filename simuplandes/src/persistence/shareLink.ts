/**
 * Share links: a whole mechanism document packed into the URL fragment
 * (`#m=<data>`), so a link opens the same mechanism on any machine with no
 * server involved. The document is compact JSON, deflate-compressed with the
 * platform's `CompressionStream`, then base64url-encoded. The fragment never
 * reaches a server, and every decoded document goes through
 * `parseDocumentJson`, the same validating load path as Open (MDL-04).
 */

import { parseDocumentJson, type MechanismDocument } from "../model";

/** The fragment key that marks a shared mechanism: `#m=<data>`. */
export const SHARE_HASH_PREFIX = "#m=";

async function pipe(
  bytes: Uint8Array<ArrayBuffer>,
  stream: CompressionStream | DecompressionStream,
): Promise<Uint8Array<ArrayBuffer>> {
  const output = new Blob([bytes]).stream().pipeThrough(stream);
  return new Uint8Array(await new Response(output).arrayBuffer());
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(text: string): Uint8Array<ArrayBuffer> {
  const base64 = text.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(base64 + "=".repeat((4 - (base64.length % 4)) % 4));
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}

/** Packs `doc` into the fragment form `#m=<data>`. */
export async function encodeShareHash(doc: MechanismDocument): Promise<string> {
  const json = new TextEncoder().encode(JSON.stringify(doc));
  const packed = await pipe(json, new CompressionStream("deflate-raw"));
  return SHARE_HASH_PREFIX + toBase64Url(packed);
}

/** `true` when `hash` (e.g. `location.hash`) carries a shared mechanism. */
export function isShareHash(hash: string): boolean {
  return hash.startsWith(SHARE_HASH_PREFIX) && hash.length > SHARE_HASH_PREFIX.length;
}

/**
 * Unpacks a `#m=<data>` fragment into a validated document. Throws
 * (`DocumentLoadError` or a decoding error) when the link is damaged.
 */
export async function decodeShareHash(hash: string): Promise<MechanismDocument> {
  if (!isShareHash(hash)) throw new Error("Not a Simuplandes share link");
  const packed = fromBase64Url(hash.slice(SHARE_HASH_PREFIX.length));
  const json = await pipe(packed, new DecompressionStream("deflate-raw"));
  return parseDocumentJson(new TextDecoder().decode(json));
}

/** The full share URL for `doc`, based on `location` (its fragment is replaced). */
export async function buildShareUrl(
  doc: MechanismDocument,
  location: Pick<Location, "origin" | "pathname" | "search">,
): Promise<string> {
  return `${location.origin}${location.pathname}${location.search}${await encodeShareHash(doc)}`;
}
