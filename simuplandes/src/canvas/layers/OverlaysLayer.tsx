/**
 * The snap indicator (shape depends on `snap.kind`), selection halos (owned
 * by `LinksLayer`/`JointsLayer` today) and `children` -- the slot 04-04's
 * tool controller uses for live drawing previews.
 */

import type { ReactNode } from "react";
import { Layer, Circle, Line, RegularPolygon } from "react-konva";
import { AnnotationStrokes } from "./AnnotationStrokes";
import type { AnnotationPrimitive } from "../renderModel";
import { worldToScreen, type Viewport } from "../viewport";
import type { SnapResult } from "../snapping";
import type { CanvasTokens } from "../../ui/theme/tokens";

export interface OverlaysLayerProps {
  viewport: Viewport;
  tokens: CanvasTokens;
  snap: SnapResult | null;
  /** Hand-drawn annotations, drawn on top of the mechanism but under snap marks and tool previews. */
  annotations?: readonly AnnotationPrimitive[];
  children?: ReactNode;
}

export function OverlaysLayer({
  viewport,
  tokens,
  snap,
  annotations = [],
  children,
}: OverlaysLayerProps): ReactNode {
  const screen = snap ? worldToScreen(viewport, snap.point) : null;

  return (
    <Layer>
      <AnnotationStrokes viewport={viewport} tokens={tokens} annotations={annotations} />
      {screen && snap?.kind === "site" && (
        <Circle
          x={screen.x}
          y={screen.y}
          radius={9}
          stroke={tokens.accent}
          strokeWidth={2}
          listening={false}
        />
      )}
      {screen && snap?.kind === "midpoint" && (
        <RegularPolygon
          x={screen.x}
          y={screen.y}
          sides={3}
          radius={8}
          stroke={tokens.accent}
          strokeWidth={2}
          listening={false}
        />
      )}
      {screen && snap?.kind === "link" && (
        <RegularPolygon
          x={screen.x}
          y={screen.y}
          sides={4}
          radius={8}
          stroke={tokens.accent}
          strokeWidth={2}
          listening={false}
        />
      )}
      {screen && snap?.kind === "grid" && (
        <Line
          points={[
            screen.x - 5,
            screen.y,
            screen.x + 5,
            screen.y,
            screen.x,
            screen.y,
            screen.x,
            screen.y - 5,
            screen.x,
            screen.y + 5,
          ]}
          stroke={tokens.accent}
          strokeWidth={1.5}
          listening={false}
        />
      )}
      {screen && snap?.kind === "angle" && (
        <Circle
          x={screen.x}
          y={screen.y}
          radius={4}
          fill={tokens.accent}
          dash={[3, 3]}
          listening={false}
        />
      )}
      {children}
    </Layer>
  );
}
