/**
 * The thin glue between `CanvasStage`'s pointer events / `window` keydown
 * and the pure `src/tools/*.ts` machines: picks `TOOL_MACHINES[activeTool]`,
 * recomputes the snap with the ACTIVE machine's own anchor (`snapAnchor`,
 * for 15deg angle-snap while drawing), dispatches, applies any resulting
 * effects through `applyToolEffects` (ONE `store.execute()` per effect),
 * feeds a `"committed"` event back so chaining tools (Bar) learn the ids
 * they just caused to be created, and publishes `toolBusy`/`hint`/
 * `snapStatus`/`cursorWorld` to the studio store every dispatch.
 *
 * Lives in `src/tools/react/` (excluded from the pure-logic purity rule,
 * 80/70/75/80 coverage threshold) -- everything it calls into
 * (`TOOL_MACHINES`, `applyToolEffects`, `computeSnap`) stays pure.
 */

import { useEffect, useRef, useState } from "react";
import { useStore, type StoreApi } from "zustand";
import type { Vec2 } from "../../geom";
import type { MechanismStore } from "../../store";
import { selectModalOpen, type StatusHint, type StudioState } from "../../uiState/studioStore";
import type { PreferencesState } from "../../uiState/preferences";
import type { ViewStore } from "../../canvas/viewStore";
import type { CanvasPointerEvent } from "../../canvas/CanvasStage";
import { computeSnap } from "../../canvas/snapping";
import { gridSpacingFor } from "../../canvas/grid";
import { formatNumber, type Language } from "../../i18n/numberFormat";
import { TOOL_MACHINES, type AnyToolMachine } from "../machines";
import { applyToolEffects } from "../effects";
import type { DynamicInputState } from "../dynamicInput";
import type { HintMessage, PreviewShape, ToolContext, ToolEvent } from "../types";
import type { ToolId } from "../registry";

export interface UseToolControllerOptions {
  store: MechanismStore;
  studio: StoreApi<StudioState>;
  preferences: StoreApi<PreferencesState>;
  view: ViewStore;
  /** Translation function; only `tools.defaultNames.*` keys are read. */
  t: (key: string) => string;
  lang: Language;
  /** Injectable for tests: a synchronous `(cb) => { cb(); return 0; }` makes
   * pointermove dispatch immediately instead of on the next animation frame. */
  schedule?: (cb: () => void) => number;
}

export interface DynamicInputOverlay {
  state: DynamicInputState;
  screenAt: Vec2;
}

export interface UseToolControllerResult {
  onPointer: (event: CanvasPointerEvent) => void;
  preview: PreviewShape[];
  dynamicInput?: DynamicInputOverlay;
  cursorWorld: Vec2 | null;
}

interface MachineEntry {
  toolId: ToolId;
  machine: AnyToolMachine;
  state: unknown;
}

interface RenderState {
  preview: PreviewShape[];
  dynamicInput?: DynamicInputOverlay;
  cursorWorld: Vec2 | null;
}

const EMPTY_RENDER_STATE: RenderState = { preview: [], dynamicInput: undefined, cursorWorld: null };

function formatHint(hint: HintMessage, lang: Language): StatusHint {
  if (!hint.values) return { key: hint.key };
  const values: Record<string, string> = {};
  for (const [k, v] of Object.entries(hint.values)) {
    values[k] = typeof v === "number" ? formatNumber(v, lang, 1) : v;
  }
  return { key: hint.key, values };
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  if (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT") {
    return true;
  }
  return target.closest('[role="dialog"]') !== null;
}

export function useToolController(options: UseToolControllerOptions): UseToolControllerResult {
  const { store, studio, preferences, view, t, lang } = options;
  const schedule = options.schedule ?? requestAnimationFrame;
  const activeTool = useStore(studio, (s) => s.activeTool);

  const entryRef = useRef<MachineEntry | null>(null);
  const lastScreenRef = useRef<Vec2>({ x: 0, y: 0 });
  const pendingMoveRef = useRef<CanvasPointerEvent | null>(null);
  const rafRef = useRef<number | null>(null);

  // A fresh, never-reused gesture id per pointerdown (see `ToolContext.gestureSeed`):
  // a mount-unique random prefix + a counter bumped on every pointerdown, never
  // reset on a tool switch. Stable across a drag's moves/up (only pointerdown bumps it).
  // `useState`'s lazy initializer (not a plain render-body call) is the sanctioned
  // place for a one-time impure computation -- it runs exactly once per mount.
  const [gestureMountPrefix] = useState(() => Math.random().toString(36).slice(2));
  const gestureCounterRef = useRef(0);

  const [renderState, setRenderState] = useState<RenderState>(EMPTY_RENDER_STATE);
  const renderStateRef = useRef(renderState);
  useEffect(() => {
    renderStateRef.current = renderState;
  }, [renderState]);

  function buildCtx(): ToolContext {
    return {
      doc: store.getState().document,
      selection: store.getState().selection,
      radiusWorld: 8 / view.getState().viewport.zoom,
      gestureSeed: `${gestureMountPrefix}-${gestureCounterRef.current}`,
    };
  }

  function publish(entry: MachineEntry, screenAt: Vec2, cursorWorld: Vec2 | null): void {
    const ctx = buildCtx();
    studio.getState().setToolBusy(entry.machine.isBusy(entry.state));
    studio.getState().setHint(formatHint(entry.machine.hint(entry.state, ctx), lang));
    const dyn = entry.machine.dynamicInput(entry.state);
    setRenderState({
      preview: entry.machine.preview(entry.state),
      dynamicInput: dyn ? { state: dyn, screenAt } : undefined,
      cursorWorld,
    });
  }

  function dispatch(entry: MachineEntry, event: ToolEvent): boolean {
    const result = entry.machine.reduce(entry.state, event, buildCtx());
    entry.state = result.state;

    if (result.effects.length > 0) {
      const defaultNames = {
        bar: t("tools.defaultNames.bar"),
        plate: t("tools.defaultNames.plate"),
        ground: t("tools.defaultNames.ground"),
        slider: t("tools.defaultNames.slider"),
        marker: t("tools.defaultNames.marker"),
      };
      const results = applyToolEffects(store, result.effects, { defaultNames });
      for (const r of results) {
        const committed = entry.machine.reduce(
          entry.state,
          { type: "committed", linkId: r.linkId, siteIds: r.siteIds, createdIds: r.createdIds },
          buildCtx(),
        );
        entry.state = committed.state;
      }
    }

    return result.handled;
  }

  function handlePointerEvent(event: CanvasPointerEvent): void {
    const entry = entryRef.current;
    if (!entry) return;
    lastScreenRef.current = event.screen;

    if (event.type === "pointerdown") {
      gestureCounterRef.current += 1;
    }

    const anchor = entry.machine.snapAnchor(entry.state);
    const excludeSiteIds = entry.machine.snapExclude?.(entry.state);
    const zoom = view.getState().viewport.zoom;
    const snap = computeSnap(event.world, store.getState().document, {
      radiusWorld: 8 / zoom,
      gridSpacing: gridSpacingFor(zoom),
      anchor,
      enabled: preferences.getState().snapEnabled,
      ...(excludeSiteIds ? { excludeSiteIds } : {}),
    });

    dispatch(entry, {
      type: event.type,
      world: event.world,
      snap,
      button: event.button,
      shift: event.shiftKey,
      mod: event.ctrlKey,
      alt: event.altKey,
    });

    studio.getState().setSnapStatus({
      kind: snap.kind,
      labelKey: `canvas.snap.${snap.kind}`,
      values: { deg: snap.angleDeg !== undefined ? String(Math.round(snap.angleDeg)) : "" },
    });
    studio.getState().setCursorWorld(snap.point);
    publish(entry, event.screen, snap.point);
  }

  function onPointer(event: CanvasPointerEvent): void {
    if (event.type === "pointermove") {
      pendingMoveRef.current = event;
      if (rafRef.current === null) {
        rafRef.current = schedule(() => {
          rafRef.current = null;
          const pending = pendingMoveRef.current;
          pendingMoveRef.current = null;
          if (pending) handlePointerEvent(pending);
        });
      }
      return;
    }

    if (pendingMoveRef.current) {
      const pending = pendingMoveRef.current;
      pendingMoveRef.current = null;
      handlePointerEvent(pending);
    }
    handlePointerEvent(event);
  }

  // Resets the active machine whenever `activeTool` changes: best-effort
  // "cancel" to the outgoing machine (our machines never produce effects
  // from cancel, so this is purely so a mid-gesture machine doesn't leak
  // its drawing state), then a fresh `initial()` for the incoming one.
  useEffect(() => {
    const previous = entryRef.current;
    if (previous && previous.toolId !== activeTool) {
      previous.machine.reduce(previous.state, { type: "cancel" }, buildCtx());
    }
    const machine = TOOL_MACHINES[activeTool];
    const entry: MachineEntry = { toolId: activeTool, machine, state: machine.initial() };
    entryRef.current = entry;
    publish(entry, lastScreenRef.current, null);
    // Re-run only when the active tool changes: `store`/`studio`/`preferences`/
    // `view`/`t`/`lang` are created once per app mount and passed down stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTool]);

  useEffect(() => {
    function onKeyDown(evt: KeyboardEvent): void {
      if (isEditableTarget(evt.target)) return;
      if (selectModalOpen(studio.getState())) return;
      const entry = entryRef.current;
      if (!entry) return;
      const handled = dispatch(entry, {
        type: "key",
        key: evt.key,
        shift: evt.shiftKey,
        mod: evt.ctrlKey || evt.metaKey,
        alt: evt.altKey,
      });
      publish(entry, lastScreenRef.current, renderStateRef.current.cursorWorld);
      if (handled) evt.preventDefault();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [studio]);

  return {
    onPointer,
    preview: renderState.preview,
    dynamicInput: renderState.dynamicInput,
    cursorWorld: renderState.cursorWorld,
  };
}
