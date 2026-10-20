/**
 * Ephemeral studio state: the active tool, whether it is mid-gesture, which
 * right-dock tab is open (and whether the compact dock sheet shows), palette/shortcut-sheet visibility, the cursor's
 * world position, the current snap status and the status-bar hint. Never
 * persisted, never touches the mechanism document or its undo history.
 */

import { createStore, type StoreApi } from "zustand/vanilla";
import { toolById, type EditMode, type ToolId } from "../tools/registry";
import type { Vec2 } from "../geom";
import type { Id, Pose } from "../model";

export type RightDockTab = "inspector" | "graph" | "export";

/** The graph panel's node-placement algorithm (GRF-05). Starts "spatial". */
export type GraphLayoutKind = "spatial" | "circular" | "layered";

/**
 * Build (links and joints), Draw (reshaping links) or Simulate (driving the
 * mechanism). See `setMode`/`toggleMode`.
 */
export type StudioMode = EditMode | "simulate";

/** The tool each editing mode starts with when the active tool does not belong to it. */
const DEFAULT_TOOL: Readonly<Record<EditMode, ToolId>> = { build: "select", draw: "vertex" };

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
  /**
   * Whether the compact layout shows the dock sheet. The desktop dock is
   * always visible and ignores it. Choosing a tab opens it.
   */
  dockSheetOpen: boolean;
  paletteOpen: boolean;
  shortcutSheetOpen: boolean;
  cursorWorld: Vec2 | null;
  snapStatus: SnapStatus | null;
  /** The active tool's hint; `null` means "use the active tool's registry `hintKey`". */
  hint: StatusHint | null;
  /**
   * Simulate's own hint (solver status, dragging). Kept apart from `hint`
   * so the tool controller, which keeps reacting to keys while simulating,
   * can never overwrite it; the status bar shows it while `mode` is
   * "simulate".
   */
  simHint: StatusHint | null;
  /** Incremented by `requestFit()`; `CanvasArea` subscribes and re-fits on every change. */
  fitRequest: number;
  /** Build, Draw or Simulate. Starts in "build". */
  mode: StudioMode;
  /** The last editing mode ("build" or "draw"); Space returns to it from Simulate. */
  editMode: EditMode;
  /**
   * The simulated frame Simulate was showing when the user switched to Draw,
   * so the Brush and Eraser work over it instead of the construction pose.
   * `null` when Draw was not entered from Simulate; cleared by Build and by
   * any document change (see `useSimRuntime`).
   */
  drawPoses: ReadonlyMap<Id, Pose> | null;
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

  /** Also resets `toolBusy` to `false` and `hint` to `null`. A tool that
   * does not belong to the current mode switches to its own mode, except
   * that "select"/"pan" stay usable while simulating. */
  setActiveTool(tool: ToolId): void;
  setToolBusy(busy: boolean): void;
  /** Also opens the compact layout's dock sheet. */
  setRightDockTab(tab: RightDockTab): void;
  setDockSheetOpen(open: boolean): void;
  openPalette(): void;
  closePalette(): void;
  openShortcutSheet(): void;
  closeShortcutSheet(): void;
  setCursorWorld(cursor: Vec2 | null): void;
  setSnapStatus(status: SnapStatus | null): void;
  setHint(hint: StatusHint | null): void;
  setSimHint(hint: StatusHint | null): void;
  /** "Zoom to fit" (command palette / `F` key): bumps `fitRequest` by one. */
  requestFit(): void;
  /** Sets the mode. Switching to "simulate" or "draw" is refused (a no-op)
   * while a tool is mid-gesture or a modal (palette/shortcut sheet) is
   * open; switching to "build" is always allowed. Entering an editing mode
   * whose tools do not include the active tool picks that mode's default. */
  setMode(mode: StudioMode): void;
  setDrawPoses(poses: ReadonlyMap<Id, Pose> | null): void;
  /** Flips between "simulate" and the last editing mode, subject to the same guard as `setMode`. */
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
    dockSheetOpen: false,
    paletteOpen: false,
    shortcutSheetOpen: false,
    cursorWorld: null,
    snapStatus: null,
    hint: null,
    simHint: null,
    fitRequest: 0,
    mode: "build",
    editMode: "build",
    drawPoses: null,
    hoveredId: null,
    graphLayout: "spatial",
    dialog: null,
    importRequest: null,

    setActiveTool(tool) {
      const { mode } = get();
      const modes = toolById(tool).modes;
      const stays =
        mode === "simulate" ? tool === "select" || tool === "pan" : modes.includes(mode);
      const nextMode = stays ? mode : modes[0];
      set({
        activeTool: tool,
        toolBusy: false,
        hint: null,
        mode: nextMode,
        ...(nextMode !== "simulate" ? { editMode: nextMode } : {}),
      });
    },
    setToolBusy(busy) {
      set({ toolBusy: busy });
    },
    setRightDockTab(tab) {
      set({ rightDockTab: tab, dockSheetOpen: true });
    },
    setDockSheetOpen(open) {
      set({ dockSheetOpen: open });
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
    setSimHint(hint) {
      set({ simHint: hint });
    },
    requestFit() {
      set({ fitRequest: get().fitRequest + 1 });
    },
    setMode(mode) {
      const state = get();
      if (mode !== "build" && mode !== state.mode && !selectCanToggleMode(state)) return;
      if (mode === "simulate") {
        set({ mode });
        return;
      }
      const keepsTool = toolById(state.activeTool).modes.includes(mode);
      set({
        mode,
        editMode: mode,
        ...(mode === "build" ? { drawPoses: null } : {}),
        ...(keepsTool ? {} : { activeTool: DEFAULT_TOOL[mode], toolBusy: false, hint: null }),
      });
    },
    setDrawPoses(poses) {
      set({ drawPoses: poses });
    },
    toggleMode() {
      const state = get();
      get().setMode(state.mode === "simulate" ? state.editMode : "simulate");
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
