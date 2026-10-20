/**
 * Pure list of palette commands: exactly one entry per `TOOL_REGISTRY` tool
 * (id, label/description/shortcut all drawn straight from the registry --
 * no second tool list), plus the edit/view/preferences/help commands the
 * Ctrl+K command palette exposes. No React/Konva/MUI imports.
 *
 * `CommandPalette.tsx` maps each `PaletteAction` to the real store calls; a
 * pure list here keeps the full set of commands (and their ids/order/labels)
 * directly unit-testable in node, with no DOM.
 */

import { EDIT_SHORTCUTS, TOOL_REGISTRY, type ToolId } from "../../tools/registry";
import type { Language } from "../../i18n/numberFormat";
import type { RightDockTab, StudioDialog, StudioMode } from "../../uiState/studioStore";

export type PaletteGroup = "file" | "tools" | "edit" | "view" | "preferences" | "help";

export type PaletteAction =
  | { type: "setTool"; tool: ToolId }
  | { type: "undo" }
  | { type: "redo" }
  | { type: "delete" }
  | { type: "clearAnnotations" }
  | { type: "fit" }
  | { type: "toggleGrid" }
  | { type: "toggleSnap" }
  | { type: "toggleTheme" }
  | { type: "setLanguage"; language: Language }
  | { type: "openShortcutSheet" }
  | { type: "openDialog"; dialog: StudioDialog }
  | { type: "setMode"; mode: StudioMode }
  | { type: "showDockTab"; tab: RightDockTab };

export interface PaletteCommand {
  id: string;
  group: PaletteGroup;
  labelKey: string;
  /** Extra i18n keys (e.g. the tool's description) that widen fuzzy search. */
  keywordsKeys: string[];
  shortcut?: string;
  action: PaletteAction;
}

/**
 * Looks up an `EDIT_SHORTCUTS` entry by id. Every id passed here is one of
 * the ten hardcoded literals below (never user input), so a non-null
 * assertion -- not a defensive throw -- matches the codebase's convention
 * for lookups the schema/registry already guarantees succeed (see
 * `renderModel.ts`'s TSDoc from 04-02).
 */
function shortcutById(id: string) {
  return EDIT_SHORTCUTS.find((s) => s.id === id)!;
}

/**
 * Builds the full, ordered command list: one `"tool:<id>"` entry per
 * `TOOL_REGISTRY` item (same order as the registry/rail), followed by the
 * ten edit/view/preferences/help commands (decision: `must_haves.truths`).
 */
export function buildPaletteCommands(): PaletteCommand[] {
  const toolCommands: PaletteCommand[] = TOOL_REGISTRY.map((tool) => ({
    id: `tool:${tool.id}`,
    group: "tools",
    labelKey: tool.labelKey,
    keywordsKeys: [tool.descKey],
    shortcut: tool.key.toUpperCase(),
    action: { type: "setTool", tool: tool.id },
  }));

  const undo = shortcutById("undo");
  const redo = shortcutById("redo");
  const del = shortcutById("delete");
  const fit = shortcutById("fit");
  const shortcutSheet = shortcutById("shortcutSheet");

  const fileCommand = (id: string, dialog: StudioDialog, labelKey: string): PaletteCommand => ({
    id,
    group: "file",
    labelKey,
    keywordsKeys: [],
    action: { type: "openDialog", dialog },
  });

  return [
    fileCommand("file:importGraph", "import", "palette.commands.importGraph"),
    fileCommand("file:examples", "examples", "palette.commands.examples"),
    fileCommand("file:atlas", "atlas", "palette.commands.atlas"),
    {
      id: "file:exportImage",
      group: "file",
      labelKey: "palette.commands.exportImage",
      keywordsKeys: ["palette.commands.exportImageKeywords"],
      action: { type: "showDockTab", tab: "export" },
    },
    ...toolCommands,
    {
      id: "edit:undo",
      group: "edit",
      labelKey: undo.labelKey,
      keywordsKeys: [],
      shortcut: undo.display,
      action: { type: "undo" },
    },
    {
      id: "edit:redo",
      group: "edit",
      labelKey: redo.labelKey,
      keywordsKeys: [],
      shortcut: redo.display,
      action: { type: "redo" },
    },
    {
      id: "edit:delete",
      group: "edit",
      labelKey: del.labelKey,
      keywordsKeys: [],
      shortcut: del.display,
      action: { type: "delete" },
    },
    {
      id: "edit:clearAnnotations",
      group: "edit",
      labelKey: "palette.commands.clearAnnotations",
      keywordsKeys: ["palette.commands.clearAnnotationsKeywords"],
      action: { type: "clearAnnotations" },
    },
    {
      id: "view:fit",
      group: "view",
      labelKey: fit.labelKey,
      keywordsKeys: [],
      shortcut: fit.display,
      action: { type: "fit" },
    },
    {
      id: "view:modeBuild",
      group: "view",
      labelKey: "palette.commands.modeBuild",
      keywordsKeys: [],
      action: { type: "setMode", mode: "build" },
    },
    {
      id: "view:modeDraw",
      group: "view",
      labelKey: "palette.commands.modeDraw",
      keywordsKeys: ["palette.commands.modeDrawKeywords"],
      action: { type: "setMode", mode: "draw" },
    },
    {
      id: "view:modeSimulate",
      group: "view",
      labelKey: "palette.commands.modeSimulate",
      keywordsKeys: ["palette.commands.modeSimulateKeywords"],
      action: { type: "setMode", mode: "simulate" },
    },
    {
      id: "view:showGraph",
      group: "view",
      labelKey: "palette.commands.showGraph",
      keywordsKeys: ["palette.commands.showGraphKeywords"],
      action: { type: "showDockTab", tab: "graph" },
    },
    {
      id: "view:toggleGrid",
      group: "view",
      labelKey: "palette.commands.toggleGrid",
      keywordsKeys: [],
      action: { type: "toggleGrid" },
    },
    {
      id: "view:toggleSnap",
      group: "view",
      labelKey: "palette.commands.toggleSnap",
      keywordsKeys: [],
      action: { type: "toggleSnap" },
    },
    {
      id: "pref:toggleTheme",
      group: "preferences",
      labelKey: "palette.commands.toggleTheme",
      keywordsKeys: [],
      action: { type: "toggleTheme" },
    },
    {
      id: "pref:language:es",
      group: "preferences",
      labelKey: "palette.commands.languageEs",
      keywordsKeys: [],
      action: { type: "setLanguage", language: "es" },
    },
    {
      id: "pref:language:en",
      group: "preferences",
      labelKey: "palette.commands.languageEn",
      keywordsKeys: [],
      action: { type: "setLanguage", language: "en" },
    },
    {
      id: "help:shortcuts",
      group: "help",
      labelKey: shortcutSheet.labelKey,
      keywordsKeys: [],
      shortcut: shortcutSheet.display,
      action: { type: "openShortcutSheet" },
    },
  ];
}
