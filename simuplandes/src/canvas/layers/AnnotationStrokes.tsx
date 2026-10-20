/**
 * Freehand annotation strokes (Konva): saved annotations from the render
 * model, and the Brush tool's stroke in progress. A stroke's width is in
 * model units, so it scales with zoom like the rest of the drawing; a
 * single-point stroke is a dot.
 */

import type { ReactNode } from "react";
import { Circle, Line } from "react-konva";
import type { Vec2 } from "../../geom";
import type { AnnotationColor } from "../../model";
import type { CanvasTokens } from "../../ui/theme/tokens";
import { worldToScreen, type Viewport } from "../viewport";
import type { AnnotationPrimitive } from "../renderModel";

export interface StrokeShapeProps {
  viewport: Viewport;
  tokens: CanvasTokens;
  points: readonly Vec2[];
  color: AnnotationColor;
  /** Model units. */
  width: number;
  name?: string;
}

export function StrokeShape({
  viewport,
  tokens,
  points,
  color,
  width,
  name,
}: StrokeShapeProps): ReactNode {
  const stroke = tokens.annotation[color];
  const widthPx = width * viewport.zoom;
  if (points.length === 1) {
    const at = worldToScreen(viewport, points[0]);
    return (
      <Circle name={name} x={at.x} y={at.y} radius={widthPx / 2} fill={stroke} listening={false} />
    );
  }
  const flat: number[] = [];
  for (const p of points) {
    const s = worldToScreen(viewport, p);
    flat.push(s.x, s.y);
  }
  return (
    <Line
      name={name}
      points={flat}
      stroke={stroke}
      strokeWidth={widthPx}
      lineCap="round"
      lineJoin="round"
      listening={false}
    />
  );
}

export function AnnotationStrokes({
  viewport,
  tokens,
  annotations,
}: {
  viewport: Viewport;
  tokens: CanvasTokens;
  annotations: readonly AnnotationPrimitive[];
}): ReactNode {
  return annotations.map((a) => (
    <StrokeShape
      key={a.annotationId}
      name="annotation"
      viewport={viewport}
      tokens={tokens}
      points={a.points}
      color={a.color}
      width={a.width}
    />
  ));
}
