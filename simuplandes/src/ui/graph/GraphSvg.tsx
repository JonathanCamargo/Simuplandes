/**
 * `GraphSvg`: plain-SVG rendering of one `LinkGraph` (GRF-01/GRF-02/GRF-03)
 * at the positions `layoutGraph` (GRF-05) computed. No layout/graph library
 * (PROJECT.md's locked decision) -- nodes/edges are hand-drawn `<circle>`/
 * `<rect>`/`<line>` elements carrying the exact DOM contract 06-06's E2E
 * relies on: `data-testid`, `data-node-id`/`data-edge-id`,
 * `data-hovered`/`data-selected`/`data-issue` as literal `"true"`/`"false"`
 * strings, `data-joint-type`, `data-ground-pivot`.
 *
 * 06-09: 1 SVG unit == 1 CSS px. `viewBox` equals `viewport`'s own measured
 * (or fallback) size, and every drawn size comes from `graphViewport.ts`'s
 * `GRAPH_PX` -- fixed screen-px constants that never shrink just because the
 * flex layout compresses the box (06-08's regression). Node positions
 * (`layoutGraph`'s unit-box output) are mapped to screen via `toScreen`.
 * Labels are computed via `placeLabels` and rendered in a separate
 * `graph-labels` layer, after the nodes, with `pointer-events: none` --
 * each node `<g>`'s own bounding box stays exactly its shape (+ rings), so
 * 06-06's `.hover()`/`.click()` at the node's center still hits the node.
 *
 * Reads/writes ONLY `studioStore.hoveredId` (via `setHoveredId`) and
 * `mechanismStore.selection` (via `select`) -- never `simStore`: the graph is
 * always the Build-mode reference-pose topology, independent of Simulate
 * playback (research Pitfall 3 / OQ4).
 */

import { useTheme } from "@mui/material";
import { useTranslation } from "react-i18next";
import { useStore, type StoreApi } from "zustand";
import { useMemo, type KeyboardEvent, type MouseEvent, type ReactNode } from "react";
import type { Id } from "../../model";
import type { MechanismStore } from "../../store";
import type { StudioState } from "../../uiState/studioStore";
import {
  GROUND_NODE_ID,
  type GraphAnalysis,
  type GraphEdge,
  type GraphNode,
  type NodePosition,
} from "../../graph";
import { LINK_TYPE_COLORS } from "../theme/tokens";
import { canvasTokensFor } from "../theme/studioTheme";
import { relativeLuminance } from "../theme/contrast";
import { computeGraphViewport, toScreen, GRAPH_PX, type GraphViewport } from "./graphViewport";
import { placeLabels, type LabelNodeInput } from "./labelPlacement";

export interface GraphSvgProps {
  analysis: GraphAnalysis;
  positions: ReadonlyMap<Id, NodePosition>;
  studioStore: StoreApi<StudioState>;
  mechanismStore: MechanismStore;
  /** Measured screen-px viewport (see `GraphPanel`'s `computeGraphViewport`). Defaults to the 360x360 fallback (jsdom / no caller-provided measurement). */
  viewport?: GraphViewport;
}

const FALLBACK_VIEWPORT = computeGraphViewport(0, 0);

const HIT_WIDTH = GRAPH_PX.edgeHitWidth;
const PARALLEL_SPACING = GRAPH_PX.parallelSpacing;

/** Shift+click toggles; a plain click replaces the selection. */
function selectionModeFor(event: { shiftKey: boolean }): "toggle" | "replace" {
  return event.shiftKey ? "toggle" : "replace";
}

/** A readable label color (near-black or near-white) against `fill`. */
function labelColorFor(fill: string): string {
  return relativeLuminance(fill) > 0.45 ? "#111111" : "#FFFFFF";
}

export function GraphSvg({
  analysis,
  positions,
  studioStore,
  mechanismStore,
  viewport = FALLBACK_VIEWPORT,
}: GraphSvgProps): ReactNode {
  const { t } = useTranslation();
  const theme = useTheme();
  const tokens = canvasTokensFor(theme.palette.mode === "dark" ? "dark" : "light");
  const hoveredId = useStore(studioStore, (s) => s.hoveredId);
  const selection = useStore(mechanismStore, (s) => s.selection);

  function setHovered(id: Id | null): void {
    studioStore.getState().setHoveredId(id);
  }

  function selectIds(ids: readonly Id[], mode: "toggle" | "replace"): void {
    mechanismStore.getState().select(ids, mode);
  }

  function nodeLabel(node: GraphNode, index: number): string {
    if (node.isGround) return node.label || t("graph.node.ground");
    return node.label || `L${index}`;
  }

  function nodeAria(node: GraphNode, label: string): string {
    return t("graph.node.aria", {
      name: label,
      type: t(`graph.linkType.${node.linkType}`),
      degree: node.degree,
    });
  }

  function edgeAria(edge: GraphEdge): string {
    const aLabel = analysis.graph.nodeById.get(edge.a)?.label || edge.a;
    const bLabel = analysis.graph.nodeById.get(edge.b)?.label || edge.b;
    return t("graph.edge.aria", { name: `${aLabel}–${bLabel}`, type: edge.type });
  }

  /** A ring (rect for the ground node, circle otherwise) `pad` px outside the node's own shape. `dataRole` is set to `"issue-ring"` only for the issue ring (additive DOM hook, 06-09). */
  function ring(
    node: GraphNode,
    cx: number,
    cy: number,
    pad: number,
    stroke: string,
    dash: string | undefined,
    key: string,
    dataRole?: "issue-ring",
  ): ReactNode {
    if (node.isGround) {
      const half = GRAPH_PX.groundHalfSide + pad;
      return (
        <rect
          key={key}
          data-role={dataRole}
          x={cx - half}
          y={cy - half}
          width={half * 2}
          height={half * 2}
          fill="none"
          stroke={stroke}
          strokeWidth={GRAPH_PX.ringStroke}
          strokeDasharray={dash}
        />
      );
    }
    return (
      <circle
        key={key}
        data-role={dataRole}
        cx={cx}
        cy={cy}
        r={GRAPH_PX.nodeRadius + pad}
        fill="none"
        stroke={stroke}
        strokeWidth={GRAPH_PX.ringStroke}
        strokeDasharray={dash}
      />
    );
  }

  // Parallel edges (same unordered node pair) are spread apart by a fixed
  // perpendicular offset so both remain visible as distinct straight lines
  // (the DOM contract fixes edges as `<line>`s, not curved `<path>`s).
  const edgesByPair = new Map<string, GraphEdge[]>();
  for (const edge of analysis.graph.edges) {
    const key = [edge.a, edge.b].sort().join("::");
    const bucket = edgesByPair.get(key);
    if (bucket) bucket.push(edge);
    else edgesByPair.set(key, [edge]);
  }
  const offsetOfEdge = new Map<Id, number>();
  for (const bucket of edgesByPair.values()) {
    const count = bucket.length;
    bucket.forEach((edge, i) => {
      offsetOfEdge.set(edge.id, (i - (count - 1) / 2) * PARALLEL_SPACING);
    });
  }

  const labelPlacements = useMemo(() => {
    const inputs: LabelNodeInput[] = analysis.graph.nodes
      .map((node, index) => {
        const pos = positions.get(node.id);
        if (!pos) return null;
        const screen = toScreen(pos, viewport);
        return {
          id: node.id,
          cx: screen.x,
          cy: screen.y,
          shape: node.isGround ? ("square" as const) : ("circle" as const),
          label: nodeLabel(node, index),
        };
      })
      .filter((input): input is LabelNodeInput => input !== null);
    return placeLabels(inputs, viewport);
    // `t` (language) affects `nodeLabel`'s ground fallback text.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [analysis, positions, viewport, t]);

  return (
    <svg
      data-testid="graph-svg"
      role="group"
      aria-label={t("graph.panel.svgLabel")}
      viewBox={`0 0 ${viewport.width} ${viewport.height}`}
      preserveAspectRatio="xMidYMid meet"
      width="100%"
      style={{ display: "block", width: "100%", height: "100%" }}
    >
      <g data-testid="graph-edges">
        {analysis.graph.edges.map((edge) => {
          const posA = positions.get(edge.a);
          const posB = positions.get(edge.b);
          if (!posA || !posB) return null;

          const hovered = hoveredId === edge.jointId;
          const selected = selection.has(edge.jointId);
          const issue = analysis.issueEdgeIds.has(edge.id);
          const offset = offsetOfEdge.get(edge.id) ?? 0;
          const isPrismatic = edge.type === "P";

          const screenA = toScreen(posA, viewport);
          const screenB = toScreen(posB, viewport);
          let x1 = screenA.x;
          let y1 = screenA.y;
          let x2 = screenB.x;
          let y2 = screenB.y;
          const dx0 = x2 - x1;
          const dy0 = y2 - y1;
          const len0 = Math.hypot(dx0, dy0) || 1;
          if (offset !== 0) {
            const ux = -dy0 / len0;
            const uy = dx0 / len0;
            x1 += ux * offset;
            y1 += uy * offset;
            x2 += ux * offset;
            y2 += uy * offset;
          }

          const stroke = issue
            ? tokens.issue
            : selected
              ? tokens.selection
              : hovered
                ? tokens.hover
                : edge.groundPivot
                  ? LINK_TYPE_COLORS.ground
                  : theme.palette.text.secondary;
          const strokeWidth = hovered || selected ? GRAPH_PX.edgeStrokeActive : GRAPH_PX.edgeStroke;

          let hatch: ReactNode = null;
          if (edge.groundPivot) {
            const groundIsA = edge.a === GROUND_NODE_ID;
            const dirX = dx0 / len0;
            const dirY = dy0 / len0;
            const perpX = -dirY;
            const perpY = dirX;
            const along = groundIsA ? 1 : -1;
            const baseX = (groundIsA ? x1 : x2) + dirX * along * GRAPH_PX.hatchOffset;
            const baseY = (groundIsA ? y1 : y2) + dirY * along * GRAPH_PX.hatchOffset;
            hatch = (
              <line
                key="hatch"
                x1={baseX - perpX * GRAPH_PX.hatchHalf}
                y1={baseY - perpY * GRAPH_PX.hatchHalf}
                x2={baseX + perpX * GRAPH_PX.hatchHalf}
                y2={baseY + perpY * GRAPH_PX.hatchHalf}
                stroke={LINK_TYPE_COLORS.ground}
                strokeWidth={GRAPH_PX.edgeStroke}
              />
            );
          }

          return (
            <g
              key={edge.id}
              data-testid="graph-edge"
              data-edge-id={edge.jointId}
              data-joint-type={edge.type}
              data-ground-pivot={edge.groundPivot ? "true" : "false"}
              data-hovered={hovered ? "true" : "false"}
              data-selected={selected ? "true" : "false"}
              data-issue={issue ? "true" : "false"}
              aria-label={edgeAria(edge)}
              style={{ cursor: "pointer" }}
              onPointerEnter={() => setHovered(edge.jointId)}
              onPointerLeave={() => setHovered(null)}
              onClick={(event: MouseEvent<SVGGElement>) =>
                selectIds([edge.jointId], selectionModeFor(event))
              }
            >
              <title>{edgeAria(edge)}</title>
              <line
                x1={x1}
                y1={y1}
                x2={x2}
                y2={y2}
                stroke={stroke}
                strokeWidth={strokeWidth}
                strokeDasharray={isPrismatic ? GRAPH_PX.prismaticDash : undefined}
              />
              {hatch}
              <line
                x1={x1}
                y1={y1}
                x2={x2}
                y2={y2}
                stroke="transparent"
                strokeWidth={HIT_WIDTH}
                style={{ pointerEvents: "stroke" }}
              />
            </g>
          );
        })}
      </g>

      <g data-testid="graph-nodes">
        {analysis.graph.nodes.map((node, index) => {
          const pos = positions.get(node.id);
          if (!pos) return null;
          const { x: cx, y: cy } = toScreen(pos, viewport);
          const hoverLinkId: Id | null = node.linkIds[0] ?? null;
          const hovered = hoveredId !== null && node.linkIds.includes(hoveredId);
          const selected = node.linkIds.some((id) => selection.has(id));
          const issue = analysis.issueNodeIds.has(node.id);
          const fill = LINK_TYPE_COLORS[node.linkType];
          const label = nodeLabel(node, index);
          const aria = nodeAria(node, label);

          function activate(event: { shiftKey: boolean }): void {
            selectIds(node.linkIds, selectionModeFor(event));
          }

          return (
            <g
              key={node.id}
              data-testid="graph-node"
              data-node-id={node.id}
              data-link-type={node.linkType}
              data-hovered={hovered ? "true" : "false"}
              data-selected={selected ? "true" : "false"}
              data-issue={issue ? "true" : "false"}
              role="button"
              tabIndex={0}
              aria-label={aria}
              style={{ cursor: "pointer" }}
              onPointerEnter={() => setHovered(hoverLinkId)}
              onPointerLeave={() => setHovered(null)}
              onFocus={() => setHovered(hoverLinkId)}
              onBlur={() => setHovered(null)}
              onClick={(event: MouseEvent<SVGGElement>) => activate(event)}
              onKeyDown={(event: KeyboardEvent<SVGGElement>) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  activate(event);
                }
              }}
            >
              <title>{aria}</title>
              {issue
                ? ring(
                    node,
                    cx,
                    cy,
                    GRAPH_PX.issueRingPad,
                    tokens.issue,
                    GRAPH_PX.issueDash,
                    "ring-issue",
                    "issue-ring",
                  )
                : null}
              {hovered
                ? ring(node, cx, cy, GRAPH_PX.hoverRingPad, tokens.hover, undefined, "ring-hover")
                : null}
              {selected
                ? ring(
                    node,
                    cx,
                    cy,
                    GRAPH_PX.selectedRingPad,
                    tokens.selection,
                    undefined,
                    "ring-selected",
                  )
                : null}
              {node.isGround ? (
                <rect
                  data-role="node-shape"
                  x={cx - GRAPH_PX.groundHalfSide}
                  y={cy - GRAPH_PX.groundHalfSide}
                  width={GRAPH_PX.groundHalfSide * 2}
                  height={GRAPH_PX.groundHalfSide * 2}
                  fill={fill}
                  stroke={theme.palette.text.primary}
                  strokeWidth={GRAPH_PX.shapeStroke}
                />
              ) : (
                <circle
                  data-role="node-shape"
                  cx={cx}
                  cy={cy}
                  r={GRAPH_PX.nodeRadius}
                  fill={fill}
                  stroke={theme.palette.text.primary}
                  strokeWidth={GRAPH_PX.shapeStroke}
                />
              )}
            </g>
          );
        })}
      </g>

      <g data-testid="graph-labels" style={{ pointerEvents: "none" }}>
        {analysis.graph.nodes.map((node) => {
          const placed = labelPlacements.get(node.id);
          if (!placed) return null;
          const fill = LINK_TYPE_COLORS[node.linkType];
          const isInside = placed.placement === "inside";
          return (
            <text
              key={node.id}
              data-role="node-label"
              data-label-for={node.id}
              data-label-truncated={placed.truncated ? "true" : "false"}
              data-label-placement={placed.placement}
              x={placed.x}
              y={placed.y}
              textAnchor={placed.textAnchor}
              dominantBaseline="central"
              fontSize={placed.fontSize}
              fill={isInside ? labelColorFor(fill) : theme.palette.text.primary}
              stroke={isInside ? undefined : theme.palette.background.paper}
              strokeWidth={isInside ? undefined : GRAPH_PX.labelHalo}
              strokeLinejoin={isInside ? undefined : "round"}
              paintOrder={isInside ? undefined : "stroke"}
              style={{ pointerEvents: "none", userSelect: "none" }}
            >
              {placed.text}
            </text>
          );
        })}
      </g>
    </svg>
  );
}
