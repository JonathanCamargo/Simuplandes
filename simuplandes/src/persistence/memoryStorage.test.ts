import { describe, it, expect } from "vitest";
import { createMemoryStorage } from "./memoryStorage";

describe("createMemoryStorage", () => {
  it("starts empty, with length 0 and key/getItem returning null", () => {
    const storage = createMemoryStorage();
    expect(storage.length).toBe(0);
    expect(storage.key(0)).toBeNull();
    expect(storage.getItem("missing")).toBeNull();
  });

  it("seeds from an initial record", () => {
    const storage = createMemoryStorage({ a: "1" });
    expect(storage.length).toBe(1);
    expect(storage.getItem("a")).toBe("1");
    expect(storage.key(0)).toBe("a");
  });

  it("setItem/getItem/removeItem round-trip and update length", () => {
    const storage = createMemoryStorage();
    storage.setItem("a", "1");
    storage.setItem("b", "2");
    expect(storage.length).toBe(2);
    expect(storage.getItem("a")).toBe("1");
    expect(storage.getItem("b")).toBe("2");

    storage.removeItem("a");
    expect(storage.length).toBe(1);
    expect(storage.getItem("a")).toBeNull();
    expect(storage.getItem("b")).toBe("2");
  });

  it("clear empties the storage", () => {
    const storage = createMemoryStorage({ a: "1", b: "2" });
    storage.clear();
    expect(storage.length).toBe(0);
    expect(storage.getItem("a")).toBeNull();
    expect(storage.getItem("b")).toBeNull();
  });
});
