/**
 * `useSimRuntime`: the React glue between `studioStore`'s Build/Simulate
 * mode, the mechanism document, and plan 05-04's other half
 * (`createSimRuntime`). Every wiring happens inside ONE `useEffect`, via
 * each store's own vanilla `subscribe` (never `useStore`/`useSyncExternal
 * Store`) -- this hook never selects any per-frame field (`poses`), so it
 * causes ZERO React re-renders of its own, no matter how often the runtime
 * publishes a new pose map (the canvas reads `simStore.poses` imperatively;
 * see `src/canvas/posesSource.ts`, plan 05-05).
 *
 * Ownership split (so tests can inject fakes): this hook does NOT create
 * the runtime or `simStore` -- `StudioShell` (plan 05-06) creates both once
 * with `useState(() => ...)` and passes them in here.
 *
 * `dispose()` is idempotent and non-terminal (see `runtime.ts`'s own
 * TSDoc), which is exactly what lets this hook survive React StrictMode's
 * mount -> cleanup -> mount without leaving a dead runtime behind: the
 * second mount's `enter()` (if `mode` is already "simulate") works fine.
 */

import { useEffect } from "react";
import type { StoreApi } from "zustand/vanilla";
import type { Id } from "../../model";
import type { MechanismStore } from "../../store";
import type { StudioState } from "../../uiState/studioStore";
import type { SimStore } from "../simStore";
import type { SimRuntime } from "../runtime";
import { installSimTestHook } from "./testHook";

export interface UseSimRuntimeOptions {
  studioStore: StoreApi<StudioState>;
  mechanismStore: MechanismStore;
  simStore: SimStore;
  runtime: SimRuntime;
}

/** Wires `runtime` to `studioStore`'s mode and `mechanismStore`'s document; installs the dev-only E2E test hook. Renders nothing, returns nothing. */
export function useSimRuntime(opts: UseSimRuntimeOptions): void {
  const { studioStore, mechanismStore, simStore, runtime } = opts;

  useEffect(() => {
    function linkNameOf(linkId: Id): string {
      const link = mechanismStore.getState().document.links.find((l) => l.id === linkId);
      return link?.name || linkId;
    }

    function publishModeHint(): void {
      const state = simStore.getState();
      if (state.analysis === "dynamics") {
        const ready = state.dynamics?.summary.status === "ready";
        studioStore
          .getState()
          .setSimHint(ready ? { key: "sim.hint.dynamics" } : { key: "sim.hint.notDrivable" });
        return;
      }
      const status = state.session?.status;
      studioStore
        .getState()
        .setSimHint(
          status === "ready" ? { key: "sim.hint.simulate" } : { key: "sim.hint.notDrivable" },
        );
    }

    function enterSimulate(): void {
      runtime.enter(mechanismStore.getState().document);
      publishModeHint();
    }

    if (studioStore.getState().mode === "simulate") {
      enterSimulate();
    }

    const unsubscribeMode = studioStore.subscribe((state, prevState) => {
      if (state.mode === prevState.mode) return;
      if (state.mode === "simulate") {
        enterSimulate();
      } else {
        // Simulate -> Draw keeps the frame on screen for the Brush and Eraser; `exit()` clears it.
        const frame =
          prevState.mode === "simulate" && state.mode === "draw" ? simStore.getState().poses : null;
        runtime.exit();
        studioStore.getState().setSimHint(null);
        if (frame) {
          studioStore.getState().setDrawPoses(frame);
          studioStore.getState().setActiveTool("brush");
        }
      }
    });

    const unsubscribeDocument = mechanismStore.subscribe((state, prevState) => {
      if (state.document === prevState.document) return;
      // The held frame no longer matches the geometry once the document changes.
      if (studioStore.getState().drawPoses) studioStore.getState().setDrawPoses(null);
      if (studioStore.getState().mode !== "simulate") return;
      runtime.documentChanged(state.document);
      publishModeHint();
    });

    const unsubscribeDragging = simStore.subscribe((state, prevState) => {
      if (state.dragging === prevState.dragging) return;
      if (studioStore.getState().mode !== "simulate") return;
      if (state.dragging) {
        studioStore.getState().setSimHint({
          key: "sim.hint.dragging",
          values: { link: linkNameOf(state.dragging.linkId) },
        });
      } else {
        studioStore.getState().setSimHint({ key: "sim.hint.simulate" });
      }
    });

    const unsubscribeAnalysis = simStore.subscribe((state, prevState) => {
      const sameSummary = state.dynamics?.summary === prevState.dynamics?.summary;
      if (state.analysis === prevState.analysis && sameSummary) return;
      if (studioStore.getState().mode !== "simulate") return;
      publishModeHint();
    });

    const uninstallTestHook = installSimTestHook({ studioStore, simStore, runtime });

    return () => {
      unsubscribeMode();
      unsubscribeDocument();
      unsubscribeDragging();
      unsubscribeAnalysis();
      uninstallTestHook();
      runtime.dispose();
    };
  }, [studioStore, mechanismStore, simStore, runtime]);
}
