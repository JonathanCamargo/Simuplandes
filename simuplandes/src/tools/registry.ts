/**
 * The single source of truth for every rail tool and every editing
 * shortcut: `ToolRail`, `useStudioShortcuts`, the (later) command palette
 * and the (later) shortcut sheet all map over `TOOL_REGISTRY`/
 * `EDIT_SHORTCUTS` instead of hard-coding their own copies. Pure module,
 * no React/Konva/store imports.
 *
 * Space is deliberately NOT bound to a tool: Phase 5 uses it for the
 * Build/Simulate mode toggle. The `toggleMode` entry below is bound in
 * `useStudioShortcuts` (plan 05-06), not here -- it exists in
 * `EDIT_SHORTCUTS` only so the `?` shortcut sheet lists it.
 */

export type ToolId =
  "select" | "pan" | "bar" | "plate" | "groundPivot" | "pin" | "slider" | "motor" | "marker";

export type ToolGroup = "navigate" | "draw" | "connect" | "drive" | "measure";

export interface ToolDescriptor {
  id: ToolId;
  /** Single lowercase-letter shortcut, matched by keyboard code (not layout-shifted). */
  key: string;
  labelKey: string;
  descKey: string;
  hintKey: string;
  group: ToolGroup;
}

/** Order is significant: it is the rail's display order (UX.md's rail table). */
export const TOOL_REGISTRY: readonly ToolDescriptor[] = [
  {
    id: "select",
    key: "v",
    labelKey: "tools.select.label",
    descKey: "tools.select.description",
    hintKey: "tools.select.hint.idle",
    group: "navigate",
  },
  {
    id: "pan",
    key: "h",
    labelKey: "tools.pan.label",
    descKey: "tools.pan.description",
    hintKey: "tools.pan.hint.idle",
    group: "navigate",
  },
  {
    id: "bar",
    key: "l",
    labelKey: "tools.bar.label",
    descKey: "tools.bar.description",
    hintKey: "tools.bar.hint.idle",
    group: "draw",
  },
  {
    id: "plate",
    key: "p",
    labelKey: "tools.plate.label",
    descKey: "tools.plate.description",
    hintKey: "tools.plate.hint.idle",
    group: "draw",
  },
  {
    id: "groundPivot",
    key: "g",
    labelKey: "tools.groundPivot.label",
    descKey: "tools.groundPivot.description",
    hintKey: "tools.groundPivot.hint.idle",
    group: "connect",
  },
  {
    id: "pin",
    key: "j",
    labelKey: "tools.pin.label",
    descKey: "tools.pin.description",
    hintKey: "tools.pin.hint.idle",
    group: "connect",
  },
  {
    id: "slider",
    key: "s",
    labelKey: "tools.slider.label",
    descKey: "tools.slider.description",
    hintKey: "tools.slider.hint.idle",
    group: "connect",
  },
  {
    id: "motor",
    key: "m",
    labelKey: "tools.motor.label",
    descKey: "tools.motor.description",
    hintKey: "tools.motor.hint.idle",
    group: "drive",
  },
  {
    id: "marker",
    key: "t",
    labelKey: "tools.marker.label",
    descKey: "tools.marker.description",
    hintKey: "tools.marker.hint.idle",
    group: "measure",
  },
];

export interface ShortcutDescriptor {
  id: string;
  /** `react-hotkeys-hook` key combo string, e.g. "mod+z" or "shift+/" . */
  keys: string;
  /** Human-readable key combo for the shortcut sheet, e.g. "Ctrl/Cmd+Z". */
  display: string;
  labelKey: string;
}

export const EDIT_SHORTCUTS: readonly ShortcutDescriptor[] = [
  { id: "undo", keys: "mod+z", display: "Ctrl/Cmd+Z", labelKey: "tools.shortcuts.undo" },
  {
    id: "redo",
    keys: "mod+shift+z, mod+y",
    display: "Ctrl/Cmd+Shift+Z",
    labelKey: "tools.shortcuts.redo",
  },
  {
    id: "delete",
    keys: "delete, backspace",
    display: "Delete/Backspace",
    labelKey: "tools.shortcuts.delete",
  },
  { id: "duplicate", keys: "mod+d", display: "Ctrl/Cmd+D", labelKey: "tools.shortcuts.duplicate" },
  { id: "fit", keys: "f", display: "F", labelKey: "tools.shortcuts.fit" },
  { id: "cancel", keys: "escape", display: "Esc", labelKey: "tools.shortcuts.cancel" },
  { id: "commit", keys: "enter", display: "Enter", labelKey: "tools.shortcuts.commit" },
  { id: "switchField", keys: "tab", display: "Tab", labelKey: "tools.shortcuts.switchField" },
  { id: "palette", keys: "mod+k", display: "Ctrl/Cmd+K", labelKey: "tools.shortcuts.palette" },
  {
    id: "shortcutSheet",
    keys: "shift+/",
    display: "?",
    labelKey: "tools.shortcuts.shortcutSheet",
  },
  {
    id: "wheelZoom",
    keys: "wheel",
    display: "Wheel",
    labelKey: "tools.shortcuts.wheelZoom",
  },
  {
    id: "middleDragPan",
    keys: "middle-drag",
    display: "Middle-drag",
    labelKey: "tools.shortcuts.middleDragPan",
  },
  {
    id: "shiftClickAddSelection",
    keys: "shift+click",
    display: "Shift+Click",
    labelKey: "tools.shortcuts.shiftClickAddSelection",
  },
  { id: "toggleMode", keys: "space", display: "Space", labelKey: "tools.shortcuts.toggleMode" },
];

const TOOLS_BY_ID = new Map<ToolId, ToolDescriptor>(TOOL_REGISTRY.map((tool) => [tool.id, tool]));

/** Looks up a `ToolDescriptor` by id. Throws for an id not in `TOOL_REGISTRY`. */
export function toolById(id: ToolId): ToolDescriptor {
  const tool = TOOLS_BY_ID.get(id);
  if (!tool) throw new Error(`Unknown tool id: ${id}`);
  return tool;
}
