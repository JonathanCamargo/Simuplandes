/**
 * The Image tool's toolbar at the canvas's top-left: import (or replace)
 * the background reference image, set its exact width in model units and
 * its opacity, or remove it. A new image is downscaled to at most
 * `MAX_IMAGE_EDGE_PX` on its long edge before it is embedded, so the
 * document (and the browser's autosave) stays small, and is placed to fill
 * most of the current view. Moving and scaling with the pointer is the
 * tool's own job (`imageTool.ts`).
 */

import { useRef, useState, type ChangeEvent, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useStore, type StoreApi } from "zustand";
import { Button, InputAdornment, Paper, Slider, TextField, Typography } from "@mui/material";
import { setBackgroundImage, type MechanismStore } from "../../store";
import type { BackgroundImage, Vec2Tuple } from "../../model";
import type { StudioState } from "../../uiState/studioStore";
import type { ViewStore } from "../../canvas/viewStore";

/** The longest edge, in pixels, an imported image keeps. */
export const MAX_IMAGE_EDGE_PX = 2048;
/** Above this many characters a PNG is re-encoded as JPEG (no transparency, far smaller). */
const MAX_PNG_DATA_URL_CHARS = 1_500_000;
/** The share of the view a newly imported image fills. */
const IMPORT_VIEW_FILL = 0.8;
const DEFAULT_OPACITY = 0.5;

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new window.Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("unreadable image"));
    image.src = src;
  });
}

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () =>
      typeof reader.result === "string"
        ? resolve(reader.result)
        : reject(new Error("unreadable file"));
    reader.onerror = () => reject(reader.error ?? new Error("unreadable file"));
    reader.readAsDataURL(file);
  });
}

/** Decodes `file` and re-encodes it at most `MAX_IMAGE_EDGE_PX` on its long edge. */
async function encodeImageFile(
  file: File,
): Promise<{ src: string; widthPx: number; heightPx: number }> {
  const image = await loadImage(await readAsDataUrl(file));
  const scale = Math.min(1, MAX_IMAGE_EDGE_PX / Math.max(image.naturalWidth, image.naturalHeight));
  const widthPx = Math.max(1, Math.round(image.naturalWidth * scale));
  const heightPx = Math.max(1, Math.round(image.naturalHeight * scale));
  const canvas = document.createElement("canvas");
  canvas.width = widthPx;
  canvas.height = heightPx;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("no 2d canvas");
  // Photos go straight to JPEG; anything else keeps PNG (and its
  // transparency) unless that comes out too large.
  let src = "";
  if (file.type !== "image/jpeg") {
    context.drawImage(image, 0, 0, widthPx, heightPx);
    src = canvas.toDataURL("image/png");
  }
  if (src === "" || src.length > MAX_PNG_DATA_URL_CHARS) {
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, widthPx, heightPx);
    context.drawImage(image, 0, 0, widthPx, heightPx);
    src = canvas.toDataURL("image/jpeg", 0.85);
  }
  return { src, widthPx, heightPx };
}

/** Parses a typed length ("120", "12,5"); `null` unless it is a positive, finite number. */
function parseLength(text: string): number | null {
  const value = Number(text.trim().replace(",", "."));
  return Number.isFinite(value) && value > 0 ? value : null;
}

function formatLength(value: number): string {
  return String(Math.round(value * 100) / 100);
}

export interface BackgroundToolbarProps {
  store: MechanismStore;
  studio: StoreApi<StudioState>;
  view: ViewStore;
}

export function BackgroundToolbar({ store, studio, view }: BackgroundToolbarProps): ReactNode {
  const { t } = useTranslation();
  const active = useStore(studio, (s) => s.mode === "draw" && s.activeTool === "image");
  const background = useStore(store, (s) => s.document.background);
  const lengthUnit = useStore(store, (s) => s.document.units.length);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);
  // The width being typed; `null` shows the document's own value.
  const [widthDraft, setWidthDraft] = useState<string | null>(null);
  // One opacity drag is one undo step: the key changes when a drag ends.
  const opacityGestureRef = useRef(0);

  if (!active) return null;

  function apply(next: BackgroundImage | undefined, coalesceKey?: string): void {
    store
      .getState()
      .execute(
        next ? "edit-background" : "remove-background",
        setBackgroundImage(next),
        coalesceKey ? { coalesceKey } : undefined,
      );
  }

  async function handleFile(event: ChangeEvent<HTMLInputElement>): Promise<void> {
    const file = event.target.files?.[0];
    // Cleared so picking the same file again still fires a change.
    event.target.value = "";
    if (!file) return;
    setBusy(true);
    setError(false);
    try {
      const { src, widthPx, heightPx } = await encodeImageFile(file);
      const aspect = heightPx / widthPx;
      const current = store.getState().document.background;
      let center: Vec2Tuple;
      let width: number;
      if (current) {
        // A replacement keeps the old image's place and width.
        center = current.center;
        width = current.width;
      } else {
        const { panWorld, zoom, widthPx: viewW, heightPx: viewH } = view.getState().viewport;
        const fitW = (viewW * IMPORT_VIEW_FILL) / zoom;
        const fitH = (viewH * IMPORT_VIEW_FILL) / zoom;
        center = [panWorld.x, panWorld.y];
        width = Math.min(fitW, fitH / aspect);
      }
      apply({
        src,
        center,
        width,
        height: width * aspect,
        opacity: current?.opacity ?? DEFAULT_OPACITY,
      });
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  }

  function commitWidth(): void {
    if (widthDraft === null) return;
    const width = parseLength(widthDraft);
    setWidthDraft(null);
    const bg = store.getState().document.background;
    if (!bg || width === null || width === bg.width) return;
    // Resized about its centre, keeping its proportions.
    apply({ ...bg, width, height: (width * bg.height) / bg.width });
  }

  return (
    <Paper
      elevation={3}
      data-testid="background-toolbar"
      role="toolbar"
      aria-label={t("tools.image.toolbar")}
      sx={{
        position: "absolute",
        top: 32,
        left: 32,
        maxWidth: "calc(100% - 96px)",
        display: "flex",
        flexWrap: "wrap",
        alignItems: "center",
        gap: 1,
        p: 0.5,
        zIndex: 5,
      }}
    >
      <input
        ref={fileInputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif"
        hidden
        data-testid="background-file-input"
        onChange={(event) => void handleFile(event)}
      />
      <Button
        size="small"
        disabled={busy}
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => fileInputRef.current?.click()}
      >
        {background ? t("tools.image.replace") : t("tools.image.import")}
      </Button>
      {background ? (
        <>
          <TextField
            size="small"
            label={t("tools.image.width")}
            value={widthDraft ?? formatLength(background.width)}
            onChange={(event) => setWidthDraft(event.target.value)}
            onBlur={commitWidth}
            onKeyDown={(event) => {
              // Keeps Enter/Escape from reaching the tool and studio shortcuts.
              event.stopPropagation();
              if (event.key === "Enter") commitWidth();
              if (event.key === "Escape") setWidthDraft(null);
            }}
            error={widthDraft !== null && parseLength(widthDraft) === null}
            inputProps={{ inputMode: "decimal", "aria-label": t("tools.image.width") }}
            InputProps={{
              endAdornment: <InputAdornment position="end">{lengthUnit}</InputAdornment>,
            }}
            sx={{ width: 130 }}
          />
          <Typography variant="caption" component="label" id="background-opacity-label">
            {t("tools.image.opacity")}
          </Typography>
          <Slider
            size="small"
            min={0.1}
            max={1}
            step={0.05}
            value={background.opacity}
            aria-labelledby="background-opacity-label"
            onChange={(_event, value) => {
              const bg = store.getState().document.background;
              if (bg && typeof value === "number") {
                apply({ ...bg, opacity: value }, `background-opacity-${opacityGestureRef.current}`);
              }
            }}
            onChangeCommitted={() => {
              opacityGestureRef.current += 1;
            }}
            sx={{ width: 100, mx: 1 }}
          />
          <Button
            size="small"
            color="error"
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => apply(undefined)}
          >
            {t("tools.image.remove")}
          </Button>
        </>
      ) : null}
      {error ? (
        <Typography variant="caption" color="error" role="alert" sx={{ px: 1 }}>
          {t("tools.image.loadError")}
        </Typography>
      ) : null}
    </Paper>
  );
}
