/**
 * Auto-layout driver (09-02): implements `ImportDeps["layout"]`. A seeded,
 * deterministic multi-start over `jitteredSeed`, each candidate filtered for
 * degeneracy and gated by `measureCandidate` (reachable input travel). The
 * first candidate reaching `goalDeg` wins; otherwise the best-range one is
 * returned as `low-mobility`. Yields to the event loop between tries,
 * reports progress and honours an `AbortSignal`.
 *
 * With per-link lengths only, every seed is first fitted to the lengths
 * (`fitLengths`); a try whose lengths cannot close is skipped.
 */

import type {
  LayoutControl,
  LayoutRequest,
  LayoutResult,
  Vec2Tuple,
} from "../interchange/importReport";
import {
  circleMidpointSeed,
  hashLayoutGraph,
  isDegenerateSeed,
  jitteredSeed,
} from "../interchange/layoutSeed";
import { fitLengths } from "./lengthTarget";
import { measureCandidate } from "./mobilityRange";

export const AUTO_LAYOUT_DEFAULTS = { maxTries: 40, goalDeg: 75, stepDeg: 2 } as const;

const CACHE_CAP = 64;
const cache = new Map<string, LayoutResult>();

function cacheKey(req: LayoutRequest): string {
  const edges = req.edges.map((e) => `${e.u}-${e.v}${e.kind}`).join(",");
  const lengths = req.lengths === null ? "" : req.lengths.map((l) => l ?? "x").join(",");
  return `${hashLayoutGraph(req)}|${req.variant}|${String(req.inputEdge)}|${edges}|${lengths}`;
}

function remember(key: string, result: LayoutResult): void {
  if (cache.size >= CACHE_CAP) {
    const oldest = cache.keys().next();
    if (!oldest.done) cache.delete(oldest.value);
  }
  cache.set(key, result);
}

/** Clears the in-memory layout cache (tests). */
export function clearAutoLayoutCache(): void {
  cache.clear();
}

const yieldToEventLoop = (): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, 0);
  });

/** Seed positions for one try: the jittered seed, fitted to the lengths when given. */
function candidateFor(
  req: LayoutRequest,
  tryIndex: number,
): { positions: readonly Vec2Tuple[]; feasible: boolean; residual: number } {
  const seed = jitteredSeed(req, req.variant, tryIndex);
  if (req.lengths === null) return { positions: seed, feasible: true, residual: 0 };
  const fit = fitLengths(req, seed);
  return { positions: fit.positions, feasible: fit.feasible, residual: fit.residual };
}

export async function autoLayout(
  req: LayoutRequest,
  ctl: LayoutControl = {},
): Promise<LayoutResult> {
  const { maxTries, goalDeg } = AUTO_LAYOUT_DEFAULTS;
  const key = cacheKey(req);
  const hit = cache.get(key);
  if (hit) return hit;

  // Gruebler is a pure topology count (every node is a link, node 0 ground).
  const gruebler = 3 * (req.nodeCount - 1) - 2 * req.edges.length;
  if (gruebler !== 1) {
    const result: LayoutResult = {
      status: "not-one-dof",
      positions: circleMidpointSeed(req),
      rangeDeg: 0,
      tries: 0,
      lengthResidual: null,
    };
    remember(key, result);
    return result;
  }

  let best: { positions: readonly Vec2Tuple[]; rangeDeg: number } | null = null;
  let smallestResidual: number | null = null;
  let measured = 0;
  for (let i = 0; i < maxTries; i++) {
    if (ctl.signal?.aborted) {
      return {
        status: "cancelled",
        positions: null,
        rangeDeg: best?.rangeDeg ?? 0,
        tries: i,
        lengthResidual: null,
      };
    }
    ctl.onProgress?.(i + 1, maxTries);
    const cand = candidateFor(req, i);
    if (!cand.feasible) {
      smallestResidual = Math.min(smallestResidual ?? Infinity, cand.residual);
    } else if (!isDegenerateSeed(req, cand.positions)) {
      const { rangeDeg } = measureCandidate(req, cand.positions, goalDeg);
      measured += 1;
      if (best === null || rangeDeg > best.rangeDeg) best = { positions: cand.positions, rangeDeg };
      if (rangeDeg >= goalDeg) {
        const result: LayoutResult = {
          status: "ok",
          positions: cand.positions,
          rangeDeg,
          tries: i + 1,
          lengthResidual: req.lengths === null ? null : cand.residual,
        };
        remember(key, result);
        return result;
      }
      await yieldToEventLoop();
    }
  }

  if (measured === 0 && smallestResidual !== null) {
    const result: LayoutResult = {
      status: "lengths-infeasible",
      positions: null,
      rangeDeg: 0,
      tries: maxTries,
      lengthResidual: smallestResidual,
    };
    remember(key, result);
    return result;
  }
  const result: LayoutResult = {
    status: "low-mobility",
    positions: best?.positions ?? circleMidpointSeed(req),
    rangeDeg: best?.rangeDeg ?? 0,
    tries: maxTries,
    lengthResidual: null,
  };
  remember(key, result);
  return result;
}
