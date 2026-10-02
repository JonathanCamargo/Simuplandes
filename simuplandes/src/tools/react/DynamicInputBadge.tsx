/**
 * The CAD-style floating "L [120] · ∠ [30]°" badge shown next to the
 * cursor while a tool's dynamic length/angle buffer has any typed text
 * (EDT-07). A plain absolutely-positioned MUI `Paper` in the DOM overlay
 * (not Konva) -- `useToolController`'s `dynamicInput.screenAt` gives its
 * screen position.
 */

import type { ReactNode } from "react";
import { Box, Paper } from "@mui/material";
import type { DynamicInputState } from "../dynamicInput";
import type { Vec2 } from "../../geom";

export interface DynamicInputBadgeProps {
  dynamicInput?: { state: DynamicInputState; screenAt: Vec2 };
}

export function DynamicInputBadge({ dynamicInput }: DynamicInputBadgeProps): ReactNode {
  if (!dynamicInput) return null;
  const { state, screenAt } = dynamicInput;
  if (state.length === "" && state.angle === "") return null;

  return (
    <Paper
      elevation={3}
      data-testid="dynamic-input-badge"
      sx={{
        position: "absolute",
        left: screenAt.x + 14,
        top: screenAt.y + 14,
        px: 1,
        py: 0.5,
        display: "flex",
        gap: 1,
        fontSize: 13,
        fontFamily: "monospace",
        pointerEvents: "none",
        zIndex: 5,
      }}
    >
      <Box
        component="span"
        data-testid="dynamic-input-length"
        data-active={state.field === "length"}
        sx={{ fontWeight: state.field === "length" ? 700 : 400 }}
      >
        L {state.length}
      </Box>
      <Box
        component="span"
        data-testid="dynamic-input-angle"
        data-active={state.field === "angle"}
        sx={{ fontWeight: state.field === "angle" ? 700 : 400 }}
      >
        ∠ {state.angle}°
      </Box>
    </Paper>
  );
}
