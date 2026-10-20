/**
 * Store-level helpers for annotations shared by the command palette and
 * the Eraser's toolbar.
 */

import type { MechanismStore } from "./mechanismStore";
import { clearAnnotations } from "./commands";

/** Removes every annotation as one undo step; a no-op (no history entry) when there are none. */
export function clearAllAnnotations(store: MechanismStore): boolean {
  if (store.getState().document.annotations.length === 0) return false;
  return store.getState().execute("clear-annotations", clearAnnotations());
}
