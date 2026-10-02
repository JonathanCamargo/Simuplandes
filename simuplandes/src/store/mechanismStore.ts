/**
 * `createMechanismStore(options)`: a vanilla Zustand store whose ONLY
 * mutation path is `execute(label, recipe)`. It runs the given recipe(s) in
 * one Immer `produceWithPatches` call and records one `{patches,
 * inversePatches}` history entry per call (batching multi-object edits into
 * a single undo step). Undo/redo and selection are built on top; selection
 * is never part of history (see `selection.ts`).
 */

import { createStore, type StoreApi } from "zustand/vanilla";
import { produceWithPatches, type Draft } from "immer";
import {
  createEmptyDocument,
  createId,
  collectIds,
  MechanismDocumentSchema,
  type MechanismDocument,
  type EntityKind,
  type Id,
  type LengthUnit,
} from "../model";
import type { Vec2 } from "../geom";
import { createHistory, DEFAULT_HISTORY_LIMIT } from "./history";
import {
  addLink as addLinkRecipe,
  addJoint as addJointRecipe,
  addMotor as addMotorRecipe,
  addMarker as addMarkerRecipe,
  addLoad as addLoadRecipe,
  moveEntities as moveEntitiesRecipe,
  deleteEntities as deleteEntitiesRecipe,
  CommandError,
  type Recipe,
  type LinkInput,
  type SiteInput,
  type JointInput,
  type MotorInput,
  type MarkerInput,
  type LoadInput,
} from "./commands";
import { applySelection, pruneSelection, type SelectionMode } from "./selection";

/** `Omit` that distributes over a union, keeping the R/P `JointInput` discriminant. */
type DistributiveOmit<T, K extends keyof T> = T extends unknown ? Omit<T, K> : never;

export interface MechanismStoreOptions {
  /** Starting document. Defaults to a new empty document. */
  initialDocument?: MechanismDocument;
  /** Mints ids for the convenience actions (`addLink`, `addJoint`, ...). Defaults to `createId`. */
  idFactory?: (kind: EntityKind) => Id;
  /** Undo/redo stack cap. Defaults to `DEFAULT_HISTORY_LIMIT` (500). */
  historyLimit?: number;
  /** When true, `execute()` schema-validates the result and rejects invalid documents. Defaults to false. */
  validate?: boolean;
}

export interface ExecuteOptions {
  /** Identifies one interaction; consecutive executes sharing this key merge into one history entry. */
  coalesceKey?: string;
}

export interface MechanismState {
  document: MechanismDocument;
  selection: ReadonlySet<Id>;
  canUndo: boolean;
  canRedo: boolean;
  undoLabel: string | null;
  redoLabel: string | null;

  /** The one mutation path: runs `recipe` (or all recipes in order) in a single Immer pass. Returns false on a no-op. */
  execute(label: string, recipe: Recipe | readonly Recipe[], options?: ExecuteOptions): boolean;
  undo(): boolean;
  redo(): boolean;
  /** Replaces the document wholesale. Not undoable; clears history and selection. */
  loadDocument(doc: MechanismDocument): void;
  newDocument(options?: { name?: string; lengthUnit?: LengthUnit }): void;

  select(ids: Iterable<Id>, mode?: SelectionMode): void;
  clearSelection(): void;

  newId(kind: EntityKind): Id;
  addLink(input: Omit<LinkInput, "id" | "sites"> & { sites: Omit<SiteInput, "id">[] }): {
    linkId: Id;
    siteIds: Id[];
  };
  addJoint(input: DistributiveOmit<JointInput, "id">): Id;
  addMotor(input: Omit<MotorInput, "id">): Id;
  addMarker(input: Omit<MarkerInput, "id">): Id;
  addLoad(input: Omit<LoadInput, "id">): Id;

  moveSelection(delta: Vec2, options?: ExecuteOptions): boolean;
  deleteSelection(): boolean;
}

export type MechanismStore = StoreApi<MechanismState>;

/** Creates a new, isolated mechanism store (own document, history, and selection). */
export function createMechanismStore(options?: MechanismStoreOptions): MechanismStore {
  const idFactory = options?.idFactory ?? createId;
  const validate = options?.validate ?? false;
  const history = createHistory<MechanismDocument>({
    limit: options?.historyLimit ?? DEFAULT_HISTORY_LIMIT,
  });
  const initialDocument = options?.initialDocument ?? createEmptyDocument();

  return createStore<MechanismState>()((set, get) => {
    function historyStatus(): Pick<
      MechanismState,
      "canUndo" | "canRedo" | "undoLabel" | "redoLabel"
    > {
      return {
        canUndo: history.canUndo,
        canRedo: history.canRedo,
        undoLabel: history.undoLabel,
        redoLabel: history.redoLabel,
      };
    }

    function withPrunedSelection(doc: MechanismDocument): ReadonlySet<Id> {
      return pruneSelection(get().selection, collectIds(doc));
    }

    function execute(
      label: string,
      recipe: Recipe | readonly Recipe[],
      execOptions?: ExecuteOptions,
    ): boolean {
      const recipes: readonly Recipe[] = Array.isArray(recipe) ? recipe : [recipe];
      const base = get().document;
      const [next, patches, inversePatches] = produceWithPatches(
        base,
        (draft: Draft<MechanismDocument>) => {
          for (const r of recipes) r(draft);
        },
      );
      if (patches.length === 0) {
        return false;
      }
      if (validate) {
        const result = MechanismDocumentSchema.safeParse(next);
        if (!result.success) {
          const issue = result.error.issues[0];
          const path = issue ? issue.path.join(".") : "";
          const message = issue ? issue.message : "invalid document";
          throw new CommandError(`${path}: ${message}`);
        }
      }
      history.record({
        label,
        patches,
        inversePatches,
        ...(execOptions?.coalesceKey !== undefined ? { coalesceKey: execOptions.coalesceKey } : {}),
      });
      set({
        document: next,
        selection: withPrunedSelection(next),
        ...historyStatus(),
      });
      return true;
    }

    function undo(): boolean {
      const next = history.undo(get().document);
      if (next === null) return false;
      set({
        document: next,
        selection: withPrunedSelection(next),
        ...historyStatus(),
      });
      return true;
    }

    function redo(): boolean {
      const next = history.redo(get().document);
      if (next === null) return false;
      set({
        document: next,
        selection: withPrunedSelection(next),
        ...historyStatus(),
      });
      return true;
    }

    function loadDocument(doc: MechanismDocument): void {
      history.clear();
      set({
        document: doc,
        selection: new Set<Id>(),
        ...historyStatus(),
      });
    }

    function newDocument(newOptions?: { name?: string; lengthUnit?: LengthUnit }): void {
      loadDocument(createEmptyDocument(newOptions));
    }

    function select(ids: Iterable<Id>, mode: SelectionMode = "replace"): void {
      const next = applySelection(get().selection, ids, mode, collectIds(get().document));
      set({ selection: next });
    }

    function clearSelection(): void {
      set({ selection: new Set<Id>() });
    }

    function newId(kind: EntityKind): Id {
      return idFactory(kind);
    }

    function addLink(input: Omit<LinkInput, "id" | "sites"> & { sites: Omit<SiteInput, "id">[] }): {
      linkId: Id;
      siteIds: Id[];
    } {
      const linkId = idFactory("link");
      const siteIds = input.sites.map(() => idFactory("site"));
      const fullInput: LinkInput = {
        ...input,
        id: linkId,
        sites: input.sites.map((site, i) => ({ ...site, id: siteIds[i] })),
      };
      execute("add-link", addLinkRecipe(fullInput));
      return { linkId, siteIds };
    }

    function addJoint(input: DistributiveOmit<JointInput, "id">): Id {
      const jointId = idFactory("joint");
      const fullInput: JointInput = { ...input, id: jointId };
      execute("add-joint", addJointRecipe(fullInput));
      return jointId;
    }

    function addMotor(input: Omit<MotorInput, "id">): Id {
      const motorId = idFactory("motor");
      execute("add-motor", addMotorRecipe({ ...input, id: motorId }));
      return motorId;
    }

    function addMarker(input: Omit<MarkerInput, "id">): Id {
      const markerId = idFactory("marker");
      execute("add-marker", addMarkerRecipe({ ...input, id: markerId }));
      return markerId;
    }

    function addLoad(input: Omit<LoadInput, "id">): Id {
      const loadId = idFactory("load");
      execute("add-load", addLoadRecipe({ ...input, id: loadId }));
      return loadId;
    }

    function moveSelection(delta: Vec2, execOptions?: ExecuteOptions): boolean {
      return execute("move-selection", moveEntitiesRecipe(get().selection, delta), execOptions);
    }

    function deleteSelection(): boolean {
      return execute("delete-selection", deleteEntitiesRecipe(get().selection));
    }

    return {
      document: initialDocument,
      selection: new Set<Id>(),
      canUndo: false,
      canRedo: false,
      undoLabel: null,
      redoLabel: null,
      execute,
      undo,
      redo,
      loadDocument,
      newDocument,
      select,
      clearSelection,
      newId,
      addLink,
      addJoint,
      addMotor,
      addMarker,
      addLoad,
      moveSelection,
      deleteSelection,
    };
  });
}
