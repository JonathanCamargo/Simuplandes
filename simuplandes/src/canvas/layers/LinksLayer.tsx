/**
 * Link bodies: bars (linkOutline stroke + type-color fill stroke, the WCAG
 * 1.4.11 rendering contract from 04-01) and plates (translucent fill +
 * linkOutline stroke). Selection/hover/issue halos are added in the
 * selection/hover/issue accent colors (GRF-02/GRF-03).
 *
 * Every bar/plate `Group` carries a stable `id={"link:"+linkId}` and every
 * `Line` inside it is a direct child -- the Phase 5 posed-rendering seam
 * (`applyRenderModelToLayers`) finds these nodes by id and rewrites their
 * `points` imperatively, without a React re-render (this applies uniformly
 * to halo Lines too, so a hovered/issue link's overlay follows posed
 * geometry during Simulate exactly like its body does). Forwards its ref to
 * the underlying Konva `Layer` so `CanvasStage` can pass it to that seam.
 *
 * Each Group's Konva `name` carries space-separated `is-selected`/
 * `is-hovered`/`is-issue` tokens (read by `canvasTestHook.ts`'s `haloState`).
 */

import { forwardRef, type ReactNode } from "react";
import { Layer, Line, Group } from "react-konva";
import type Konva from "konva";
import { worldToScreen, type Viewport } from "../viewport";
import type { BarPrimitive, PlatePrimitive } from "../renderModel";
import type { CanvasTokens } from "../../ui/theme/tokens";
import type { Vec2 } from "../../geom";

export interface LinksLayerProps {
  viewport: Viewport;
  tokens: CanvasTokens;
  bars: BarPrimitive[];
  plates: PlatePrimitive[];
}

function toScreenFlat(viewport: Viewport, points: readonly Vec2[]): number[] {
  const flat: number[] = [];
  for (const p of points) {
    const s = worldToScreen(viewport, p);
    flat.push(s.x, s.y);
  }
  return flat;
}

function haloNames(flags: { selected: boolean; hovered: boolean; issue: boolean }): string {
  const names: string[] = [];
  if (flags.selected) names.push("is-selected");
  if (flags.hovered) names.push("is-hovered");
  if (flags.issue) names.push("is-issue");
  return names.join(" ");
}

export const LinksLayer = forwardRef<Konva.Layer, LinksLayerProps>(function LinksLayer(
  { viewport, tokens, bars, plates },
  ref,
): ReactNode {
  return (
    <Layer ref={ref} listening={false}>
      {plates.map((plate) => {
        const points = toScreenFlat(viewport, plate.points);
        return (
          <Group
            key={plate.linkId}
            id={`link:${plate.linkId}`}
            name={haloNames(plate)}
            listening={false}
          >
            {plate.selected && (
              <Line
                points={points}
                closed
                stroke={tokens.selection}
                strokeWidth={6}
                opacity={0.4}
                listening={false}
              />
            )}
            {plate.hovered && (
              <Line
                points={points}
                closed
                stroke={tokens.hover}
                strokeWidth={8}
                opacity={0.35}
                listening={false}
              />
            )}
            <Line
              points={points}
              closed
              fill={plate.color}
              opacity={0.35}
              stroke={tokens.linkOutline}
              strokeWidth={2}
              listening={false}
            />
            {plate.issue && (
              <Line
                points={points}
                closed
                stroke={tokens.issue}
                strokeWidth={4}
                dash={[8, 4]}
                listening={false}
              />
            )}
          </Group>
        );
      })}
      {bars.map((bar) => {
        const points = toScreenFlat(viewport, bar.points);
        return (
          <Group key={bar.linkId} id={`link:${bar.linkId}`} name={haloNames(bar)} listening={false}>
            {bar.selected && (
              <Line
                points={points}
                stroke={tokens.selection}
                strokeWidth={16}
                opacity={0.35}
                lineCap="round"
                lineJoin="round"
                listening={false}
              />
            )}
            {bar.hovered && (
              <Line
                points={points}
                stroke={tokens.hover}
                strokeWidth={8}
                opacity={0.35}
                lineCap="round"
                lineJoin="round"
                listening={false}
              />
            )}
            <Line
              points={points}
              stroke={tokens.linkOutline}
              strokeWidth={10}
              lineCap="round"
              lineJoin="round"
              listening={false}
            />
            <Line
              points={points}
              stroke={bar.color}
              strokeWidth={7}
              lineCap="round"
              lineJoin="round"
              listening={false}
            />
            {bar.issue && (
              <Line
                points={points}
                stroke={tokens.issue}
                strokeWidth={4}
                dash={[8, 4]}
                lineCap="round"
                lineJoin="round"
                listening={false}
              />
            )}
          </Group>
        );
      })}
    </Layer>
  );
});
