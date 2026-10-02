/**
 * Ephemeral studio state: the active tool, whether it is mid-gesture, which
 * right-dock tab is open, palette/shortcut-sheet visibility, the cursor's
 * world position, the current snap status and the status-bar hint. Never
 * persisted, never touches the mechanism document or its undo history.
 */

import { createStore, type StoreApi } from "zustand/vanilla";
import type { ToolId } from "../tools/registry";
import type { Vec2 } from "../geom";
import type { Id } from "../model";

export type RightDockTab = "inspector" | "graph" | "export";

/** The graph panel's node-placement algorithm (GRF-05). Starts "spatial". */
export type GraphLayoutKind = "spatial" | "circular" | "layered";

/** Build (editing) vs Simulate (driving the mechanism). See `setMode`/`toggleMode`. */
export type StudioMode = "build" | "simulate";

/** The studio dialogs Phase 9 adds; at most one is open at a time. */
export type StudioDialog = "import" | "examples" | "atlas";

/** A graph text waiting to be shown in the import dialog; `nonce` bumps on every request. */
export interface ImportRequest {
  text: string;
  fileName: string | null;
  nonce: number;
}

export type SnapKind = "site" | "midpoint" | "grid" | "angle" | "none";

export interface SnapStatus {
  kind: SnapKind;
  labelKey: string;
  values?: Record<string, string>;
}

export interface StatusHint {
  key: string;
  values?: Record<string, string | number>;
}

export interface StudioState {
  activeTool: ToolId;
  /** True while a tool is mid-gesture; suspends tool-letter shortcuts. */
  toolBusy: boolean;
  rightDockTab: RightDockTab;
  paletteOpen: boolean;
  shortcutSheetOpen: boolean;
  cursorWorld: Vec2 | null;
  snapStatus: SnapStatus | null;
  /** `null` means "use the active tool's registry `hintKey`". */
  hint: StatusHint | null;
  /** Incremented by `requestFit()`; `CanvasArea` subscribes and re-fits on every change. */
  fitRequest: number;
  /** Build (editing) vs Simulate (driving the mechanism). Starts in "build". */
  mode: StudioMode;
  /**
   * Ephemeral, shared by canvas and graph panel (GRF-02): a link id or a
   * joint id, or `null` for "nothing hovered". Never persisted, never
   * undoable -- exactly like `cursorWorld`.
   */
  hoveredId: Id | null;
  /**
   * Ephemeral graph-panel layout choice (GRF-05), consumed by 06-05's graph
   * panel. Never persisted, never undoable. Starts "spatial".
   */
  graphLayout: GraphLayoutKind;
  /** The open studio dialog, or `null`. An open dialog counts as modal for shortcuts (but not for `setMode`). */
  dialog: StudioDialog | null;
  /** Graph text handed to the import dialog (drop, File > Open sniffing). */
  importRequest: ImportRequest | null;

  /** Also resets `toolBusy` to `false` and `hint` to `null`. While `mode` is
   * "simulate", switching to any tool other than "select"/"pan" also
   * returns `mode` to "build" (drawing tools only make sense in Build). */
  setActiveTool(tool: ToolId): void;
  setToolBusy(busy: boolean): void;
  setRightDockTab(tab: RightDockTab): void;
  openPalette(): void;
  closePalette(): void;
  openShortcutSheet(): void;
  closeShortcutSheet(): void;
  setCursorWorld(cursor: Vec2 | null): void;
  setSnapStatus(status: SnapStatus | null): void;
  setHint(hint: StatusHint | null): void;
  /** "Zoom to fit" (command palette / `F` key): bumps `fitRequest` by one. */
  requestFit(): void;
  /** Sets the Build/Simulate mode. Switching to "simulate" is refused (a
   * no-op) while a tool is mid-gesture or a modal (palette/shortcut sheet)
   * is open; switching to "build" is always allowed. */
  setMode(mode: StudioMode): void;
  /** Flips `mode`, subject to the same guard as `setMode("simulate")`. */
  toggleMode(): void;
  /** No-op (does not `set`, so subscribers are not notified) when `id` is already the current `hoveredId`. */
  setHoveredId(id: Id | null): void;
  setGraphLayout(kind: GraphLayoutKind): void;
  openDialog(dialog: StudioDialog): void;
  closeDialog(): void;
  /** Stores the text (nonce + 1) and opens the import dialog. */
  requestImport(text: string, fileName: string | null): void;
  clearImportRequest(): void;
}

/** `createStudioStore()`: a fresh, in-memory, non-persisted vanilla Zustand store. */
export function createStudioStore(): StoreApi<StudioState> {
  return createStore<StudioState>((set, get) => ({
    activeTool: "select",
    toolBusy: false,
    rightDockTab: "inspector",
    paletteOpen: false,
    shortcutSheetOpen: false,
    cursorWorld: null,
    snapStatus: null,
    hint: null,
    fitRequest: 0,
    mode: "build",
    hoveredId: null,
    graphLayout: "spatial",
    dialog: null,
    importRequest: null,

    setActiveTool(tool) {
      const goesToBuild = get().mode === "simulate" && tool !== "select" && tool !== "pan";
      set({
        activeTool: tool,
        toolBusy: false,
        hint: null,
        ...(goesToBuild ? { mode: "build" as const } : {}),
      });
    },
    setToolBusy(busy) {
      set({ toolBusy: busy });
    },
    setRightDockTab(tab) {
      set({ rightDockTab: tab });
    },
    openPalette() {
      set({ paletteOpen: true });
    },
    closePalette() {
      set({ paletteOpen: false });
    },
    openShortcutSheet() {
      set({ shortcutSheetOpen: true });
    },
    closeShortcutSheet() {
      set({ shortcutSheetOpen: false });
    },
    setCursorWorld(cursor) {
      set({ cursorWorld: cursor });
    },
    setSnapStatus(status) {
      set({ snapStatus: status });
    },
    setHint(hint) {
      set({ hint });
    },
    requestFit() {
      set({ fitRequest: get().fitRequest + 1 });
    },
    setMode(mode) {
      if (mode === "simulate" && !selectCanToggleMode(get())) return;
      set({ mode });
    },
    toggleMode() {
      const state = get();
      const nextMode: StudioMode = state.mode === "build" ? "simulate" : "build";
      if (nextMode === "simulate" && !selectCanToggleMode(state)) return;
      set({ mode: nextMode });
    },
    setHoveredId(id) {
      if (get().hoveredId === id) return;
      set({ hoveredId: id });
    },
    setGraphLayout(kind) {
      set({ graphLayout: kind });
    },
    openDialog(dialog) {
      set({ dialog });
    },
    closeDialog() {
      set({ dialog: null });
    },
    requestImport(text, fileName) {
      const nonce = (get().importRequest?.nonce ?? 0) + 1;
      set({ importRequest: { text, fileName, nonce }, dialog: "import" });
    },
    clearImportRequest() {
      set({ importRequest: null });
    },
  }));
}

/** `true` when the command palette, the shortcut sheet or a studio dialog is open. */
export function selectModalOpen(
  state: Pick<StudioState, "paletteOpen" | "shortcutSheetOpen" | "dialog">,
): boolean {
  return state.paletteOpen || state.shortcutSheetOpen || state.dialog !== null;
}

/** `true` iff the mode can currently switch to "simulate": no mid-gesture tool and no open modal. */
export function selectCanToggleMode(
  state: Pick<StudioState, "toolBusy" | "paletteOpen" | "shortcutSheetOpen">,
): boolean {
  return !state.toolBusy && !state.paletteOpen && !state.shortcutSheetOpen;
}
