/**
 * The react-konva `Stage` + layer stack, pointer/wheel wiring, and the
 * status-bar cursor/snap publish. Layers (in paint order): grid, traces
 * (only when `traces?.length`), links, joints, overlays (+ `children`,
 * 04-04's live-draw previews), rulers.
 *
 * Every child shape is `listening={false}` -- only the `Stage` receives
 * pointer events (`hitTest`/`snapping` are the single source of truth for
 * "what's under the cursor", never Konva's own hit-graph).
 *
 * **The Phase 5 two-path rendering design** (research Pitfall/default 6):
 * - React renders STRUCTURE -- it re-runs `buildRenderModel` and re-mounts
 *   Konva nodes only when `doc`, `selection`, `viewport` or the theme
 *   change. `posesSource?.get()` is read at render time too, so any React
 *   re-render (for any of the reasons above) always shows the CURRENT posed
 *   geometry, never a stale reference pose.
 * - `posesSource` repositions the EXISTING nodes imperatively, every
 *   simulation frame, via `applyRenderModelToLayers` -- no React re-render
 *   per frame. `posesSource.get() === null` means "render the document's
 *   reference poses" (Build mode, or Simulate mode before the first solve).
 */

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Stage } from "react-konva";
import type Konva from "konva";
import { useStore, type StoreApi } from "zustand";
import { useTheme } from "@mui/material";
import { useHotkeys } from "react-hotkeys-hook";
import type { Vec2 } from "../geom";
import { indexDocument, type Id, type MechanismDocument, type Pose } from "../model";
import type { MechanismStore } from "../store";
import type { StudioState } from "../uiState/studioStore";
import type { PreferencesState } from "../uiState/preferences";
import { canvasTokensFor } from "../ui/theme/studioTheme";
import type { ViewStore } from "./viewStore";
import { screenToWorld, type Viewport } from "./viewport";
import { computeSnap, type SnapResult } from "./snapping";
import { gridSpacingFor } from "./grid";
import { buildRenderModel } from "./renderModel";
import { hitTest } from "./hitTest";
import type { PosesSource, TracePrimitive } from "./posesSource";
import { GridLayer } from "./layers/GridLayer";
import { LinksLayer } from "./layers/LinksLayer";
import { JointsLayer } from "./layers/JointsLayer";
import { OverlaysLayer } from "./layers/OverlaysLayer";
import { RulersLayer } from "./layers/RulersLayer";
import { TracesLayer } from "./layers/TracesLayer";
import { applyRenderModelToLayers } from "./layers/applyRenderModel";
import { installCanvasTestHook } from "./layers/canvasTestHook";

export interface CanvasPointerEvent {
  type: "pointerdown" | "pointermove" | "pointerup";
  screen: Vec2;
  world: Vec2;
  snap: SnapResult;
  button: number;
  shiftKey: boolean;
  /** `ctrlKey || metaKey` (Cmd on macOS behaves like Ctrl elsewhere). */
  ctrlKey: boolean;
  altKey: boolean;
}

export interface CanvasStageProps {
  store: MechanismStore;
  studio: StoreApi<StudioState>;
  preferences: StoreApi<PreferencesState>;
  view: ViewStore;
  width: number;
  height: number;
  /** Extra overlay content (live-draw previews) -- 04-04's tool controller slot. */
  children?: ReactNode;
  onPointer?: (event: CanvasPointerEvent) => void;
  /**
   * Phase 5 seam: when provided, its current poses render instead of the
   * document's reference poses, and its `subscribe` firing repositions the
   * links/joints layers imperatively (no React re-render). Undefined in
   * Build mode.
   */
  posesSource?: PosesSource;
  /** Coupler-curve polylines (SIM-04), painted below the links layer. */
  traces?: readonly TracePrimitive[];
  /** GRF-03 seam: link ids flagged by the graph panel's Baranov check, drawn with an issue outline. */
  issueLinkIds?: ReadonlySet<Id>;
}

interface PendingPointer {
  type: CanvasPointerEvent["type"];
  screen: Vec2;
  button: number;
  shiftKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
}

export function CanvasStage({
  store,
  studio,
  preferences,
  view,
  width,
  height,
  children,
  onPointer,
  posesSource,
  traces,
  issueLinkIds,
}: CanvasStageProps): ReactNode {
  const theme = useTheme();
  const tokens = canvasTokensFor(theme.palette.mode === "dark" ? "dark" : "light");

  const doc = useStore(store, (s) => s.document);
  const selection = useStore(store, (s) => s.selection);
  const activeTool = useStore(studio, (s) => s.activeTool);
  const toolBusy = useStore(studio, (s) => s.toolBusy);
  const hoveredId = useStore(studio, (s) => s.hoveredId);
  const gridVisible = useStore(preferences, (s) => s.gridVisible);
  const snapEnabled = useStore(preferences, (s) => s.snapEnabled);
  const language = useStore(preferences, (s) => s.language);
  const viewport = useStore(view, (s) => s.viewport);

  const poses: ReadonlyMap<Id, Pose> | undefined = posesSource?.get() ?? undefined;
  const renderModel = useMemo(
    () => buildRenderModel(doc, selection, { poses, hoverId: hoveredId, issueLinkIds }),
    [doc, selection, poses, hoveredId, issueLinkIds],
  );
  const [displaySnap, setDisplaySnap] = useState<SnapResult | null>(null);

  const panRef = useRef({ active: false, lastClientX: 0, lastClientY: 0 });
  const pendingRef = useRef<PendingPointer | null>(null);
  // Tracks whether the CANVAS's own hit-test is the current source of
  // `studio.hoveredId` (set true only when `flush()`'s pointermove hit-test
  // resolves to a real entity, false once it resolves to nothing). Gates
  // `onPointerLeave` below: a leave must only clear a hover the canvas
  // itself owns, never one set by an unrelated hover source (e.g. the graph
  // panel's `GraphSvg`, GRF-02) -- otherwise a stray `pointerleave` (which
  // fires the moment the pointer's very first movement carries it away from
  // wherever it started, even if it never meaningfully "hovered" the canvas)
  // would race and clobber a graph-node hover the instant after it's set.
  const canvasHoverActiveRef = useRef(false);
  const rafRef = useRef<number | null>(null);

  // Mirrors of the latest doc/selection/viewport/hoveredId/issueLinkIds,
  // read by the imperative `posesSource.subscribe` callback below (which
  // fires outside React's render cycle, so it cannot close over stale
  // render-time values). Synced in an effect (never written during render --
  // see `react-hooks/refs`).
  const docRef = useRef<MechanismDocument>(doc);
  const selectionRef = useRef(selection);
  const viewportRef = useRef<Viewport>(viewport);
  const hoveredIdRef = useRef<Id | null>(hoveredId);
  const issueLinkIdsRef = useRef<ReadonlySet<Id> | undefined>(issueLinkIds);
  useEffect(() => {
    docRef.current = doc;
    selectionRef.current = selection;
    viewportRef.current = viewport;
    hoveredIdRef.current = hoveredId;
    issueLinkIdsRef.current = issueLinkIds;
  }, [doc, selection, viewport, hoveredId, issueLinkIds]);

  const linksLayerRef = useRef<Konva.Layer | null>(null);
  const jointsLayerRef = useRef<Konva.Layer | null>(null);
  const stageRef = useRef<Konva.Stage | null>(null);

  useEffect(() => {
    if (!posesSource) return undefined;
    return posesSource.subscribe(() => {
      const model = buildRenderModel(docRef.current, selectionRef.current, {
        poses: posesSource.get() ?? undefined,
        hoverId: hoveredIdRef.current,
        issueLinkIds: issueLinkIdsRef.current,
      });
      applyRenderModelToLayers(
        { links: linksLayerRef.current, joints: jointsLayerRef.current },
        model,
        viewportRef.current,
      );
    });
  }, [posesSource]);

  // The literal `if (import.meta.env.DEV)` guard here (rather than relying
  // solely on `installCanvasTestHook`'s own internal `dev` default) is what
  // lets `vite build`'s dead-code elimination actually drop the whole call
  // (and therefore the otherwise-always-referenced `installCanvasTestHook`
  // module) from the production bundle -- confirmed by grepping
  // `dist/assets/*.js` for `__simuplandesCanvas` after `npm run build`. A
  // bare default-parameter gate inside the callee is NOT enough for this
  // toolchain to eliminate the call (see `src/sim/react/testHook.ts`'s own
  // `__simuplandesSim` leak, `05-simulate-mode/deferred-items.md`).
  useEffect(() => {
    if (!import.meta.env.DEV) return undefined;
    return installCanvasTestHook(() => stageRef.current);
  }, []);

  function flush(): void {
    rafRef.current = null;
    const pending = pendingRef.current;
    if (!pending) return;
    pendingRef.current = null;

    const world = screenToWorld(viewport, pending.screen);
    const gridSpacing = gridSpacingFor(viewport.zoom);
    const snap = computeSnap(world, doc, {
      radiusWorld: 8 / viewport.zoom,
      gridSpacing,
      enabled: snapEnabled,
    });
    setDisplaySnap(snap);

    const index = indexDocument(doc);
    const link = snap.linkId ? index.links.get(snap.linkId) : undefined;
    const site = snap.siteId ? index.sites.get(snap.siteId) : undefined;

    if (pending.type === "pointermove" && !panRef.current.active) {
      const hit = hitTest(doc, world, 8 / viewport.zoom, { poses });
      const hoverId =
        hit.kind === "joint"
          ? hit.jointId
          : hit.kind === "link" || hit.kind === "site"
            ? hit.linkId
            : null;
      studio.getState().setHoveredId(hoverId);
      canvasHoverActiveRef.current = hoverId !== null;
    }

    studio.getState().setCursorWorld(snap.point);
    studio.getState().setSnapStatus({
      kind: snap.kind,
      labelKey: `canvas.snap.${snap.kind}`,
      values: {
        link: link?.name || link?.id || "",
        site: site?.site.name || site?.site.id || "",
        deg: snap.angleDeg !== undefined ? String(Math.round(snap.angleDeg)) : "",
      },
    });

    onPointer?.({
      type: pending.type,
      screen: pending.screen,
      world,
      snap,
      button: pending.button,
      shiftKey: pending.shiftKey,
      ctrlKey: pending.ctrlKey,
      altKey: pending.altKey,
    });
  }

  function schedule(
    type: CanvasPointerEvent["type"],
    evt: Konva.KonvaEventObject<PointerEvent>,
  ): void {
    const stage = evt.target.getStage();
    const pointer = stage?.getPointerPosition();
    if (!pointer) return;
    pendingRef.current = {
      type,
      screen: { x: pointer.x, y: pointer.y },
      button: evt.evt.button,
      shiftKey: evt.evt.shiftKey,
      ctrlKey: evt.evt.ctrlKey || evt.evt.metaKey,
      altKey: evt.evt.altKey,
    };
    if (rafRef.current === null) {
      rafRef.current = requestAnimationFrame(flush);
    }
  }

  function handlePointerDown(evt: Konva.KonvaEventObject<PointerEvent>): void {
    const isMiddleDrag = evt.evt.button === 1;
    const isPanToolDrag = activeTool === "pan" && evt.evt.button === 0;
    if (isMiddleDrag || isPanToolDrag) {
      panRef.current = {
        active: true,
        lastClientX: evt.evt.clientX,
        lastClientY: evt.evt.clientY,
      };
    }
    schedule("pointerdown", evt);
  }

  function handlePointerMove(evt: Konva.KonvaEventObject<PointerEvent>): void {
    if (panRef.current.active) {
      const dx = evt.evt.clientX - panRef.current.lastClientX;
      const dy = evt.evt.clientY - panRef.current.lastClientY;
      panRef.current.lastClientX = evt.evt.clientX;
      panRef.current.lastClientY = evt.evt.clientY;
      view.getState().panByScreen({ dx, dy });
    }
    schedule("pointermove", evt);
  }

  function handlePointerUp(evt: Konva.KonvaEventObject<PointerEvent>): void {
    panRef.current.active = false;
    schedule("pointerup", evt);
  }

  function handleWheel(evt: Konva.KonvaEventObject<WheelEvent>): void {
    evt.evt.preventDefault();
    const stage = evt.target.getStage();
    const pointer = stage?.getPointerPosition();
    if (!pointer) return;
    const factor = Math.pow(1.1, -evt.evt.deltaY / 100);
    view.getState().zoomAtScreen({ x: pointer.x, y: pointer.y }, factor);
  }

  useHotkeys(
    "f",
    () => {
      view.getState().fitDocument(doc);
    },
    { enabled: !toolBusy, enableOnFormTags: false, preventDefault: true },
    [doc, toolBusy],
  );

  return (
    <Stage
      ref={stageRef}
      width={width}
      height={height}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerLeave={() => {
        if (canvasHoverActiveRef.current) {
          studio.getState().setHoveredId(null);
          canvasHoverActiveRef.current = false;
        }
      }}
      onWheel={handleWheel}
      onContextMenu={(evt) => evt.evt.preventDefault()}
    >
      <GridLayer viewport={viewport} tokens={tokens} visible={gridVisible} />
      {traces && traces.length > 0 && (
        <TracesLayer viewport={viewport} tokens={tokens} traces={traces} />
      )}
      <LinksLayer
        ref={linksLayerRef}
        viewport={viewport}
        tokens={tokens}
        bars={renderModel.bars}
        plates={renderModel.plates}
      />
      <JointsLayer ref={jointsLayerRef} viewport={viewport} tokens={tokens} model={renderModel} />
      <OverlaysLayer viewport={viewport} tokens={tokens} snap={displaySnap}>
        {children}
      </OverlaysLayer>
      <RulersLayer viewport={viewport} tokens={tokens} language={language} />
    </Stage>
  );
}
