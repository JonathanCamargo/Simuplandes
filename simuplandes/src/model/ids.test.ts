import { describe, it, expect, vi, afterEach } from "vitest";
import { createId } from "./ids";

describe("createId", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("matches the expected pattern for a given kind", () => {
    const id = createId("link");
    expect(id).toMatch(/^link-[0-9a-f-]{8,}$/);
  });

  it("returns 1000 distinct ids", () => {
    const ids = new Set<string>();
    for (let i = 0; i < 1000; i++) {
      ids.add(createId("site"));
    }
    expect(ids.size).toBe(1000);
  });

  it("falls back to getRandomValues when crypto.randomUUID is unavailable", () => {
    const originalCrypto = globalThis.crypto;
    const fallbackCrypto: Crypto = {
      ...originalCrypto,
      randomUUID: undefined as unknown as Crypto["randomUUID"],
      getRandomValues: originalCrypto.getRandomValues.bind(originalCrypto),
    };
    vi.stubGlobal("crypto", fallbackCrypto);

    const id = createId("joint");
    expect(id).toMatch(/^joint-[0-9a-f-]{8,}$/);

    const id2 = createId("joint");
    expect(id).not.toBe(id2);
  });
});
