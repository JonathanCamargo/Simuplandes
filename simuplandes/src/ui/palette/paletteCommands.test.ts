import { describe, it, expect } from "vitest";
import esTools from "../../i18n/locales/es/tools.json";
import enTools from "../../i18n/locales/en/tools.json";
import esPalette from "../../i18n/locales/es/palette.json";
import enPalette from "../../i18n/locales/en/palette.json";
import { TOOL_REGISTRY } from "../../tools/registry";
import { buildPaletteCommands } from "./paletteCommands";

const LOCALE_ROOTS = {
  es: { tools: esTools, palette: esPalette } as Record<string, unknown>,
  en: { tools: enTools, palette: enPalette } as Record<string, unknown>,
};

function resolveKey(root: Record<string, unknown>, dotted: string): unknown {
  const [ns, ...rest] = dotted.split(".");
  let cursor: unknown = root[ns];
  for (const segment of rest) {
    if (cursor === undefined || typeof cursor !== "object" || cursor === null) return undefined;
    cursor = (cursor as Record<string, unknown>)[segment];
  }
  return cursor;
}

function resolvesNonEmptyInBothLangs(dotted: string): boolean {
  return (["es", "en"] as const).every((lang) => {
    const value = resolveKey(LOCALE_ROOTS[lang], dotted);
    return typeof value === "string" && value.length > 0;
  });
}

describe("buildPaletteCommands", () => {
  const commands = buildPaletteCommands();

  it("has exactly one tool:<id> entry per TOOL_REGISTRY item, in the same order", () => {
    const toolCommands = commands.filter((c) => c.group === "tools");
    expect(toolCommands.map((c) => c.id)).toEqual(TOOL_REGISTRY.map((t) => `tool:${t.id}`));
    expect(toolCommands).toHaveLength(TOOL_REGISTRY.length);
    for (const [i, cmd] of toolCommands.entries()) {
      const tool = TOOL_REGISTRY[i];
      expect(cmd.action).toEqual({ type: "setTool", tool: tool.id });
      expect(cmd.shortcut).toBe(tool.key.toUpperCase());
      expect(cmd.keywordsKeys).toEqual([tool.descKey]);
      expect(cmd.labelKey).toBe(tool.labelKey);
    }
  });

  it("has the three file commands first, each opening its dialog", () => {
    const file = commands.filter((c) => c.group === "file");
    expect(file.map((c) => c.id)).toEqual(["file:importGraph", "file:examples", "file:atlas"]);
    expect(file.map((c) => c.action)).toEqual([
      { type: "openDialog", dialog: "import" },
      { type: "openDialog", dialog: "examples" },
      { type: "openDialog", dialog: "atlas" },
    ]);
  });

  it("has exactly the ten other non-tool commands, in order, each once", () => {
    const nonToolIds = commands
      .filter((c) => c.group !== "tools" && c.group !== "file")
      .map((c) => c.id);
    expect(nonToolIds).toEqual([
      "edit:undo",
      "edit:redo",
      "edit:delete",
      "view:fit",
      "view:toggleGrid",
      "view:toggleSnap",
      "pref:toggleTheme",
      "pref:language:es",
      "pref:language:en",
      "help:shortcuts",
    ]);
  });

  it("has no duplicate ids", () => {
    const ids = commands.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("every labelKey resolves to a non-empty string in es and en", () => {
    for (const cmd of commands) {
      expect(resolvesNonEmptyInBothLangs(cmd.labelKey)).toBe(true);
    }
  });

  it("every keywordsKeys entry resolves to a non-empty string in es and en", () => {
    for (const cmd of commands) {
      for (const key of cmd.keywordsKeys) {
        expect(resolvesNonEmptyInBothLangs(key)).toBe(true);
      }
    }
  });

  it("edit:undo / edit:redo / edit:delete carry the EDIT_SHORTCUTS display string", () => {
    const undo = commands.find((c) => c.id === "edit:undo")!;
    const redo = commands.find((c) => c.id === "edit:redo")!;
    const del = commands.find((c) => c.id === "edit:delete")!;
    expect(undo.shortcut).toBe("Ctrl/Cmd+Z");
    expect(redo.shortcut).toBe("Ctrl/Cmd+Shift+Z");
    expect(del.shortcut).toBe("Delete/Backspace");
    expect(undo.action).toEqual({ type: "undo" });
    expect(redo.action).toEqual({ type: "redo" });
    expect(del.action).toEqual({ type: "delete" });
  });

  it("view:fit / view:toggleGrid / view:toggleSnap actions are exact", () => {
    expect(commands.find((c) => c.id === "view:fit")!.action).toEqual({ type: "fit" });
    expect(commands.find((c) => c.id === "view:toggleGrid")!.action).toEqual({
      type: "toggleGrid",
    });
    expect(commands.find((c) => c.id === "view:toggleSnap")!.action).toEqual({
      type: "toggleSnap",
    });
  });

  it("pref:toggleTheme / pref:language:es / pref:language:en actions are exact", () => {
    expect(commands.find((c) => c.id === "pref:toggleTheme")!.action).toEqual({
      type: "toggleTheme",
    });
    expect(commands.find((c) => c.id === "pref:language:es")!.action).toEqual({
      type: "setLanguage",
      language: "es",
    });
    expect(commands.find((c) => c.id === "pref:language:en")!.action).toEqual({
      type: "setLanguage",
      language: "en",
    });
  });

  it("help:shortcuts opens the shortcut sheet and carries the '?' display", () => {
    const help = commands.find((c) => c.id === "help:shortcuts")!;
    expect(help.action).toEqual({ type: "openShortcutSheet" });
    expect(help.shortcut).toBe("?");
  });
});
