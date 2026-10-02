/**
 * Opaque entity ids for the mechanism document. IDs are plain strings
 * (`${kind}-${uuid}`), never validated as strict UUIDs — see the schema's
 * `IdSchema` (`z.string().min(1)`). Uniqueness and referential integrity are
 * checked at the document level (`schema.ts`'s `checkDocumentIntegrity`).
 */

/** The kinds of entities that get an id in a mechanism document. */
export type EntityKind = "link" | "site" | "joint" | "motor" | "marker" | "load";

/** An opaque entity id. Not guaranteed to be a strict UUID. */
export type Id = string;

/**
 * Builds a v4-format hex string from `crypto.getRandomValues`, setting the
 * version (4) and variant (8, 9, a, or b) nibbles per RFC 4122 section 4.4.
 * Used as a fallback when `crypto.randomUUID` is unavailable (e.g. insecure
 * contexts such as a LAN IP over http).
 */
function randomUuidFallback(): string {
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40; // version 4
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // variant 10xx

  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join("-");
}

/** Creates a new opaque id for the given entity kind, e.g. `"link-<uuid>"`. */
export function createId(kind: EntityKind): Id {
  const cryptoObj = globalThis.crypto;
  const uuid =
    typeof cryptoObj.randomUUID === "function" ? cryptoObj.randomUUID() : randomUuidFallback();
  return `${kind}-${uuid}`;
}
