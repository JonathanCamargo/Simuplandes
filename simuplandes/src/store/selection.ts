/**
 * Pure selection helpers. Selection is UI/interaction state, kept outside
 * the undo history (Pitfall 4): changing it never records a history entry,
 * and it is pruned whenever the document changes (execute/undo/redo/load).
 */

import type { Id } from "../model";

/** How `select()` combines new ids with the current selection. */
export type SelectionMode = "replace" | "add" | "toggle" | "remove";

/**
 * Applies a selection change. Ids not present in `existing` (the document's
 * current id set) are silently ignored.
 */
export function applySelection(
  current: ReadonlySet<Id>,
  ids: Iterable<Id>,
  mode: SelectionMode,
  existing: ReadonlySet<Id>,
): ReadonlySet<Id> {
  const validIds = Array.from(ids).filter((id) => existing.has(id));

  if (mode === "replace") {
    return new Set(validIds);
  }

  const next = new Set(current);
  if (mode === "add") {
    for (const id of validIds) next.add(id);
  } else if (mode === "remove") {
    for (const id of validIds) next.delete(id);
  } else {
    for (const id of validIds) {
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
    }
  }
  return next;
}

/**
 * Removes ids no longer present in `existing`. Returns the SAME `selection`
 * instance when nothing was pruned, so subscribers relying on reference
 * equality don't re-render needlessly.
 */
export function pruneSelection(
  selection: ReadonlySet<Id>,
  existing: ReadonlySet<Id>,
): ReadonlySet<Id> {
  let needsPrune = false;
  for (const id of selection) {
    if (!existing.has(id)) {
      needsPrune = true;
      break;
    }
  }
  if (!needsPrune) return selection;

  const next = new Set<Id>();
  for (const id of selection) {
    if (existing.has(id)) next.add(id);
  }
  return next;
}
