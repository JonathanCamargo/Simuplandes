/**
 * Node-link icon of one atlas topology: pure SVG from the `IndexGraph`.
 * Ground (node 0) is a square; other nodes are circles filled by degree
 * (binary / ternary / quaternary / pentary) with the Graph tab's colors.
 */

import { memo, useMemo, type ReactNode } from "react";
import { useTheme } from "@mui/material";
import { LINK_TYPE_COLORS } from "../theme/tokens";
import { thumbnailLayout, type AtlasEntry } from "./atlasEntries";

export interface AtlasThumbnailProps {
  entry: AtlasEntry;
  size?: number;
}

const DEGREE_COLORS = [
  LINK_TYPE_COLORS.binary,
  LINK_TYPE_COLORS.ternary,
  LINK_TYPE_COLORS.quaternary,
  LINK_TYPE_COLORS.pentary,
] as const;

function AtlasThumbnailImpl({ entry, size = 96 }: AtlasThumbnailProps): ReactNode {
  const theme = useTheme();
  const layout = useMemo(() => thumbnailLayout(entry.graph, size), [entry.graph, size]);
  const degrees = useMemo(() => {
    const d = new Array<number>(entry.graph.n).fill(0);
    for (const [u, v] of entry.graph.edges) {
      d[u] += 1;
      d[v] += 1;
    }
    return d;
  }, [entry.graph]);
  const stroke = theme.palette.text.secondary;
  const half = size * 0.06;

  return (
    <svg
      role="img"
      aria-label={entry.id}
      data-testid="atlas-thumbnail"
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
    >
      {layout.edges.map(([u, v]) => (
        <line
          key={`${u}-${v}`}
          x1={layout.nodes[u].x}
          y1={layout.nodes[u].y}
          x2={layout.nodes[v].x}
          y2={layout.nodes[v].y}
          stroke={stroke}
          strokeWidth={1.5}
        />
      ))}
      {layout.nodes.map((node, i) =>
        i === 0 ? (
          <rect
            key={i}
            x={node.x - half * 1.3}
            y={node.y - half * 1.3}
            width={half * 2.6}
            height={half * 2.6}
            fill={LINK_TYPE_COLORS.ground}
            stroke={stroke}
          />
        ) : (
          <circle
            key={i}
            cx={node.x}
            cy={node.y}
            r={half}
            fill={DEGREE_COLORS[Math.min(Math.max(degrees[i] - 2, 0), 3)]}
            stroke={stroke}
          />
        ),
      )}
    </svg>
  );
}

export const AtlasThumbnail = memo(AtlasThumbnailImpl);
