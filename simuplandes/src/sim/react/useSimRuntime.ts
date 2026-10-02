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
      const status = simStore.getState().session?.status;
      studioStore
        .getState()
        .setHint(
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
        runtime.exit();
        studioStore.getState().setHint(null);
      }
    });

    const unsubscribeDocument = mechanismStore.subscribe((state, prevState) => {
      if (state.document === prevState.document) return;
      if (studioStore.getState().mode !== "simulate") return;
      runtime.documentChanged(state.document);
      publishModeHint();
    });

    const unsubscribeDragging = simStore.subscribe((state, prevState) => {
      if (state.dragging === prevState.dragging) return;
      if (studioStore.getState().mode !== "simulate") return;
      if (state.dragging) {
        studioStore.getState().setHint({
          key: "sim.hint.dragging",
          values: { link: linkNameOf(state.dragging.linkId) },
        });
      } else {
        studioStore.getState().setHint({ key: "sim.hint.simulate" });
      }
    });

    const uninstallTestHook = installSimTestHook({ studioStore, simStore, runtime });

    return () => {
      unsubscribeMode();
      unsubscribeDocument();
      unsubscribeDragging();
      uninstallTestHook();
      runtime.dispose();
    };
  }, [studioStore, mechanismStore, simStore, runtime]);
}
