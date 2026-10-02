/**
 * The canvas surface: measures its box (`ResizeObserver` -> `view.setSize`),
 * owns (or receives) a `ViewStore` exposed via `ViewStoreContext` so 04-04
 * and 04-06 ("Zoom to fit" in the command palette) can reach it, renders the
 * real `CanvasStage`, a localized "Fit" button, and a `data-viewport`
 * attribute (JSON of the current viewport) as a test affordance for 04-06's
 * E2E suite.
 *
 * Auto-fits on mount when the document is non-empty, and again whenever
 * `loadDocument`/`newDocument` replaces the document outright (detected as
 * a document-identity change with a reset history: `canUndo`/`canRedo`
 * both false).
 */

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useStore, type StoreApi } from "zustand";
import { Box, IconButton, Tooltip, useTheme } from "@mui/material";
// esm/ subpath, as in TopBar.tsx: the root CJS file breaks under Vite 8.
// An icon rather than the "⛶" glyph, which Roboto lacks.
import ZoomOutMapIcon from "@mui/icons-material/esm/ZoomOutMap";
import { useTranslation } from "react-i18next";
import type { MechanismDocument } from "../../model";
import type { MechanismStore } from "../../store";
import type { StudioState } from "../../uiState/studioStore";
import type { PreferencesState } from "../../uiState/preferences";
import { createViewStore, type ViewStore } from "../../canvas/viewStore";
import { CanvasStage } from "../../canvas/CanvasStage";
import type { PosesSource, TracePrimitive } from "../../canvas/posesSource";
import { ToolPreview } from "../../canvas/layers/ToolPreview";
import { canvasTokensFor } from "../theme/studioTheme";
import { useToolController } from "../../tools/react/useToolController";
import { DynamicInputBadge } from "../../tools/react/DynamicInputBadge";
// `CanvasArea` (src/ui) is the seam's UI half: it may import `src/sim`
// TYPES/stores (poses/readout), but `src/canvas` itself never imports
// `src/sim` -- see `src/canvas/posesSource.ts`'s own TSDoc.
import { createSimStore, type SimStore } from "../../sim/simStore";
import type { SimRuntime } from "../../sim/runtime";
import { useSimController } from "../../sim/react/useSimController";
import { getGraphAnalysis } from "../../graph";
import { EmptyState } from "../gallery/EmptyState";
import { ExamplesGallery } from "../gallery/ExamplesGallery";

/** A stable, never-mutated fallback so `useStore` is always called with a real store (no conditional hook call) when `sim` is undefined (Build-only callers/tests). */
const EMPTY_SIM_STORE_FOR_TRACES: SimStore = createSimStore();

/** A stable, inert fallback `SimRuntime` so `useSimController` (rules of hooks: called
 * unconditionally) has something real to hold onto when `sim` is undefined (Build-only
 * callers/tests). Every method is a no-op; `useSimController`'s own `activeTool`/mode guard
 * means it's never actually invoked in Build mode anyway. */
const NOOP_SIM_RUNTIME_FOR_BUILD_MODE: SimRuntime = {
  enter() {},
  exit() {},
  documentChanged() {},
  play() {},
  pause() {},
  togglePlay() {},
  step() {},
  reset() {},
  setSpeed() {},
  setLoop() {},
  scrubTo() {},
  beginDrag: () => false,
  dragTo() {},
  endDrag() {},
  getHistoryTable: () => null,
  snapshot: () => null,
  dispose() {},
};

/** A stable `PosesSource` view over `simStore`: `get()` reads the per-frame poses imperatively; `subscribe` fires only when `poses` itself changes identity. */
function createPosesSource(simStore: SimStore): PosesSource {
  return {
    get: () => simStore.getState().poses,
    subscribe: (listener) =>
      simStore.subscribe((state, prevState) => {
        if (state.poses !== prevState.poses) listener();
      }),
  };
}

// eslint-disable-next-line react-refresh/only-export-components -- context/hook live next to their provider component per the plan (04-04/04-06 both import from here).
export const ViewStoreContext = createContext<ViewStore | null>(null);

/** The current `CanvasArea`'s `ViewStore` -- throws outside a `CanvasArea` subtree. */
// eslint-disable-next-line react-refresh/only-export-components
export function useViewStore(): ViewStore {
  const view = useContext(ViewStoreContext);
  if (!view) {
    throw new Error("useViewStore must be used within a CanvasArea");
  }
  return view;
}

export interface CanvasAreaProps {
  store: MechanismStore;
  studio: StoreApi<StudioState>;
  preferences: StoreApi<PreferencesState>;
  /** Reuse an externally-owned view store; defaults to one created for this mount. */
  view?: ViewStore;
  /** Phase 5 seam: when provided, Simulate mode reads posed geometry/traces from it and blocks tool edits. Undefined callers/tests keep Phase 4 (Build-only) behavior exactly. */
  sim?: { store: SimStore; runtime: SimRuntime };
}

export function CanvasArea({
  store,
  studio,
  preferences,
  view: viewProp,
  sim,
}: CanvasAreaProps): ReactNode {
  const { t } = useTranslation();
  const theme = useTheme();
  const tokens = canvasTokensFor(theme.palette.mode === "dark" ? "dark" : "light");
  // Lazy `useState` initializer (not a ref read during render) so a view
  // store is created exactly once per mount when the caller doesn't pass one.
  const [ownView] = useState<ViewStore>(() => createViewStore());
  const view = viewProp ?? ownView;

  const containerRef = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const viewport = useStore(view, (s) => s.viewport);
  const language = useStore(preferences, (s) => s.language);
  const controller = useToolController({ store, studio, preferences, view, t, lang: language });
  const fitRequest = useStore(studio, (s) => s.fitRequest);
  const mode = useStore(studio, (s) => s.mode);
  const isSimulate = mode === "simulate" && !!sim;
  // GRF-03: the canvas highlights the same Baranov-offending links the graph
  // panel does. `getGraphAnalysis` is memoized by document identity (shared
  // WeakMap with `GraphPanel`), so this is never a second real computation.
  const doc = useStore(store, (s) => s.document);
  const issueLinkIds = useMemo(() => getGraphAnalysis(doc).issueLinkIds, [doc]);

  const posesSource = useMemo(() => (sim ? createPosesSource(sim.store) : undefined), [sim]);
  const simTraces = useStore(sim?.store ?? EMPTY_SIM_STORE_FOR_TRACES, (s) => s.traces);
  // Called unconditionally (rules of hooks): falls back to an inert store/runtime pair when
  // `sim` is undefined (Build-only callers/tests), and its `onPointer` is only ever routed to
  // below when `isSimulate` is true.
  const simController = useSimController({
    mechanismStore: store,
    studio,
    simStore: sim?.store ?? EMPTY_SIM_STORE_FOR_TRACES,
    runtime: sim?.runtime ?? NOOP_SIM_RUNTIME_FOR_BUILD_MODE,
    view,
  });
  const traces: readonly TracePrimitive[] | undefined = isSimulate
    ? simTraces.map((trace) => ({
        markerId: trace.markerId,
        points: trace.points,
        closed: trace.closed,
      }))
    : undefined;
  const prevDocumentRef = useRef<MechanismDocument | null>(null);
  // Guards the mount-time auto-fit so it runs exactly once, against the
  // FIRST real (non-zero) size measurement -- fitting against the view
  // store's initial 0x0 size (a race between this effect and the
  // ResizeObserver's first callback) would compute a garbage near-zero zoom.
  const hasAutoFittedRef = useRef(false);

  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      const { width, height } = entry.contentRect;
      setSize({ width, height });
      view.getState().setSize(width, height);
      if (!hasAutoFittedRef.current && width > 0 && height > 0) {
        hasAutoFittedRef.current = true;
        const initialDocument = store.getState().document;
        if (initialDocument.links.length > 0) {
          view.getState().fitDocument(initialDocument);
        }
      }
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [store, view]);

  useEffect(() => {
    prevDocumentRef.current = store.getState().document;

    return store.subscribe((state) => {
      const isFreshDocument =
        state.document !== prevDocumentRef.current && !state.canUndo && !state.canRedo;
      prevDocumentRef.current = state.document;
      if (isFreshDocument) {
        view.getState().fitDocument(state.document);
      }
    });
  }, [store, view]);

  // "Zoom to fit" (command palette's `view:fit` command, or a future `F`
  // hotkey): `fitRequest` only ever increments, so any change (never the
  // initial mount at 0) re-fits the CURRENT document -- not just on load.
  const isFirstFitRequestRender = useRef(true);
  useEffect(() => {
    if (isFirstFitRequestRender.current) {
      isFirstFitRequestRender.current = false;
      return;
    }
    view.getState().fitDocument(store.getState().document);
  }, [fitRequest, store, view]);

  return (
    <ViewStoreContext.Provider value={view}>
      <Box
        ref={containerRef}
        component="main"
        data-testid="canvas-area"
        tabIndex={0}
        data-viewport={JSON.stringify(viewport)}
        sx={{
          height: "100%",
          width: "100%",
          position: "relative",
          bgcolor: "background.paper",
          outline: "none",
          overflow: "hidden",
        }}
      >
        {size.width > 0 && size.height > 0 && (
          <CanvasStage
            store={store}
            studio={studio}
            preferences={preferences}
            view={view}
            width={size.width}
            height={size.height}
            onPointer={isSimulate ? simController.onPointer : controller.onPointer}
            posesSource={isSimulate ? posesSource : undefined}
            traces={traces}
            issueLinkIds={issueLinkIds}
          >
            {isSimulate ? null : (
              <ToolPreview
                viewport={viewport}
                tokens={tokens}
                language={language}
                shapes={controller.preview}
              />
            )}
          </CanvasStage>
        )}
        {isSimulate ? null : <DynamicInputBadge dynamicInput={controller.dynamicInput} />}
        <Tooltip title={t("canvas.fit")}>
          <IconButton
            aria-label={t("canvas.fit")}
            size="small"
            onClick={() => view.getState().fitDocument(store.getState().document)}
            sx={{ position: "absolute", top: 8, right: 8, bgcolor: "background.paper" }}
          >
            <ZoomOutMapIcon fontSize="small" />
          </IconButton>
        </Tooltip>
        <EmptyState store={store} studio={studio} />
        <ExamplesGallery store={store} studio={studio} variant="dialog" />
      </Box>
    </ViewStoreContext.Provider>
  );
}
