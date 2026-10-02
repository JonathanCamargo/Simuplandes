/**
 * `installCanvasTestHook`: a DEV-only `window.__simuplandesCanvas` affordance
 * for Playwright E2E tests, mirroring `src/sim/react/testHook.ts`'s pattern.
 * Konva draws to a `<canvas>` element, not DOM nodes, so Playwright cannot
 * assert hover/selection/issue halos via the DOM -- this hook lets E2E read
 * a Konva node's own state (its stamped `name` tokens, see `LinksLayer.tsx`/
 * `JointsLayer.tsx`) directly.
 *
 * Gated on `dev` (defaults to `import.meta.env.DEV`, Vite's own
 * dead-code-elimination flag), so `vite build`'s production bundle drops the
 * entire body -- mirrors `installSimTestHook`'s own contract (05-04).
 */

import type Konva from "konva";
import type { Id } from "../../model";

/** Which halo states the current node carries (its `is-*` name tokens). */
export interface CanvasHaloState {
  selected: boolean;
  hovered: boolean;
  issue: boolean;
}

declare global {
  interface Window {
    __simuplandesCanvas?: {
      haloState(entityId: Id): CanvasHaloState | null;
    };
  }
}

/**
 * Finds the first node whose id is `link:<entityId>`, `pin:<entityId>`,
 * `slider:<entityId>` or `ground:<entityId>` -- a predicate-based `findOne`
 * (never a `#id` CSS-style selector string, since document ids are opaque
 * and not guaranteed selector-safe).
 */
function findHaloNode(stage: Konva.Stage, entityId: Id): Konva.Node | undefined {
  const candidateIds = new Set([
    `link:${entityId}`,
    `pin:${entityId}`,
    `slider:${entityId}`,
    `ground:${entityId}`,
  ]);
  return stage.findOne((node: Konva.Node) => candidateIds.has(node.id()));
}

/**
 * Installs `window.__simuplandesCanvas` when `dev` is true; a no-op (nothing
 * installed) otherwise. Returns an uninstall function that deletes the
 * global -- always safe to call, even when nothing was installed.
 */
export function installCanvasTestHook(
  getStage: () => Konva.Stage | null,
  dev: boolean = import.meta.env.DEV,
): () => void {
  if (!dev) return () => {};

  window.__simuplandesCanvas = {
    haloState(entityId) {
      const stage = getStage();
      if (!stage) return null;
      const node = findHaloNode(stage, entityId);
      if (!node) return null;
      return {
        selected: node.hasName("is-selected"),
        hovered: node.hasName("is-hovered"),
        issue: node.hasName("is-issue"),
      };
    },
  };

  return () => {
    delete window.__simuplandesCanvas;
  };
}
