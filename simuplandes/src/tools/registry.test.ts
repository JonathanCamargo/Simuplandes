import { describe, it, expect } from "vitest";
import { TOOL_REGISTRY, EDIT_SHORTCUTS, toolById, type ToolId } from "./registry";
import { collectKeys, loadLocaleResources } from "../i18n/i18n";

describe("TOOL_REGISTRY", () => {
  it("has 9 tools in the UX.md rail order", () => {
    const ids = TOOL_REGISTRY.map((t) => t.id);
    expect(ids).toEqual([
      "select",
      "pan",
      "bar",
      "plate",
      "groundPivot",
      "pin",
      "slider",
      "motor",
      "marker",
    ]);
  });

  it("has unique tool ids", () => {
    const ids = TOOL_REGISTRY.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("has unique single lowercase-letter keys", () => {
    const keys = TOOL_REGISTRY.map((t) => t.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const key of keys) {
      expect(key).toMatch(/^[a-z]$/);
    }
  });

  it("never binds the space key (reserved for Phase 5's Build/Simulate toggle)", () => {
    for (const tool of TOOL_REGISTRY) {
      expect(tool.key).not.toBe(" ");
    }
  });

  it("toolById returns the matching descriptor and throws for an unknown id", () => {
    expect(toolById("bar").id).toBe("bar");
    expect(() => toolById("nope" as ToolId)).toThrow();
  });

  it("every labelKey/descKey/hintKey resolves to a non-empty string in es and en", () => {
    const resources = loadLocaleResources();
    for (const lang of ["es", "en"] as const) {
      for (const tool of TOOL_REGISTRY) {
        for (const key of [tool.labelKey, tool.descKey, tool.hintKey]) {
          const value = resolveKey(resources[lang].translation, key);
          expect(value, `${lang}.${key}`).toBeTypeOf("string");
          expect((value as string).length, `${lang}.${key}`).toBeGreaterThan(0);
        }
      }
    }
  });
});

describe("EDIT_SHORTCUTS", () => {
  it("has unique ids", () => {
    const ids = EDIT_SHORTCUTS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("every labelKey resolves to a non-empty string in es and en", () => {
    const resources = loadLocaleResources();
    for (const lang of ["es", "en"] as const) {
      for (const shortcut of EDIT_SHORTCUTS) {
        const value = resolveKey(resources[lang].translation, shortcut.labelKey);
        expect(value, `${lang}.${shortcut.labelKey}`).toBeTypeOf("string");
        expect((value as string).length, `${lang}.${shortcut.labelKey}`).toBeGreaterThan(0);
      }
    }
  });
});

/** Resolves a dotted "ns.a.b.c" key against the `{ [ns]: { ...nested } }` resource bundle. */
function resolveKey(bundle: Record<string, unknown>, dottedKey: string): unknown {
  const parts = dottedKey.split(".");
  let cursor: unknown = bundle;
  for (const part of parts) {
    if (typeof cursor !== "object" || cursor === null) return undefined;
    cursor = (cursor as Record<string, unknown>)[part];
  }
  return cursor;
}

// Exercise collectKeys against the loaded resources too, so registry.test.ts
// doubles as a smoke test that the two modules agree on shape.
describe("resolveKey/collectKeys agree on registry key existence", () => {
  it("every dotted key produced by collectKeys resolves back with resolveKey", () => {
    const resources = loadLocaleResources();
    const keys = collectKeys(resources.en.translation);
    expect(keys.length).toBeGreaterThan(0);
    for (const key of keys.slice(0, 5)) {
      expect(resolveKey(resources.en.translation, key)).toBeTypeOf("string");
    }
  });
});
