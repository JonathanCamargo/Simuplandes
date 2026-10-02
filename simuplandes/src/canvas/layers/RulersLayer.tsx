/**
 * Top and left ruler strips, drawn in screen space with tick labels in
 * model units (`formatNumber(world, lang, 0)`).
 */

import type { ReactNode } from "react";
import { Layer, Rect, Text } from "react-konva";
import { rulerTicks } from "../grid";
import { formatNumber, type Language } from "../../i18n/numberFormat";
import type { Viewport } from "../viewport";
import type { CanvasTokens } from "../../ui/theme/tokens";

export const RULER_SIZE_PX = 18;

export interface RulersLayerProps {
  viewport: Viewport;
  tokens: CanvasTokens;
  language: Language;
}

export function RulersLayer({ viewport, tokens, language }: RulersLayerProps): ReactNode {
  const xTicks = rulerTicks(viewport, "x");
  const yTicks = rulerTicks(viewport, "y");

  return (
    <Layer listening={false}>
      <Rect
        x={0}
        y={0}
        width={viewport.widthPx}
        height={RULER_SIZE_PX}
        fill={tokens.panel2}
        listening={false}
      />
      <Rect
        x={0}
        y={0}
        width={RULER_SIZE_PX}
        height={viewport.heightPx}
        fill={tokens.panel2}
        listening={false}
      />
      {xTicks.map((tick) => (
        <Text
          key={`x-${tick.world}`}
          x={tick.screen + 2}
          y={2}
          text={formatNumber(tick.world, language, 0)}
          fontSize={10}
          fill={tokens.muted}
          listening={false}
        />
      ))}
      {yTicks.map((tick) => (
        <Text
          key={`y-${tick.world}`}
          x={2}
          y={tick.screen + 2}
          text={formatNumber(tick.world, language, 0)}
          fontSize={10}
          fill={tokens.muted}
          listening={false}
        />
      ))}
    </Layer>
  );
}
