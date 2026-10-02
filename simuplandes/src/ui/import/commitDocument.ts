/**
 * Shared "planned document -> canvas" glue used by the import, examples and
 * atlas dialogs. Pure store calls, no React. The order is fixed (and
 * unit-tested): leave Simulate, replace the document (non-undoable, history
 * reset), reset the tool, clear the import request, close the dialog, and
 * only then (optionally) enter Simulate -- the dialog must be closed first
 * so nothing modal is left open while the simulation starts.
 */

import type { StoreApi } from "zustand";
import type { MechanismDocument } from "../../model";
import type { MechanismStore } from "../../store";
import type { StudioState } from "../../uiState/studioStore";

export interface CommitDocumentTargets {
  mechanismStore: MechanismStore;
  studioStore: StoreApi<StudioState>;
  /** Enter Simulate after the commit (the verdict said the mechanism is drivable). */
  simulate: boolean;
}

export function commitImportedDocument(
  doc: MechanismDocument,
  targets: CommitDocumentTargets,
): void {
  const { mechanismStore, studioStore, simulate } = targets;
  const studio = studioStore.getState();
  studio.setMode("build");
  mechanismStore.getState().loadDocument(doc);
  studio.setActiveTool("select");
  studio.clearImportRequest();
  studio.closeDialog();
  if (simulate) studio.setMode("simulate");
}
