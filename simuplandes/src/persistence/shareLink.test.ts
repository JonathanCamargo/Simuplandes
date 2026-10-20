import { describe, it, expect } from "vitest";
import {
  buildShareUrl,
  decodeShareHash,
  encodeShareHash,
  isShareHash,
  SHARE_HASH_PREFIX,
} from "./shareLink";
import { createEmptyDocument, MechanismDocumentSchema } from "../model";
import { fourBarFixture, fourBarFixtureParsed } from "../model/__fixtures__/fourBar";

describe("share links", () => {
  it("round-trips a document through the fragment unchanged", async () => {
    const hash = await encodeShareHash(fourBarFixtureParsed);
    expect(hash.startsWith(SHARE_HASH_PREFIX)).toBe(true);
    expect(await decodeShareHash(hash)).toEqual(fourBarFixtureParsed);
  });

  it("carries annotations, curved edges and bar paths", async () => {
    const doc = MechanismDocumentSchema.parse({
      ...fourBarFixture,
      links: fourBarFixture.links!.map((l) =>
        l.id === "link-2"
          ? { ...l, shape: { kind: "bar", edges: [{ kind: "arc", bulge: 0.5 }] } }
          : l,
      ),
      annotations: [
        {
          id: "n",
          kind: "stroke",
          points: [
            [0, 0],
            [5, 5],
          ],
          color: "red",
          width: 2,
        },
      ],
    });
    expect(await decodeShareHash(await encodeShareHash(doc))).toEqual(doc);
  });

  it("uses only URL-safe characters after the prefix", async () => {
    const hash = await encodeShareHash(fourBarFixtureParsed);
    expect(hash.slice(SHARE_HASH_PREFIX.length)).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("is shorter than the plain JSON it packs", async () => {
    const hash = await encodeShareHash(fourBarFixtureParsed);
    expect(hash.length).toBeLessThan(JSON.stringify(fourBarFixtureParsed).length);
  });

  it("round-trips an empty document", async () => {
    const doc = createEmptyDocument();
    expect(await decodeShareHash(await encodeShareHash(doc))).toEqual(doc);
  });

  it("recognizes only non-empty #m= fragments", () => {
    expect(isShareHash("#m=abc")).toBe(true);
    expect(isShareHash("#m=")).toBe(false);
    expect(isShareHash("#other")).toBe(false);
    expect(isShareHash("")).toBe(false);
  });

  it("rejects a damaged link", async () => {
    await expect(decodeShareHash("#m=not-a-real-payload")).rejects.toThrow();
    await expect(decodeShareHash("#other")).rejects.toThrow();
  });

  it("builds the full URL from the page location, replacing any fragment", async () => {
    const url = await buildShareUrl(fourBarFixtureParsed, {
      origin: "https://www.robiolab.co",
      pathname: "/simuplandes/",
      search: "?lang=en",
    });
    expect(url.startsWith("https://www.robiolab.co/simuplandes/?lang=en#m=")).toBe(true);
    expect(await decodeShareHash(url.slice(url.indexOf("#")))).toEqual(fourBarFixtureParsed);
  });
});
