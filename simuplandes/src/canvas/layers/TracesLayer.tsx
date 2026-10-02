/**
 * Coupler-curve trace polylines (SIM-04): one accent-colored `Line` per
 * `TracePrimitive`, painted BEFORE `LinksLayer`/`JointsLayer` (a lower
 * z-index) so the mechanism itself is always readable on top of its own
 * history. `listening={false}` throughout -- traces are never hit-testable.
 */

import { memo, type ReactNode } from "react";
import { Layer, Line } from "react-konva";
import { worldToScreen, type Viewport } from "../viewport";
import type { TracePrimitive } from "../posesSource";
import type { CanvasTokens } from "../../ui/theme/tokens";

export interface TracesLayerProps {
  viewport: Viewport;
  tokens: CanvasTokens;
  traces: readonly TracePrimitive[];
}

function toScreenFlat(viewport: Viewport, points: Float64Array | readonly number[]): number[] {
  const flat: number[] = [];
  for (let i = 0; i + 1 < points.length; i += 2) {
    const s = worldToScreen(viewport, { x: points[i], y: points[i + 1] });
    flat.push(s.x, s.y);
  }
  return flat;
}

function TracesLayerImpl({ viewport, tokens, traces }: TracesLayerProps): ReactNode {
  return (
    <Layer listening={false}>
      {traces.map((trace) => (
        <Line
          key={trace.markerId}
          id={`trace:${trace.markerId}`}
          points={toScreenFlat(viewport, trace.points)}
          stroke={tokens.accent}
          strokeWidth={1.5}
          opacity={0.9}
          closed={trace.closed}
          fillEnabled={false}
          listening={false}
        />
      ))}
    </Layer>
  );
}

/** Re-renders only when `traces`/`viewport`/`tokens` change. */
export const TracesLayer = memo(TracesLayerImpl);
