/**
 * The annotation toolbar at the canvas's top-left. With the Brush it picks
 * the color and width of the NEXT stroke (strokes already drawn keep
 * theirs); the choice is a per-viewer preference, not part of the
 * document. With the Eraser it offers "Clear all notes" (one undo step).
 * Mouse-downs never take focus, so Space and Escape keep going to the
 * studio shortcuts and the tool.
 */

import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useStore, type StoreApi } from "zustand";
import { Box, Button, Paper, ToggleButton, ToggleButtonGroup } from "@mui/material";
import { clearAllAnnotations, type MechanismStore } from "../../store";
import { ANNOTATION_COLORS, type AnnotationColor } from "../../model";
import type { CanvasTokens } from "../../ui/theme/tokens";
import {
  BRUSH_WIDTHS_PX,
  type BrushWidthPx,
  type PreferencesState,
} from "../../uiState/preferences";
import type { StudioState } from "../../uiState/studioStore";

export interface BrushToolbarProps {
  store: MechanismStore;
  studio: StoreApi<StudioState>;
  preferences: StoreApi<PreferencesState>;
  tokens: CanvasTokens;
}

export function BrushToolbar({ store, studio, preferences, tokens }: BrushToolbarProps): ReactNode {
  const { t } = useTranslation();
  const tool = useStore(studio, (s) =>
    s.mode === "draw" && (s.activeTool === "brush" || s.activeTool === "eraser")
      ? s.activeTool
      : null,
  );
  const color = useStore(preferences, (s) => s.brushColor);
  const widthPx = useStore(preferences, (s) => s.brushWidthPx);
  const hasNotes = useStore(store, (s) => s.document.annotations.length > 0);
  if (tool === null) return null;

  if (tool === "eraser") {
    return (
      <Paper
        elevation={3}
        data-testid="eraser-toolbar"
        role="toolbar"
        aria-label={t("tools.eraser.toolbar")}
        onMouseDown={(event) => event.preventDefault()}
        sx={{ position: "absolute", top: 32, left: 32, p: 0.5, zIndex: 5 }}
      >
        <Button size="small" disabled={!hasNotes} onClick={() => clearAllAnnotations(store)}>
          {t("tools.eraser.clearAll")}
        </Button>
      </Paper>
    );
  }

  return (
    <Paper
      elevation={3}
      data-testid="brush-toolbar"
      role="toolbar"
      aria-label={t("tools.brush.toolbar")}
      onMouseDown={(event) => event.preventDefault()}
      sx={{ position: "absolute", top: 32, left: 32, display: "flex", gap: 1, p: 0.5, zIndex: 5 }}
    >
      <ToggleButtonGroup
        exclusive
        size="small"
        value={color}
        aria-label={t("tools.brush.color")}
        onChange={(_event, next: AnnotationColor | null) => {
          if (next !== null) preferences.getState().setBrushColor(next);
        }}
      >
        {ANNOTATION_COLORS.map((c) => (
          <ToggleButton
            key={c}
            value={c}
            aria-label={t(`tools.brush.colors.${c}`)}
            sx={{ p: 0.75 }}
          >
            <Box
              sx={{
                width: 14,
                height: 14,
                borderRadius: "50%",
                bgcolor: tokens.annotation[c],
                border: 1,
                borderColor: "divider",
              }}
            />
          </ToggleButton>
        ))}
      </ToggleButtonGroup>
      <ToggleButtonGroup
        exclusive
        size="small"
        value={widthPx}
        aria-label={t("tools.brush.width")}
        onChange={(_event, next: BrushWidthPx | null) => {
          if (next !== null) preferences.getState().setBrushWidthPx(next);
        }}
      >
        {BRUSH_WIDTHS_PX.map((w) => (
          <ToggleButton
            key={w}
            value={w}
            aria-label={t("tools.brush.widthPx", { px: w })}
            sx={{ px: 1, py: 0.75 }}
          >
            <Box sx={{ width: 18, height: w, borderRadius: w, bgcolor: "text.primary" }} />
          </ToggleButton>
        ))}
      </ToggleButtonGroup>
    </Paper>
  );
}
