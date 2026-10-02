/**
 * Patch-based undo/redo stack. Each `HistoryEntry` is an Immer
 * `{patches, inversePatches}` pair produced by `produceWithPatches` elsewhere
 * (the store's `execute()`), applied here via `applyPatches`. `enablePatches`
 * is called once at module init, as required by Immer's patches plugin.
 */

import { applyPatches, enablePatches, type Patch } from "immer";

enablePatches();

/** Generous default cap, comfortably over MDL-02's 100-step floor. */
export const DEFAULT_HISTORY_LIMIT = 500;

/** One undoable change: its label plus the Immer patches that apply/invert it. */
export interface HistoryEntry {
  label: string;
  patches: Patch[];
  inversePatches: Patch[];
  /**
   * Identifies ONE interaction (e.g. a drag gesture id). Consecutive
   * `record()` calls sharing a `coalesceKey` merge into a single history
   * entry. Any `undo`/`redo`/`clear`, or a `record` with a different or
   * absent key, breaks the chain.
   */
  coalesceKey?: string;
}

/** A patch-based undo/redo stack over states of type `T`. */
export interface History<T> {
  /** Records a new entry, merging into the top entry if `coalesceKey` matches the last recorded key. */
  record(entry: HistoryEntry): void;
  /** Applies the top past entry's inverse patches to `current`, moving it to future. Returns null if empty. */
  undo(current: T): T | null;
  /** Applies the top future entry's patches to `current`, moving it back to past. Returns null if empty. */
  redo(current: T): T | null;
  /** Empties both stacks. */
  clear(): void;
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  readonly pastCount: number;
  readonly futureCount: number;
  readonly undoLabel: string | null;
  readonly redoLabel: string | null;
}

/** Creates a new, isolated patch-based history stack. */
export function createHistory<T>(options?: { limit?: number }): History<T> {
  const limit = options?.limit ?? DEFAULT_HISTORY_LIMIT;
  const past: HistoryEntry[] = [];
  const future: HistoryEntry[] = [];
  // Tracks the coalesceKey of the last entry recorded via `record()` (not
  // via undo/redo), so a merge only happens right after a matching record.
  let lastRecordedCoalesceKey: string | undefined;

  function record(entry: HistoryEntry): void {
    const top = past[past.length - 1];
    if (
      top !== undefined &&
      entry.coalesceKey !== undefined &&
      lastRecordedCoalesceKey === entry.coalesceKey
    ) {
      top.patches = [...top.patches, ...entry.patches];
      top.inversePatches = [...entry.inversePatches, ...top.inversePatches];
      top.label = entry.label;
    } else {
      past.push({ ...entry });
      if (past.length > limit) {
        past.shift();
      }
    }
    lastRecordedCoalesceKey = entry.coalesceKey;
    future.length = 0;
  }

  function undo(current: T): T | null {
    const entry = past.pop();
    if (entry === undefined) return null;
    future.push(entry);
    lastRecordedCoalesceKey = undefined;
    return applyPatches(current as object, entry.inversePatches) as T;
  }

  function redo(current: T): T | null {
    const entry = future.pop();
    if (entry === undefined) return null;
    past.push(entry);
    lastRecordedCoalesceKey = undefined;
    return applyPatches(current as object, entry.patches) as T;
  }

  function clear(): void {
    past.length = 0;
    future.length = 0;
    lastRecordedCoalesceKey = undefined;
  }

  return {
    record,
    undo,
    redo,
    clear,
    get canUndo() {
      return past.length > 0;
    },
    get canRedo() {
      return future.length > 0;
    },
    get pastCount() {
      return past.length;
    },
    get futureCount() {
      return future.length;
    },
    get undoLabel() {
      return past.length > 0 ? past[past.length - 1].label : null;
    },
    get redoLabel() {
      return future.length > 0 ? future[future.length - 1].label : null;
    },
  };
}
