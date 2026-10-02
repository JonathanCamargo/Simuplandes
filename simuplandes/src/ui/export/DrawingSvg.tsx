/**
 * `DrawingSvg`: a pure-SVG twin of the canvas drawing over
 * `buildRenderModel`'s WORLD-space primitives (XCH-09). Konva has no native
 * SVG export (research, confirmed) -- this renders the SAME data
 * `LinksLayer`/`JointsLayer` consume as plain `<line>`/`<polygon>`/`<circle>`/
 * `<rect>` elements instead of Konva shapes, so "Drawing as SVG" is a real,
 * standalone vector file rather than a screenshot.
 *
 * World -> SVG uses the SAME `worldToScreen` mapping `CanvasStage` uses
 * (WYSIWYG): `view.viewport` maps world points into the `view.widthPx` x
 * `view.heightPx` box exactly like the canvas does, and every stroke
 * width/radius below is the same screen-px constant `LinksLayer`/
 * `JointsLayer` draw with. Colors come from `canvasTokensFor(themeMode)` (a
 * pure data lookup, no MUI/store dependency) plus each primitive's own
 * `color` (already resolved by `buildRenderModel` to the link-type palette or
 * the link's own override). No selection/hover/issue halos and no free sites
 * (export is clean, per plan). No full-size background rect -- the SVG is
 * transparent.
 *
 * `renderDrawingSvgText(...)` is the export entry point
 * (`renderToStaticMarkup` + an `xmlns` guarantee); `DrawingSvg` itself is
 * exported too as a plain function component for any future in-app preview.
 *
 * `src/ui/export` may not import `src/kinematics` (ESLint seam): `poses`/
 * `traces` are plain data the caller (08-05's `ExportPanel`) already has
 * (from `posesSource`/`simStore`), never read from a store in here.
 */

import { renderToStaticMarkup } from "react-dom/server";
import type { ReactNode } from "react";
import { buildRenderModel } from "../../canvas/renderModel";
import { worldToScreen, angleToKonvaRotationDeg, type Viewport } from "../../canvas/viewport";
import type { TracePrimitive } from "../../canvas/posesSource";
import type { Id, MechanismDocument, Pose } from "../../model";
import { canvasTokensFor } from "../theme/studioTheme";
import type { ThemeMode } from "../../uiState/preferences";

/** The world<->screen mapping plus the CSS box size, matching what `CanvasArea` measures. */
export interface DrawingSvgView {
  viewport: Viewport;
  widthPx: number;
  heightPx: number;
}

export interface DrawingSvgProps {
  doc: MechanismDocument;
  /** Phase 5 seam override -- undefined renders the document's own reference poses (Build mode). */
  poses?: ReadonlyMap<Id, Pose>;
  /** Visible coupler-curve traces (Simulate mode only). */
  traces?: readonly TracePrimitive[];
  view: DrawingSvgView;
  themeMode: ThemeMode;
}

const GROUND_TRIANGLE = "-8,8 8,8 0,-6";
const HATCH_TICKS = [-6, -2, 2, 6];

function screenXY(viewport: Viewport, p: { x: number; y: number }): { x: number; y: number } {
  return worldToScreen(viewport, p);
}

function screenPolyline(viewport: Viewport, points: readonly { x: number; y: number }[]): string {
  return points
    .map((p) => {
      const s = screenXY(viewport, p);
      return `${s.x},${s.y}`;
    })
    .join(" ");
}

function screenTracePoints(viewport: Viewport, points: Float64Array | readonly number[]): string {
  const flat: string[] = [];
  for (let i = 0; i + 1 < points.length; i += 2) {
    const s = screenXY(viewport, { x: points[i], y: points[i + 1] });
    flat.push(`${s.x},${s.y}`);
  }
  return flat.join(" ");
}

/** `DrawingSvg`: the pure-SVG twin, framed to `view` at the pose `poses` (or the document's own reference pose) describes. */
export function DrawingSvg({ doc, poses, traces, view, themeMode }: DrawingSvgProps): ReactNode {
  const tokens = canvasTokensFor(themeMode);
  const model = buildRenderModel(doc, new Set<Id>(), { poses });
  const { viewport, widthPx, heightPx } = view;

  return (
    <svg
      data-testid="drawing-svg"
      xmlns="http://www.w3.org/2000/svg"
      width={widthPx}
      height={heightPx}
      viewBox={`0 0 ${widthPx} ${heightPx}`}
    >
      {traces?.map((trace) => (
        <polyline
          key={trace.markerId}
          data-kind="trace"
          data-id={trace.markerId}
          points={screenTracePoints(viewport, trace.points)}
          fill="none"
          stroke={tokens.accent}
          strokeWidth={1.5}
        />
      ))}

      {model.plates.map((plate) => (
        <polygon
          key={plate.linkId}
          data-kind="plate"
          data-id={plate.linkId}
          points={screenPolyline(viewport, plate.points)}
          fill={plate.color}
          fillOpacity={0.35}
          stroke={tokens.linkOutline}
          strokeWidth={2}
        />
      ))}

      {model.bars.map((bar) => {
        const points = screenPolyline(viewport, bar.points);
        return (
          <g key={bar.linkId} data-kind="bar" data-id={bar.linkId}>
            <polyline
              points={points}
              fill="none"
              stroke={tokens.linkOutline}
              strokeWidth={10}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <polyline
              points={points}
              fill="none"
              stroke={bar.color}
              strokeWidth={7}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </g>
        );
      })}

      {model.groundPivots.map((pivot) => {
        const s = screenXY(viewport, pivot.point);
        return (
          <g
            key={pivot.siteId}
            data-kind="ground-pivot"
            data-id={pivot.siteId}
            transform={`translate(${s.x},${s.y})`}
          >
            <polygon points={GROUND_TRIANGLE} fill="none" stroke={tokens.ink} strokeWidth={1.5} />
            {HATCH_TICKS.map((dx) => (
              <line
                key={dx}
                x1={dx}
                y1={8}
                x2={dx - 4}
                y2={14}
                stroke={tokens.ink}
                strokeWidth={1}
              />
            ))}
          </g>
        );
      })}

      {model.pins.map((pin) => {
        const s = screenXY(viewport, pin.point);
        return (
          <circle
            key={pin.jointId}
            data-kind="pin"
            data-id={pin.jointId}
            cx={s.x}
            cy={s.y}
            r={5}
            fill={tokens.pin}
            stroke={tokens.ink}
            strokeWidth={1.5}
          />
        );
      })}

      {model.sliders.map((slider) => {
        const s = screenXY(viewport, slider.point);
        const rotation = angleToKonvaRotationDeg(slider.blockAngle);
        return (
          <g
            key={slider.jointId}
            data-kind="slider"
            data-id={slider.jointId}
            transform={`translate(${s.x},${s.y}) rotate(${rotation})`}
          >
            <line
              x1={-24}
              y1={0}
              x2={24}
              y2={0}
              stroke={tokens.muted}
              strokeWidth={1}
              strokeDasharray="4 3"
            />
            <rect
              x={-10}
              y={-6}
              width={20}
              height={12}
              fill={tokens.panel2}
              stroke={tokens.ink}
              strokeWidth={1.5}
            />
          </g>
        );
      })}

      {model.motors.map((motor) => {
        const s = screenXY(viewport, motor.point);
        return (
          <circle
            key={motor.jointId}
            data-kind="motor"
            data-id={motor.jointId}
            cx={s.x}
            cy={s.y}
            r={10}
            fill="none"
            stroke={tokens.accent}
            strokeWidth={2}
          />
        );
      })}

      {model.markers.map((marker) => {
        const s = screenXY(viewport, marker.point);
        return (
          <g key={marker.markerId} data-kind="marker" data-id={marker.markerId}>
            <line
              x1={s.x - 6}
              y1={s.y}
              x2={s.x + 6}
              y2={s.y}
              stroke={tokens.accent}
              strokeWidth={1.5}
            />
            <line
              x1={s.x}
              y1={s.y - 6}
              x2={s.x}
              y2={s.y + 6}
              stroke={tokens.accent}
              strokeWidth={1.5}
            />
          </g>
        );
      })}
    </svg>
  );
}

/** `renderDrawingSvgText(props)`: the exported markup as a standalone string (an `xmlns` is always present, even if a future React version ever dropped the JSX prop from the output). */
// eslint-disable-next-line react-refresh/only-export-components -- export entry point, not a hot-reloadable component module boundary
export function renderDrawingSvgText(props: DrawingSvgProps): string {
  const markup = renderToStaticMarkup(<DrawingSvg {...props} />);
  return markup.includes("xmlns=")
    ? markup
    : markup.replace("<svg", '<svg xmlns="http://www.w3.org/2000/svg"');
}
