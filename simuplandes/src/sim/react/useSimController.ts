/**
 * `useSimController`: Simulate mode's counterpart to
 * `src/tools/react/useToolController`. It is the canvas pointer handler
 * `CanvasArea` routes to while `mode === "simulate"`.
 *
 * It is READ-ONLY with respect to the mechanism document: it never calls
 * `mechanismStore`'s `execute`/command actions, only `runtime.beginDrag`/
 * `dragTo`/`endDrag` (05-04's drag-to-drive orchestration, SIM-03).
 *
 * Research Pitfall 1: a drag must grab what's actually drawn. After
 * scrubbing (or mid-play), the document's own `link.pose` is stale -- the
 * canvas renders `simStore`'s posed geometry instead. So every pointerdown
 * hit-tests via `hitTest(doc, world, radius, { poses: simStore.getState().poses
 * })`, exactly mirroring how `CanvasStage`/`applyRenderModelToLayers` draw
 * the mechanism. A controller that hit-tested the reference pose would grab
 * nothing (or the wrong thing) the moment the mechanism has moved.
 *
 * `e.world` (not `e.snap.point`) drives the whole gesture: snapping to a
 * grid/site would quantize drag-to-drive input, which the plan explicitly
 * forbids.
 */

import { useRef } from "react";
import type { StoreApi } from "zustand";
import { hitTest, type HitResult } from "../../canvas/hitTest";
import type { CanvasPointerEvent } from "../../canvas/CanvasStage";
import type { ViewStore } from "../../canvas/viewStore";
import { indexDocument, type Id, type MechanismDocument } from "../../model";
import type { MechanismStore } from "../../store";
import type { StudioState } from "../../uiState/studioStore";
import type { SimStore } from "../simStore";
import type { SimRuntime } from "../runtime";

export interface UseSimControllerOptions {
  mechanismStore: MechanismStore;
  studio: StoreApi<StudioState>;
  simStore: SimStore;
  runtime: SimRuntime;
  view: ViewStore;
}

export interface UseSimControllerResult {
  onPointer: (event: CanvasPointerEvent) => void;
}

/**
 * Maps a `HitResult` to the moving link it should drag, or `null` for "no
 * drag" (empty space, ground, or a hit that only resolves to ground):
 * - `link` -> itself (`hitTest` never returns a ground body as `"link"`).
 * - `marker` -> the marker's owning link.
 * - `joint` -> the NON-ground link among the joint's two sites (dragging a
 *   crank pinned to ground must move the crank, not do nothing).
 * - `site` -> its link, unless that link is ground.
 * - `none` -> `null`.
 */
function resolveDragLinkId(doc: MechanismDocument, hit: HitResult): Id | null {
  switch (hit.kind) {
    case "link":
      return hit.linkId;
    case "marker": {
      const marker = doc.markers.find((m) => m.id === hit.markerId);
      return marker ? marker.linkId : null;
    }
    case "joint": {
      // `hit.siteId` is one of the joint's two sites; resolve BOTH sites via
      // the joint itself so the non-ground one can be picked regardless of
      // which side `hitTest` happened to report.
      const index = indexDocument(doc);
      const joint = index.joints.get(hit.jointId);
      if (!joint) return null;
      const entryA = index.sites.get(joint.siteA);
      const entryB = index.sites.get(joint.siteB);
      if (entryA && !entryA.link.isGround) return entryA.link.id;
      if (entryB && !entryB.link.isGround) return entryB.link.id;
      return null;
    }
    case "site": {
      const index = indexDocument(doc);
      const entry = index.sites.get(hit.siteId);
      if (!entry || entry.link.isGround) return null;
      return entry.link.id;
    }
    case "none":
      return null;
  }
}

/** `useSimController(opts)`: `{ onPointer }`, the drag-to-drive pointer handler for Simulate mode's `CanvasStage`. */
export function useSimController(opts: UseSimControllerOptions): UseSimControllerResult {
  const { mechanismStore, studio, simStore, runtime, view } = opts;
  const dragRef = useRef({ active: false });

  function onPointer(event: CanvasPointerEvent): void {
    if (event.type === "pointerdown") {
      dragRef.current.active = false;
      if (event.button !== 0) return;
      if (studio.getState().activeTool !== "select") return;

      const doc = mechanismStore.getState().document;
      const zoom = view.getState().viewport.zoom;
      const poses = simStore.getState().poses;
      const hit = hitTest(doc, event.world, 8 / zoom, { poses });
      const linkId = resolveDragLinkId(doc, hit);
      if (linkId === null) return;

      dragRef.current.active = runtime.beginDrag({ linkId, world: event.world });
      return;
    }

    if (event.type === "pointermove") {
      if (!dragRef.current.active) return;
      runtime.dragTo(event.world);
      return;
    }

    // pointerup
    if (!dragRef.current.active) return;
    dragRef.current.active = false;
    runtime.endDrag();
  }

  return { onPointer };
}
