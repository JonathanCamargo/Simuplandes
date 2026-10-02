/**
 * `createViewStore`: a small vanilla Zustand store holding the current
 * `Viewport` and the pure actions over it (`viewport.ts`/`bounds.ts`). Pure
 * data + zustand/vanilla only -- no React/Konva (purity rule).
 */

import { createStore, type StoreApi } from "zustand/vanilla";
import type { MechanismDocument } from "../model";
import type { Vec2 } from "../geom";
import { documentBounds } from "./bounds";
import {
  defaultViewport,
  fitToBounds,
  panByScreen as panViewportByScreen,
  zoomAt,
  type Viewport,
} from "./viewport";

export interface ViewState {
  viewport: Viewport;
  /** Resizes the viewport in place, keeping `panWorld` and `zoom` unchanged. */
  setSize(widthPx: number, heightPx: number): void;
  zoomAtScreen(screenPt: Vec2, factor: number): void;
  panByScreen(d: { dx: number; dy: number }): void;
  /** Fits the viewport to `doc`'s bounds, or `defaultViewport` for an empty document. */
  fitDocument(doc: MechanismDocument): void;
  /** Resets to `defaultViewport` at the current screen size. */
  reset(): void;
}

export type ViewStore = StoreApi<ViewState>;

/** Creates a fresh, isolated view store, optionally seeded with a screen size. */
export function createViewStore(initialSize?: { widthPx: number; heightPx: number }): ViewStore {
  const widthPx = initialSize?.widthPx ?? 0;
  const heightPx = initialSize?.heightPx ?? 0;

  return createStore<ViewState>((set, get) => ({
    viewport: defaultViewport(widthPx, heightPx),

    setSize(nextWidthPx, nextHeightPx) {
      const v = get().viewport;
      set({ viewport: { ...v, widthPx: nextWidthPx, heightPx: nextHeightPx } });
    },
    zoomAtScreen(screenPt, factor) {
      set({ viewport: zoomAt(get().viewport, screenPt, factor) });
    },
    panByScreen(d) {
      set({ viewport: panViewportByScreen(get().viewport, d) });
    },
    fitDocument(doc) {
      const bounds = documentBounds(doc);
      set({ viewport: fitToBounds(get().viewport, bounds) });
    },
    reset() {
      const v = get().viewport;
      set({ viewport: defaultViewport(v.widthPx, v.heightPx) });
    },
  }));
}
