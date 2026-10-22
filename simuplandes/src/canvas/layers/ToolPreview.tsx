/**
 * Renders the active tool's live-draw `PreviewShape[]` (see
 * `src/tools/types.ts`) as Konva shapes in accent dashed strokes -- the
 * `children` slot `CanvasStage`'s `OverlaysLayer` exposes for 04-04's tool
 * controller. A `"segment"` preview also shows its length at the midpoint.
 * Pure Konva glue: world points come in already computed by the machine;
 * this component only applies `worldToScreen`.
 */

import { Fragment, type ReactNode } from "react";
import { Circle, Group, Line, Rect, Text } from "react-konva";
import { distance, type Vec2 } from "../../geom";
import { formatNumber, type Language } from "../../i18n/numberFormat";
import type { PreviewShape, ToolHandle } from "../../tools/types";
import { worldToScreen, type Viewport } from "../viewport";
import { StrokeShape } from "./AnnotationStrokes";
import type { CanvasTokens } from "../../ui/theme/tokens";

export interface ToolPreviewProps {
  viewport: Viewport;
  tokens: CanvasTokens;
  language: Language;
  shapes: readonly PreviewShape[];
  /** The active tool's grab handles (Draw mode's shape editing); none by default. */
  handles?: readonly ToolHandle[];
}

/** Half the side of a vertex handle's square, in screen px. */
const VERTEX_HANDLE_HALF = 5;
const MIDPOINT_HANDLE_RADIUS = 3.5;
/** The "can't place here" sign: its radius and its offset from the cursor, screen px. */
const BLOCKED_RADIUS = 6;
const BLOCKED_OFFSET = 14;

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

/** One grab handle: a square vertex, a round midpoint, a diamond arc apex, or a control point with its tangent line. */
function HandleGlyph({
  handle,
  viewport,
  tokens,
}: {
  handle: ToolHandle;
  viewport: Viewport;
  tokens: CanvasTokens;
}): ReactNode {
  const screen = worldToScreen(viewport, handle.at);
  const fill = handle.active ? tokens.accent : tokens.panel;
  switch (handle.kind) {
    case "vertex":
      return (
        <Rect
          name="tool-handle-vertex"
          x={screen.x - VERTEX_HANDLE_HALF}
          y={screen.y - VERTEX_HANDLE_HALF}
          width={VERTEX_HANDLE_HALF * 2}
          height={VERTEX_HANDLE_HALF * 2}
          fill={fill}
          stroke={tokens.accent}
          strokeWidth={1.5}
          listening={false}
        />
      );
    case "bulge":
      return (
        <Rect
          name="tool-handle-bulge"
          x={screen.x}
          y={screen.y}
          offsetX={VERTEX_HANDLE_HALF}
          offsetY={VERTEX_HANDLE_HALF}
          rotation={45}
          width={VERTEX_HANDLE_HALF * 2}
          height={VERTEX_HANDLE_HALF * 2}
          fill={fill}
          stroke={tokens.accent}
          strokeWidth={1.5}
          listening={false}
        />
      );
    case "control": {
      const from = handle.from ? worldToScreen(viewport, handle.from) : screen;
      return (
        <Group name="tool-handle-control" listening={false}>
          <Line
            points={[from.x, from.y, screen.x, screen.y]}
            stroke={tokens.accent}
            strokeWidth={1}
            dash={[3, 3]}
            listening={false}
          />
          <Circle
            x={screen.x}
            y={screen.y}
            radius={VERTEX_HANDLE_HALF}
            fill={fill}
            stroke={tokens.accent}
            strokeWidth={1.5}
            listening={false}
          />
        </Group>
      );
    }
    case "midpoint":
      return (
        <Circle
          name="tool-handle-midpoint"
          x={screen.x}
          y={screen.y}
          radius={MIDPOINT_HANDLE_RADIUS}
          fill={fill}
          stroke={tokens.accent}
          strokeWidth={1}
          opacity={0.8}
          listening={false}
        />
      );
  }
}

export function ToolPreview({
  viewport,
  tokens,
  language,
  shapes,
  handles = [],
}: ToolPreviewProps): ReactNode {
  return (
    <>
      {handles.map((handle, i) => (
        <HandleGlyph key={`handle-${i}`} handle={handle} viewport={viewport} tokens={tokens} />
      ))}
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
          case "stroke":
            return (
              <StrokeShape
                key={i}
                name="tool-preview-stroke"
                viewport={viewport}
                tokens={tokens}
                points={shape.points}
                color={shape.color}
                width={shape.width}
              />
            );
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
          case "blocked": {
            // A "no" sign beside the cursor, not under it.
            const screen = worldToScreen(viewport, shape.at);
            const cx = screen.x + BLOCKED_OFFSET;
            const cy = screen.y + BLOCKED_OFFSET;
            const d = BLOCKED_RADIUS * Math.SQRT1_2;
            return (
              <Group key={i} name="tool-preview-blocked" listening={false}>
                <Circle
                  x={cx}
                  y={cy}
                  radius={BLOCKED_RADIUS}
                  stroke={tokens.err}
                  strokeWidth={2}
                  fill={tokens.panel}
                  listening={false}
                />
                <Line
                  points={[cx - d, cy - d, cx + d, cy + d]}
                  stroke={tokens.err}
                  strokeWidth={2}
                  listening={false}
                />
              </Group>
            );
          }
          default:
            return null;
        }
      })}
    </>
  );
}
