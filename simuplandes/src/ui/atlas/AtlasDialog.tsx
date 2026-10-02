/**
 * The atlas browser (XCH-08): thumbnails of every bundled topology, filtered
 * by link count and class. One click lays the topology out (the same
 * `planImport` pipeline as the import dialog, layout mode, variant 0) and
 * commits it into Simulate. A `low-mobility` plan is opened anyway: the
 * atlas trusts the layout gate's best candidate.
 */

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useStore, type StoreApi } from "zustand";
import { useTranslation } from "react-i18next";
import {
  Alert,
  Box,
  Button,
  Card,
  CardActionArea,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  InputLabel,
  MenuItem,
  Select,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from "@mui/material";
import { planImport } from "../../interchange";
import type { ImportDeps } from "../../interchange/importReport";
import { studioImportDeps } from "../../sim/importDeps";
import type { MechanismStore } from "../../store";
import type { StudioState } from "../../uiState/studioStore";
import { commitImportedDocument } from "../import/commitDocument";
import { ReplaceConfirm } from "../gallery/ReplaceConfirm";
import {
  atlasEntries,
  atlasEntryToGraphText,
  atlasFilterOptions,
  filterAtlasEntries,
  type AtlasEntry,
} from "./atlasEntries";
import { AtlasThumbnail } from "./AtlasThumbnail";

export interface AtlasDialogProps {
  studioStore: StoreApi<StudioState>;
  mechanismStore: MechanismStore;
  /** Injection seam for tests; defaults to the real layout + verifier. */
  deps?: ImportDeps;
}

export function AtlasDialog(props: AtlasDialogProps): ReactNode {
  const open = useStore(props.studioStore, (s) => s.dialog === "atlas");
  if (!open) return null;
  return <AtlasDialogBody {...props} />;
}

function AtlasDialogBody({
  studioStore,
  mechanismStore,
  deps = studioImportDeps,
}: AtlasDialogProps): ReactNode {
  const { t } = useTranslation();
  const entries = useMemo(() => atlasEntries(), []);
  const options = useMemo(() => atlasFilterOptions(entries), [entries]);
  const [size, setSize] = useState<"all" | number>("all");
  const [cls, setCls] = useState("all");
  const [pending, setPending] = useState<AtlasEntry | null>(null);
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const controllerRef = useRef<AbortController | null>(null);

  useEffect(
    () => () => {
      controllerRef.current?.abort();
    },
    [],
  );

  const shown = useMemo(() => filterAtlasEntries(entries, { size, cls }), [entries, size, cls]);

  function classLabel(value: string): string {
    if (value === "watt") return t("graph.topology.watt");
    if (value === "stephenson") return t("graph.topology.stephenson");
    return value;
  }

  function entryName(entry: AtlasEntry): string {
    if (entry.id === "four-bar") return t("graph.topology.fourBar");
    if (entry.name === "watt") return t("graph.topology.watt");
    if (entry.name === "stephenson") return t("graph.topology.stephenson");
    return "";
  }

  async function open(entry: AtlasEntry): Promise<void> {
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    setError(null);
    setLoadingId(entry.id);
    const plan = await planImport(atlasEntryToGraphText(entry), {}, deps, {
      signal: controller.signal,
    });
    if (controller.signal.aborted) return;
    setLoadingId(null);
    if (plan.doc === null) {
      const item = plan.items.find((i) => i.severity === "error") ?? plan.items[0];
      const message = item
        ? t(`import.report.${item.code}`, {
            ...(item.params as Record<string, string | number>),
            defaultValue: item.code,
          })
        : t("import.report.unknown-format");
      setError(message);
      return;
    }
    commitImportedDocument(plan.doc, {
      mechanismStore,
      studioStore,
      simulate: plan.verdict?.status === "ready",
    });
  }

  function handleSelect(entry: AtlasEntry): void {
    const { document, canUndo } = mechanismStore.getState();
    if (document.links.length > 0 && canUndo) {
      setPending(entry);
      return;
    }
    void open(entry);
  }

  function handleClose(): void {
    controllerRef.current?.abort();
    studioStore.getState().closeDialog();
  }

  function handleCancel(): void {
    controllerRef.current?.abort();
    setLoadingId(null);
  }

  const busy = loadingId !== null;

  return (
    <>
      <Dialog
        open
        maxWidth="md"
        fullWidth
        onClose={handleClose}
        data-testid="atlas-dialog"
        aria-labelledby="atlas-dialog-title"
      >
        <DialogTitle id="atlas-dialog-title">{t("atlas.title")}</DialogTitle>
        <DialogContent dividers>
          <Box sx={{ display: "flex", gap: 2, flexWrap: "wrap", alignItems: "center", mb: 2 }}>
            <ToggleButtonGroup
              size="small"
              exclusive
              value={size}
              aria-label={t("atlas.sizeLabel")}
              onChange={(_, value: "all" | number | null) => {
                if (value !== null) setSize(value);
              }}
            >
              <ToggleButton value="all" data-testid="atlas-size-all">
                {t("atlas.all")}
              </ToggleButton>
              {options.sizes.map((n) => (
                <ToggleButton key={n} value={n} data-testid={`atlas-size-${n}`}>
                  {n}
                </ToggleButton>
              ))}
            </ToggleButtonGroup>
            <FormControl size="small" sx={{ minWidth: 150 }}>
              <InputLabel id="atlas-class-label">{t("atlas.classLabel")}</InputLabel>
              <Select
                labelId="atlas-class-label"
                label={t("atlas.classLabel")}
                value={cls}
                onChange={(e) => setCls(e.target.value)}
                data-testid="atlas-class"
              >
                <MenuItem value="all">{t("atlas.all")}</MenuItem>
                {options.classes.map((c) => (
                  <MenuItem key={c} value={c} data-testid={`atlas-class-${c}`}>
                    {classLabel(c)}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
            <Typography variant="body2" color="text.secondary" data-testid="atlas-count">
              {t("atlas.count", { count: shown.length })}
            </Typography>
          </Box>

          {error !== null ? (
            <Alert severity="error" sx={{ mb: 2 }} data-testid="atlas-error">
              {t("atlas.error", { message: error })}
            </Alert>
          ) : null}
          {busy ? (
            <Box
              sx={{ display: "flex", alignItems: "center", gap: 1, mb: 2 }}
              data-testid="atlas-progress"
            >
              <CircularProgress size={20} />
              <Typography variant="body2">{t("atlas.opening")}</Typography>
              <Button size="small" data-testid="atlas-cancel-layout" onClick={handleCancel}>
                {t("atlas.cancel")}
              </Button>
            </Box>
          ) : null}

          {shown.length === 0 ? (
            <Typography color="text.secondary">{t("atlas.none")}</Typography>
          ) : (
            <Box
              data-testid="atlas-grid"
              sx={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill, minmax(130px, 1fr))",
                gap: 1.5,
              }}
            >
              {shown.map((entry) => (
                <Card key={entry.id} variant="outlined">
                  <CardActionArea
                    data-testid="atlas-card"
                    data-atlas-id={entry.id}
                    disabled={busy}
                    aria-label={t("atlas.open", { id: entry.id })}
                    onClick={() => handleSelect(entry)}
                    sx={{ display: "block", textAlign: "center", p: 1 }}
                  >
                    <Box sx={{ lineHeight: 0, position: "relative" }}>
                      <AtlasThumbnail entry={entry} />
                      {loadingId === entry.id ? (
                        <CircularProgress
                          size={28}
                          sx={{
                            position: "absolute",
                            top: "calc(50% - 14px)",
                            left: "calc(50% - 14px)",
                          }}
                        />
                      ) : null}
                    </Box>
                    <Typography variant="subtitle2" component="div" noWrap>
                      {entry.id}
                    </Typography>
                    <Typography variant="caption" color="text.secondary" component="div" noWrap>
                      {[entryName(entry), entry.assortmentLabel]
                        .filter((s) => s !== "")
                        .join(" · ")}
                    </Typography>
                  </CardActionArea>
                </Card>
              ))}
            </Box>
          )}
        </DialogContent>
        <DialogActions>
          <Button data-testid="atlas-close" onClick={handleClose}>
            {t("atlas.close")}
          </Button>
        </DialogActions>
      </Dialog>
      <ReplaceConfirm
        open={pending !== null}
        onCancel={() => setPending(null)}
        onConfirm={() => {
          const entry = pending;
          setPending(null);
          if (entry !== null) void open(entry);
        }}
      />
    </>
  );
}
