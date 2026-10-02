/**
 * Pure contracts every tool state machine implements (no React/Konva/store
 * imports -- purity rule). A machine never touches the store: it turns
 * events into `ToolEffect`s, which `effects.ts` turns into ONE
 * `store.execute()` call per commit. See `machines.ts` for the
 * `ToolId -> ToolMachine` map and `dynamicInput.ts` for the typed
 * length/angle keystroke buffer.
 */

import type { Vec2 } from "../geom";
import type { Id, MechanismDocument, Vec2Tuple } from "../model";
import type { SnapResult } from "../canvas/snapping";
import type { SelectionMode } from "../store/selection";
import type { ToolId } from "./registry";
import type { DynamicInputState } from "./dynamicInput";

/** What a machine's `reduce` can see about the document/selection at event time. */
export interface ToolContext {
  doc: MechanismDocument;
  selection: ReadonlySet<Id>;
  /** World-unit hit/snap radius (already converted from the 8px UX spec). */
  radiusWorld: number;
  /**
   * Identifies ONE pointer gesture (down -> moves -> up). The controller
   * mints a fresh value on every `pointerdown` and never reuses it, so a
   * machine can pass it straight through as a `moveEntities` `gestureId` /
   * history `coalesceKey` -- however many move events a drag produces, they
   * all share this same seed and therefore merge into ONE undo step.
   */
  gestureSeed: string;
}

export type ToolEvent =
  | {
      type: "pointerdown" | "pointermove" | "pointerup";
      world: Vec2;
      snap: SnapResult;
      button: number;
      shift: boolean;
      mod: boolean;
      alt: boolean;
    }
  | { type: "key"; key: string; shift: boolean; mod: boolean; alt: boolean }
  /** Fed back to the machine after `effects.ts` commits, so a machine can
   * learn the ids it just caused to be created (e.g. Bar's chain-continue
   * pin) without ever minting ids itself. */
  | { type: "committed"; linkId?: Id; siteIds: Id[]; createdIds: Id[] }
  | { type: "cancel" };

export type ToolEffect =
  | {
      kind: "commitBar";
      start: Vec2;
      angle: number;
      length: number;
      startSiteId?: Id;
      endSiteId?: Id;
    }
  | { kind: "commitPlate"; vertices: Vec2[]; vertexSiteIds: (Id | undefined)[] }
  | { kind: "commitGroundPivot"; at: Vec2; siteId?: Id }
  | { kind: "commitPin"; siteA: Id; siteB: Id }
  | {
      kind: "commitSlider";
      at: Vec2;
      axisAngle: number;
      siteId?: Id;
      blockHalfSize: number;
    }
  /** Selection changes are never part of undo history (by design). */
  | { kind: "select"; ids: Id[]; mode: SelectionMode }
  | { kind: "clearSelection" }
  /**
   * One gesture's worth of movement. `gestureId` is the drag's `coalesceKey`
   * (see `ToolContext.gestureSeed`): every `moveEntities` effect emitted
   * during the SAME drag shares it, so `history.ts` merges them into ONE
   * undo step no matter how many animation frames the drag spanned.
   */
  | {
      kind: "moveEntities";
      ids: Id[];
      delta: Vec2;
      gestureId: string;
      label: "move-selection" | "move-joint";
    }
  | { kind: "deleteSelection" }
  | { kind: "duplicateSelection"; offset: Vec2 }
  | { kind: "addMotor"; jointId: Id; motorKind: "rotary" | "linear" }
  | { kind: "addMarker"; linkId: Id; local: Vec2Tuple };

export type HintMessage = { key: string; values?: Record<string, string | number> };

export type PreviewShape =
  | { kind: "segment"; a: Vec2; b: Vec2; dashed?: boolean }
  | { kind: "polyline"; points: Vec2[]; closed: boolean }
  | { kind: "rect"; min: Vec2; max: Vec2 }
  | { kind: "ray"; from: Vec2; angle: number }
  | { kind: "point"; at: Vec2 };

export interface ToolReduceResult<S> {
  state: S;
  effects: ToolEffect[];
  /** `true` tells the controller to `preventDefault` a `"key"` event. */
  handled: boolean;
}

export interface ToolMachine<S> {
  id: ToolId;
  initial(): S;
  reduce(state: S, event: ToolEvent, ctx: ToolContext): ToolReduceResult<S>;
  isBusy(state: S): boolean;
  hint(state: S, ctx: ToolContext): HintMessage;
  preview(state: S): PreviewShape[];
  /** The anchor `computeSnap` should use for its angle-ray candidate, if any. */
  snapAnchor(state: S): Vec2 | undefined;
  /**
   * Sites `computeSnap` must skip when resolving a site/midpoint candidate,
   * if any -- e.g. the select tool's joint-drag, so a dragged cluster never
   * snaps back onto its own (stale) position. Optional: only the select
   * tool implements it; every other machine is fine with the default
   * (`undefined`, no exclusion).
   */
  snapExclude?(state: S): ReadonlySet<Id> | undefined;
  dynamicInput(state: S): DynamicInputState | undefined;
}
