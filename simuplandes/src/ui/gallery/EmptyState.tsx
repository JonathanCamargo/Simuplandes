/**
 * Empty-state overlay over the canvas (UX-02). Visible only for an empty
 * document with the Select tool in Build mode, until dismissed this session.
 * The wrapper is `pointer-events: none` so canvas clicks are never swallowed;
 * only the card itself is interactive (research Pitfall 5).
 */

import { useState, type ReactNode } from "react";
import { useStore, type StoreApi } from "zustand";
import { Box, Button, IconButton, Paper, Typography } from "@mui/material";
import { useTranslation } from "react-i18next";
import type { MechanismStore } from "../../store";
import type { StudioState } from "../../uiState/studioStore";
import { ExamplesGallery } from "./ExamplesGallery";

export interface EmptyStateProps {
  store: MechanismStore;
  studio: StoreApi<StudioState>;
  /** Extra actions after the import and atlas buttons. */
  extraActions?: ReactNode;
}

export function EmptyState({ store, studio, extraActions }: EmptyStateProps): ReactNode {
  const { t } = useTranslation();
  const [dismissed, setDismissed] = useState(false);
  const linkCount = useStore(store, (s) => s.document.links.length);
  const activeTool = useStore(studio, (s) => s.activeTool);
  const mode = useStore(studio, (s) => s.mode);

  if (dismissed || linkCount > 0 || activeTool !== "select" || mode !== "build") return null;

  return (
    <Box
      data-testid="empty-state"
      sx={{
        position: "absolute",
        inset: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        pointerEvents: "none",
      }}
    >
      <Paper
        elevation={3}
        sx={{ pointerEvents: "auto", p: 2, maxWidth: 640, position: "relative" }}
      >
        <IconButton
          size="small"
          aria-label={t("gallery.empty.dismiss")}
          onClick={() => setDismissed(true)}
          sx={{ position: "absolute", top: 4, right: 4 }}
        >
          <Box component="span" aria-hidden sx={{ fontSize: 14, lineHeight: 1 }}>
            ✕
          </Box>
        </IconButton>
        <Typography variant="h6" component="h2" sx={{ pr: 4 }}>
          {t("gallery.empty.title")}
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
          {t("gallery.empty.text")}
        </Typography>
        <ExamplesGallery store={store} studio={studio} variant="inline" />
        <Box sx={{ display: "flex", gap: 1, mt: 1.5, justifyContent: "center" }}>
          <Button
            size="small"
            variant="outlined"
            onClick={() => studio.getState().openDialog("import")}
          >
            {t("gallery.empty.import")}
          </Button>
          <Button
            size="small"
            variant="outlined"
            data-testid="empty-state-atlas"
            onClick={() => studio.getState().openDialog("atlas")}
          >
            {t("gallery.empty.atlas")}
          </Button>
          {extraActions}
        </Box>
      </Paper>
    </Box>
  );
}
