/**
 * Global keyboard shortcuts for the studio shell: one tool-letter binding
 * per `TOOL_REGISTRY` entry, plus undo/redo, Ctrl+K (command palette) and
 * `?` (shortcut sheet). Tool letters are disabled while focus is in a form
 * field (`enableOnFormTags: false`), so native text-field undo still works
 * and typing a name never switches tools; Ctrl+K is the one binding that
 * works even from inside a form field (`enableOnFormTags: true`), per
 * EDT-06's "from anywhere" requirement.
 *
 * Registered as a single `useHotkeys` call over a comma-joined key list
 * (dispatching on `hotkeysEvent.keys`) rather than one `useHotkeys` call per
 * registry entry inside a loop, since `TOOL_REGISTRY`'s length is fixed but
 * `react-hooks/rules-of-hooks` cannot verify that statically.
 */

import { useHotkeys } from "react-hotkeys-hook";
import { useStore, type StoreApi } from "zustand";
import { TOOL_REGISTRY, type ToolId } from "../../tools/registry";
import { selectModalOpen, type StudioState } from "../../uiState/studioStore";
import type { MechanismState } from "../../store";

const TOOL_KEYS = TOOL_REGISTRY.map((tool) => tool.key).join(",");
const TOOLS_BY_KEY = new Map(TOOL_REGISTRY.map((tool) => [tool.key, tool.id]));

/**
 * Resolves the pressed key (`hotkeysEvent.keys?.[0]`) to a `ToolId`, or
 * `undefined` for a missing/unrecognized key. Extracted as a pure function
 * so both branches are directly unit-testable without simulating real
 * keyboard events (`hotkeysEvent.keys` is only ever `undefined` for
 * non-key-based triggers, which this binding never uses).
 */
export function resolveToolIdForKey(pressedKey: string | undefined): ToolId | undefined {
  if (pressedKey === undefined) return undefined;
  return TOOLS_BY_KEY.get(pressedKey);
}

export function useStudioShortcuts(
  studioStore: StoreApi<StudioState>,
  mechanismStore: StoreApi<MechanismState>,
): void {
  const toolBusy = useStore(studioStore, (s) => s.toolBusy);
  const modalOpen = useStore(studioStore, selectModalOpen);
  const shortcutsEnabled = !toolBusy && !modalOpen;

  useHotkeys(
    TOOL_KEYS,
    (_event, hotkeysEvent) => {
      const toolId = resolveToolIdForKey(hotkeysEvent.keys?.[0]);
      if (toolId !== undefined) {
        studioStore.getState().setActiveTool(toolId);
      }
    },
    { enabled: shortcutsEnabled, enableOnFormTags: false, preventDefault: true },
    [shortcutsEnabled],
  );

  // Space: toggles Build/Simulate (UX.md key interaction 3). `toggleMode`
  // applies its own `selectCanToggleMode` guard (refuses while a tool is
  // mid-gesture or a modal is open); `shortcutsEnabled` mirrors the same
  // condition here so the binding is disabled outright rather than firing
  // a no-op keydown that would still `preventDefault` (blocking page
  // scroll) for nothing.
  useHotkeys(
    "space",
    () => {
      studioStore.getState().toggleMode();
    },
    { enabled: shortcutsEnabled, enableOnFormTags: false, preventDefault: true },
    [shortcutsEnabled],
  );

  useHotkeys(
    "mod+z",
    () => {
      mechanismStore.getState().undo();
    },
    { enableOnFormTags: false, preventDefault: true },
    [],
  );

  useHotkeys(
    "mod+shift+z, mod+y",
    () => {
      mechanismStore.getState().redo();
    },
    { enableOnFormTags: false, preventDefault: true },
    [],
  );

  // Ctrl+K (Cmd+K on macOS): opens the command palette from anywhere,
  // including while a text field is focused (EDT-06's "from anywhere").
  useHotkeys(
    "mod+k",
    () => {
      studioStore.getState().openPalette();
    },
    { enableOnFormTags: true, preventDefault: true },
    [],
  );

  // "?": opens the shortcut sheet. `useKey: true` matches on the PRODUCED
  // key (`event.key === "?"`), not the physical code, so it fires on both
  // US (Shift+/) and Spanish (Shift+') keyboard layouts -- both produce "?"
  // only while holding Shift, so `ignoreModifiers: true` is required too:
  // the library's own modifier check otherwise compares the PHYSICAL key
  // ("slash"/"quote", not "shift") against the hotkey string's declared
  // modifiers (none, since "?" has no explicit "shift+" token), which would
  // always mismatch a real Shift+Slash/Shift+' keypress. Never fires while
  // typing in a form field.
  useHotkeys(
    "?",
    () => {
      studioStore.getState().openShortcutSheet();
    },
    { useKey: true, ignoreModifiers: true, enableOnFormTags: false, preventDefault: true },
    [],
  );
}
