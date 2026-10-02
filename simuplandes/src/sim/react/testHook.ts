/**
 * `installSimTestHook`: a DEV-only `window.__simuplandesSim` affordance for
 * Playwright E2E tests (the user's default 9) -- mirrors `CanvasArea`'s
 * existing `data-viewport` attribute pattern, which exposes internal state
 * to the test runner without any UI change. Every getter returns plain,
 * JSON-safe data (no `Map`, no class instances, no functions on the
 * returned values) so a Playwright `page.evaluate()` call can read it
 * directly.
 *
 * Gated on `import.meta.env.DEV` (Vite's own dead-code-elimination flag),
 * so `vite build`'s production bundle drops the entire body -- confirmed by
 * grepping `dist/**\/*.js` for `__simuplandesSim` after `npm run build`
 * (see 05-04-SUMMARY.md).
 */

import type { StoreApi } from "zustand/vanilla";
import type { Id, Pose } from "../../model";
import type { StudioMode, StudioState } from "../../uiState/studioStore";
import type { PlotPrefs, SimReadout, SimStore } from "../simStore";
import type { SimSessionSummary } from "../session";
import type { SimRuntime } from "../runtime";

/** A JSON-safe world pose (a plain tuple, never a `Map`). */
export interface SimTestHookPose {
  readonly position: readonly [number, number];
  readonly angle: number;
}

/** The dev-only E2E surface installed at `window.__simuplandesSim`. */
export interface SimTestHook {
  getMode(): StudioMode;
  getStatus(): SimSessionSummary | null;
  getPoses(): Record<string, SimTestHookPose> | null;
  getInput(): { input: number; display: number } | null;
  getTrace(
    markerId: string,
  ): { points: readonly (readonly [number, number])[]; closed: boolean } | null;
  getReadout(): SimReadout | null;
  getPlot(): PlotPrefs;
}

declare global {
  interface Window {
    __simuplandesSim?: SimTestHook;
  }
}

/** What `installSimTestHook` needs from the caller: the three stores plus the runtime instance driving them. */
export interface InstallSimTestHookDeps {
  studioStore: StoreApi<StudioState>;
  simStore: SimStore;
  runtime: SimRuntime;
}

function posesToPlain(poses: ReadonlyMap<Id, Pose> | null): Record<string, SimTestHookPose> | null {
  if (!poses) return null;
  const out: Record<string, SimTestHookPose> = {};
  for (const [id, pose] of poses) {
    out[id] = { position: [pose.position[0], pose.position[1]], angle: pose.angle };
  }
  return out;
}

/**
 * Installs `window.__simuplandesSim` when `dev` (defaults to
 * `import.meta.env.DEV`) is true; a no-op (nothing installed) otherwise.
 * Returns an uninstall function that deletes the global -- always safe to
 * call, even when nothing was installed.
 */
export function installSimTestHook(
  deps: InstallSimTestHookDeps,
  options?: { dev?: boolean },
): () => void {
  const dev = options?.dev ?? import.meta.env.DEV;
  if (!dev) return () => {};

  const { studioStore, simStore, runtime } = deps;

  const hook: SimTestHook = {
    getMode() {
      return studioStore.getState().mode;
    },
    getStatus() {
      return simStore.getState().session;
    },
    getPoses() {
      const snapshot = runtime.snapshot();
      return posesToPlain(snapshot ? snapshot.poses : simStore.getState().poses);
    },
    getInput() {
      const snapshot = runtime.snapshot();
      return snapshot ? { input: snapshot.input, display: snapshot.display } : null;
    },
    getTrace(markerId) {
      const trace = simStore.getState().traces.find((t) => t.markerId === markerId);
      if (!trace) return null;
      const points: [number, number][] = [];
      for (let i = 0; i + 1 < trace.points.length; i += 2) {
        points.push([trace.points[i], trace.points[i + 1]]);
      }
      return { points, closed: trace.closed };
    },
    getReadout() {
      return simStore.getState().readout;
    },
    getPlot() {
      return simStore.getState().plot;
    },
  };

  window.__simuplandesSim = hook;
  return () => {
    delete window.__simuplandesSim;
  };
}
