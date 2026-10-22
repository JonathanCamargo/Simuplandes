/**
 * Drafting-style joint glyphs: hatched ground pivots, white pin circles
 * with an ink ring, slider blocks on hatched rails, motor arc-arrows,
 * marker crosshairs, hollow free-site dots, zigzag and spiral springs, and
 * load arrows.
 *
 * Every glyph carries a stable id (`pin:<jointId>`, `slider:<jointId>`,
 * `motor:<jointId>`, `marker:<markerId>`, `site:<siteId>`, `ground:<siteId>`,
 * `spring:<springId>`, `load:<loadId>`)
 * -- the Phase 5 posed-rendering seam (`applyRenderModelToLayers`) finds
 * these nodes by id and repositions them imperatively. Forwards its ref to
 * the underlying Konva `Layer` so `CanvasStage` can pass it to that seam.
 *
 * Selection/hover/issue (GRF-02/GRF-03) are drawn by changing the stroke
 * color/width of the EXISTING id-stamped node (never by adding sibling
 * shapes), so `applyRenderModel`'s `setPosition` keeps repositioning the
 * same node during Simulate. The id-stamped node's Konva `name` also carries
 * space-separated `is-selected`/`is-hovered`/`is-issue` tokens, read by
 * `canvasTestHook.ts`'s `haloState`.
 */

import { forwardRef, type ReactNode } from "react";
import { Layer, Circle, Line, Rect, Arc, Arrow, Group } from "react-konva";
import type Konva from "konva";
import { worldToScreen, angleToKonvaRotationDeg, type Viewport } from "../viewport";
import { springZigzag, torsionalSpiral, LOAD_ARROW_LENGTH } from "../springGlyph";
import type { RenderModel } from "../renderModel";
import type { CanvasTokens } from "../../ui/theme/tokens";

export interface JointsLayerProps {
  viewport: Viewport;
  tokens: CanvasTokens;
  model: RenderModel;
}

const HATCH_TICKS = [-6, -2, 2, 6];
/** How strongly a ground pivot nothing is pinned to yet is drawn. */
const UNATTACHED_OPACITY = 0.55;

function haloNames(flags: { selected?: boolean; hovered: boolean; issue?: boolean }): string {
  const names: string[] = [];
  if (flags.selected) names.push("is-selected");
  if (flags.hovered) names.push("is-hovered");
  if (flags.issue) names.push("is-issue");
  return names.join(" ");
}

export const JointsLayer = forwardRef<Konva.Layer, JointsLayerProps>(function JointsLayer(
  { viewport, tokens, model },
  ref,
): ReactNode {
  return (
    <Layer ref={ref} listening={false}>
      {model.groundPivots.map((pivot) => {
        const s = worldToScreen(viewport, pivot.point);
        const stroke = pivot.issue ? tokens.issue : pivot.hovered ? tokens.hover : tokens.ink;
        const strokeWidth = 1.5 + (pivot.hovered ? 2 : 0);
        // Nothing uses it yet: a faded, dashed placeholder until a link is pinned to it.
        return (
          <Group
            key={`ground-${pivot.siteId}`}
            id={`ground:${pivot.siteId}`}
            name={haloNames(pivot)}
            x={s.x}
            y={s.y}
            opacity={pivot.attached ? 1 : UNATTACHED_OPACITY}
            listening={false}
          >
            <Line
              points={[-8, 8, 8, 8, 0, -6]}
              closed
              stroke={stroke}
              strokeWidth={strokeWidth}
              dash={pivot.attached ? undefined : [3, 2]}
              listening={false}
            />
            {HATCH_TICKS.map((dx) => (
              <Line
                key={dx}
                points={[dx, 8, dx - 4, 14]}
                stroke={tokens.ink}
                strokeWidth={1}
                listening={false}
              />
            ))}
          </Group>
        );
      })}

      {model.pins.map((pin) => {
        const s = worldToScreen(viewport, pin.point);
        const stroke = pin.selected ? tokens.selection : pin.hovered ? tokens.hover : tokens.ink;
        const strokeWidth = 1.5 + (pin.hovered ? 2 : 0);
        return (
          <Circle
            key={pin.jointId}
            id={`pin:${pin.jointId}`}
            name={haloNames(pin)}
            x={s.x}
            y={s.y}
            radius={5}
            fill={tokens.pin}
            stroke={stroke}
            strokeWidth={strokeWidth}
            listening={false}
          />
        );
      })}

      {model.sliders.map((slider) => {
        const s = worldToScreen(viewport, slider.point);
        const rotation = angleToKonvaRotationDeg(slider.blockAngle);
        const stroke = slider.selected
          ? tokens.selection
          : slider.hovered
            ? tokens.hover
            : tokens.ink;
        const strokeWidth = 1.5 + (slider.hovered ? 2 : 0);
        return (
          <Group
            key={slider.jointId}
            id={`slider:${slider.jointId}`}
            name={haloNames(slider)}
            x={s.x}
            y={s.y}
            rotation={rotation}
            listening={false}
          >
            <Line
              points={[-24, 0, 24, 0]}
              stroke={tokens.muted}
              strokeWidth={1}
              dash={[4, 3]}
              listening={false}
            />
            <Rect
              x={-10}
              y={-6}
              width={20}
              height={12}
              fill={tokens.panel2}
              stroke={stroke}
              strokeWidth={strokeWidth}
              listening={false}
            />
          </Group>
        );
      })}

      {model.motors.map((motor) => {
        const s = worldToScreen(viewport, motor.point);
        return (
          <Arc
            key={motor.jointId}
            id={`motor:${motor.jointId}`}
            x={s.x}
            y={s.y}
            innerRadius={9}
            outerRadius={11}
            angle={270}
            rotation={-135}
            fill={tokens.accent}
            listening={false}
          />
        );
      })}

      {model.markers.map((marker) => {
        const s = worldToScreen(viewport, marker.point);
        return (
          <Group
            key={marker.markerId}
            id={`marker:${marker.markerId}`}
            x={s.x}
            y={s.y}
            listening={false}
          >
            <Line
              points={[-6, 0, 6, 0]}
              stroke={tokens.accent}
              strokeWidth={1.5}
              listening={false}
            />
            <Line
              points={[0, -6, 0, 6]}
              stroke={tokens.accent}
              strokeWidth={1.5}
              listening={false}
            />
          </Group>
        );
      })}

      {model.springs.map((spring) => {
        const stroke = spring.selected ? tokens.selection : tokens.ok;
        const strokeWidth = spring.selected ? 2.5 : 1.5;
        if (spring.kind === "linear") {
          const a = worldToScreen(viewport, spring.a);
          const b = worldToScreen(viewport, spring.b);
          return (
            <Group
              key={spring.springId}
              id={`spring:${spring.springId}`}
              name={haloNames({ selected: spring.selected, hovered: false })}
              listening={false}
            >
              <Line
                points={springZigzag(a, b)}
                stroke={stroke}
                strokeWidth={strokeWidth}
                lineJoin="round"
                listening={false}
              />
            </Group>
          );
        }
        const s = worldToScreen(viewport, spring.point);
        return (
          <Group
            key={spring.springId}
            id={`spring:${spring.springId}`}
            name={haloNames({ selected: spring.selected, hovered: false })}
            x={s.x}
            y={s.y}
            listening={false}
          >
            <Line
              points={torsionalSpiral()}
              stroke={stroke}
              strokeWidth={strokeWidth}
              listening={false}
            />
          </Group>
        );
      })}

      {model.loads.map((load) => {
        const s = worldToScreen(viewport, load.point);
        return (
          <Group
            key={load.loadId}
            id={`load:${load.loadId}`}
            x={s.x}
            y={s.y}
            rotation={load.forceAngle === null ? 0 : angleToKonvaRotationDeg(load.forceAngle)}
            listening={false}
          >
            {load.forceAngle !== null ? (
              <Arrow
                points={[0, 0, LOAD_ARROW_LENGTH, 0]}
                stroke={tokens.err}
                fill={tokens.err}
                strokeWidth={2}
                pointerLength={7}
                pointerWidth={7}
                listening={false}
              />
            ) : null}
            {load.torqueSign !== 0 ? (
              <Arc
                innerRadius={14}
                outerRadius={16}
                angle={240}
                rotation={load.torqueSign > 0 ? 150 : -30}
                fill={tokens.err}
                listening={false}
              />
            ) : null}
          </Group>
        );
      })}

      {model.freeSites.map((site) => {
        const s = worldToScreen(viewport, site.point);
        return (
          <Circle
            key={site.siteId}
            id={`site:${site.siteId}`}
            x={s.x}
            y={s.y}
            radius={4}
            stroke={tokens.muted}
            strokeWidth={1}
            listening={false}
          />
        );
      })}
    </Layer>
  );
});
