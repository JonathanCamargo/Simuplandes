/**
 * Verifies `TOOL_MACHINES` covers every `TOOL_REGISTRY` id, that the idle
 * placeholders behave as documented, and exports the shared
 * `expectHintLocalized` helper every other tool test file uses to prove
 * each reachable state's `hint().key` exists in both locales. Reads the
 * locale JSON directly (not `createI18n`/`react-i18next`) to stay inside
 * the `src/tools/*.ts` purity rule (no React imports, even in a test file).
 */

import { describe, expect, it } from "vitest";
import esTools from "../i18n/locales/es/tools.json";
import enTools from "../i18n/locales/en/tools.json";
import { TOOL_REGISTRY, toolById } from "./registry";
import { TOOL_MACHINES } from "./machines";
import type { HintMessage } from "./types";

type LocaleTree = { [key: string]: string | LocaleTree };

function hasKey(tree: LocaleTree, dotted: string): boolean {
  let node: string | LocaleTree = tree;
  for (const part of dotted.split(".")) {
    if (typeof node !== "object" || node === null || !(part in node)) return false;
    node = node[part];
  }
  return typeof node === "string";
}

/** Asserts `hint.key` (e.g. `"tools.bar.hint.idle"`) resolves to a real
 * string in BOTH `tools.json` locales. Shared by every `*Tool.test.ts`. */
export function expectHintLocalized(hint: HintMessage): void {
  expect(hint.key.startsWith("tools.")).toBe(true);
  const path = hint.key.slice("tools.".length);
  expect(hasKey(esTools as LocaleTree, path)).toBe(true);
  expect(hasKey(enTools as LocaleTree, path)).toBe(true);
}

describe("TOOL_MACHINES", () => {
  it("has an entry for every TOOL_REGISTRY id", () => {
    for (const tool of TOOL_REGISTRY) {
      expect(TOOL_MACHINES[tool.id]).toBeDefined();
      expect(TOOL_MACHINES[tool.id].id).toBe(tool.id);
    }
  });

  it.each(["pan"] as const)(
    "%s is an idle placeholder: never busy, no effects, hint = registry hintKey",
    (id) => {
      const machine = TOOL_MACHINES[id];
      const ctx = {
        doc: { links: [], joints: [], motors: [], markers: [], loads: [] } as never,
        selection: new Set<string>(),
        radiusWorld: 8,
        gestureSeed: "test-gesture",
      };
      const state = machine.initial();
      expect(machine.isBusy(state)).toBe(false);
      expect(machine.preview(state)).toEqual([]);
      expect(machine.snapAnchor(state)).toBeUndefined();
      expect(machine.dynamicInput(state)).toBeUndefined();
      const hint = machine.hint(state, ctx);
      expect(hint).toEqual({ key: toolById(id).hintKey });
      expectHintLocalized(hint);

      const result = machine.reduce(
        state,
        {
          type: "pointerdown",
          world: { x: 0, y: 0 },
          snap: { kind: "none", point: { x: 0, y: 0 } },
          button: 0,
          shift: false,
          mod: false,
          alt: false,
        },
        ctx,
      );
      expect(result.effects).toEqual([]);
      expect(result.handled).toBe(false);
    },
  );

  it("every registry hintKey resolves in both locales (idle states)", () => {
    for (const tool of TOOL_REGISTRY) {
      expectHintLocalized({ key: tool.hintKey });
    }
  });
});
