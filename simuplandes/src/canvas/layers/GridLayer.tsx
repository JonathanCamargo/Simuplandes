/**
 * Minor/major grid lines and the axes, in screen space. Hidden entirely
 * when `visible` is false (preferences.gridVisible). Every shape is
 * `listening={false}` -- only the Stage receives pointer events.
 */

import type { ReactNode } from "react";
import { Layer, Line } from "react-konva";
import { gridLines, gridSpacingFor } from "../grid";
import type { Viewport } from "../viewport";
import type { CanvasTokens } from "../../ui/theme/tokens";

export interface GridLayerProps {
  viewport: Viewport;
  tokens: CanvasTokens;
  visible: boolean;
}

export function GridLayer({ viewport, tokens, visible }: GridLayerProps): ReactNode {
  if (!visible) return null;

  const spacing = gridSpacingFor(viewport.zoom);
  const { vertical, horizontal } = gridLines(viewport, spacing);

  return (
    <Layer listening={false}>
      {vertical.map((line) => (
        <Line
          key={`v-${line.worldX}`}
          points={[line.screenX, 0, line.screenX, viewport.heightPx]}
          stroke={line.axis ? tokens.muted : line.major ? tokens.gridMajor : tokens.grid}
          strokeWidth={line.axis ? 1.5 : 1}
          listening={false}
        />
      ))}
      {horizontal.map((line) => (
        <Line
          key={`h-${line.worldY}`}
          points={[0, line.screenY, viewport.widthPx, line.screenY]}
          stroke={line.axis ? tokens.muted : line.major ? tokens.gridMajor : tokens.grid}
          strokeWidth={line.axis ? 1.5 : 1}
          listening={false}
        />
      ))}
    </Layer>
  );
}
