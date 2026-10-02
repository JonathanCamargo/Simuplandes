/**
 * The examples gallery (UX-02). Two variants share one grid: `dialog` (open
 * while `studio.dialog === "examples"`) and `inline` (inside the empty-state
 * card). Picking an example loads it through `commitImportedDocument` with
 * `simulate: true`, so Play moves it with no setup. When the current drawing
 * has edits, `ReplaceConfirm` asks first.
 */

import { useState, type ReactNode } from "react";
import { useStore, type StoreApi } from "zustand";
import { Box, Dialog, DialogContent, DialogTitle, IconButton } from "@mui/material";
import { useTranslation } from "react-i18next";
import type { MechanismStore } from "../../store";
import type { StudioState } from "../../uiState/studioStore";
import { EXAMPLES, loadExampleDocument, type ExampleId } from "../../examples/registry";
import { commitImportedDocument } from "../import/commitDocument";
import { ExampleCard } from "./ExampleCard";
import { ReplaceConfirm } from "./ReplaceConfirm";

export interface ExamplesGalleryProps {
  store: MechanismStore;
  studio: StoreApi<StudioState>;
  variant: "dialog" | "inline";
}

export function ExamplesGallery({ store, studio, variant }: ExamplesGalleryProps): ReactNode {
  const { t } = useTranslation();
  const dialog = useStore(studio, (s) => s.dialog);
  const [pending, setPending] = useState<ExampleId | null>(null);

  function load(id: ExampleId): void {
    commitImportedDocument(loadExampleDocument(id), {
      mechanismStore: store,
      studioStore: studio,
      simulate: true,
    });
  }

  function handleSelect(id: ExampleId): void {
    const { document, canUndo } = store.getState();
    if (document.links.length > 0 && canUndo) {
      setPending(id);
      return;
    }
    load(id);
  }

  const grid = (
    <Box
      data-testid="examples-gallery"
      sx={{ display: "flex", flexWrap: "wrap", gap: 1.5, justifyContent: "center" }}
    >
      {EXAMPLES.map((example) => (
        <ExampleCard key={example.id} example={example} onSelect={handleSelect} />
      ))}
    </Box>
  );

  const confirm = (
    <ReplaceConfirm
      open={pending !== null}
      onCancel={() => setPending(null)}
      onConfirm={() => {
        const id = pending;
        setPending(null);
        if (id !== null) load(id);
      }}
    />
  );

  if (variant === "inline") {
    return (
      <>
        {grid}
        {confirm}
      </>
    );
  }

  return (
    <>
      <Dialog
        open={dialog === "examples"}
        onClose={() => studio.getState().closeDialog()}
        maxWidth="md"
        fullWidth
        aria-labelledby="examples-gallery-title"
      >
        <DialogTitle
          id="examples-gallery-title"
          sx={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}
        >
          {t("gallery.title")}
          <IconButton
            size="small"
            aria-label={t("gallery.close")}
            onClick={() => studio.getState().closeDialog()}
          >
            <Box component="span" aria-hidden sx={{ fontSize: 16, lineHeight: 1 }}>
              ✕
            </Box>
          </IconButton>
        </DialogTitle>
        <DialogContent>{grid}</DialogContent>
      </Dialog>
      {confirm}
    </>
  );
}
