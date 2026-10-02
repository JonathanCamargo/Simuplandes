/**
 * Renders the active tool's live-draw `PreviewShape[]` (see
 * `src/tools/types.ts`) as Konva shapes in accent dashed strokes -- the
 * `children` slot `CanvasStage`'s `OverlaysLayer` exposes for 04-04's tool
 * controller. A `"segment"` preview also shows its length at the midpoint.
 * Pure Konva glue: world points come in already computed by the machine;
 * this component only applies `worldToScreen`.
 */

import { Fragment, type ReactNode } from "react";
import { Circle, Line, Text } from "react-konva";
import { distance, type Vec2 } from "../../geom";
import { formatNumber, type Language } from "../../i18n/numberFormat";
import type { PreviewShape } from "../../tools/types";
import { worldToScreen, type Viewport } from "../viewport";
import type { CanvasTokens } from "../../ui/theme/tokens";

export interface ToolPreviewProps {
  viewport: Viewport;
  tokens: CanvasTokens;
  language: Language;
  shapes: readonly PreviewShape[];
}

/** Long enough to always cross the visible viewport at any zoom this app supports. */
const RAY_LENGTH_WORLD = 1_000_000;

function flat(viewport: Viewport, points: readonly Vec2[]): number[] {
  const out: number[] = [];
  for (const p of points) {
    const s = worldToScreen(viewport, p);
    out.push(s.x, s.y);
  }
  return out;
}

export function ToolPreview({ viewport, tokens, language, shapes }: ToolPreviewProps): ReactNode {
  return (
    <>
      {shapes.map((shape, i) => {
        switch (shape.kind) {
          case "segment": {
            const mid: Vec2 = { x: (shape.a.x + shape.b.x) / 2, y: (shape.a.y + shape.b.y) / 2 };
            const midScreen = worldToScreen(viewport, mid);
            const length = distance(shape.a, shape.b);
            return (
              <Fragment key={i}>
                <Line
                  points={flat(viewport, [shape.a, shape.b])}
                  stroke={tokens.accent}
                  strokeWidth={2}
                  dash={shape.dashed ? [6, 4] : undefined}
                  listening={false}
                />
                {length > 0 && (
                  <Text
                    x={midScreen.x + 4}
                    y={midScreen.y - 14}
                    text={formatNumber(length, language, 1)}
                    fontSize={11}
                    fill={tokens.accent}
                    listening={false}
                  />
                )}
              </Fragment>
            );
          }
          case "polyline":
            return (
              <Line
                key={i}
                points={flat(viewport, shape.points)}
                closed={shape.closed}
                stroke={tokens.accent}
                strokeWidth={2}
                dash={[6, 4]}
                listening={false}
              />
            );
          case "rect": {
            const corners: Vec2[] = [
              { x: shape.min.x, y: shape.min.y },
              { x: shape.max.x, y: shape.min.y },
              { x: shape.max.x, y: shape.max.y },
              { x: shape.min.x, y: shape.max.y },
            ];
            return (
              <Line
                key={i}
                points={flat(viewport, corners)}
                closed
                stroke={tokens.accent}
                strokeWidth={1.5}
                dash={[4, 3]}
                fill={tokens.accentSoft}
                opacity={0.5}
                listening={false}
              />
            );
          }
          case "ray": {
            const end: Vec2 = {
              x: shape.from.x + Math.cos(shape.angle) * RAY_LENGTH_WORLD,
              y: shape.from.y + Math.sin(shape.angle) * RAY_LENGTH_WORLD,
            };
            return (
              <Line
                key={i}
                points={flat(viewport, [shape.from, end])}
                stroke={tokens.accent}
                strokeWidth={1.5}
                dash={[8, 5]}
                listening={false}
              />
            );
          }
          case "point": {
            const screen = worldToScreen(viewport, shape.at);
            return (
              <Circle
                key={i}
                x={screen.x}
                y={screen.y}
                radius={5}
                fill={tokens.accent}
                listening={false}
              />
            );
          }
          default:
            return null;
        }
      })}
    </>
  );
}
