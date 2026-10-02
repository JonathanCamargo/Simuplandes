/**
 * Phase 5 seam: where Simulate-mode poses come from. `src/canvas` never
 * imports `src/sim` -- it only knows this plain-data contract, fed to it by
 * whatever Phase 5 plan owns the simulation runtime (05-06/05-07).
 */

import type { Id, Pose } from "../model";

/**
 * A per-frame source of link poses. `get()` returns `null` to mean "render
 * the document's own reference poses" (Build mode, or Simulate mode before
 * the first solve); `subscribe` fires whenever a later `get()` call may
 * return a different value, so consumers can re-run their imperative update
 * without a React re-render.
 */
export interface PosesSource {
  get(): ReadonlyMap<Id, Pose> | null;
  subscribe(listener: () => void): () => void;
}

/** One marker's coupler-curve trace, in world space, interleaved [x0,y0,x1,y1,...]. */
export interface TracePrimitive {
  readonly markerId: Id;
  readonly points: Float64Array | readonly number[];
  readonly closed: boolean;
}

/** Shared by `hitTest`/`sitesNear`: an optional posed-geometry override. */
export interface PoseOptions {
  readonly poses?: ReadonlyMap<Id, Pose> | null;
}
