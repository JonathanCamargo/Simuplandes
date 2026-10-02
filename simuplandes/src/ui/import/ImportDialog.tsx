/**
 * `ImportDialog` (XCH-05, XCH-07): paste / open / drop a graph, see the
 * localized mapping report with one fix per warning, preview the Drawing and
 * the Graph of the PLANNED document, then import. Planning is re-run (and the
 * previous run aborted) on every text or option change; a fix is just a
 * partial `ImportOptions` merged into the options.
 *
 * The dialog body is keyed on `importRequest.nonce`, so a new request resets
 * text and options. Committing goes through `commitImportedDocument` (09-03),
 * which replaces the document, closes the dialog and, when the measured
 * verdict is ready, enters Simulate.
 */

import { useEffect, useRef, useState, type ReactNode } from "react";
import { useStore, type StoreApi } from "zustand";
import { useTranslation } from "react-i18next";
import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  LinearProgress,
  Stack,
  TextField,
  useTheme,
} from "@mui/material";
import { planImport, type ImportPlan } from "../../interchange";
import {
  DEFAULT_IMPORT_OPTIONS,
  type ImportDeps,
  type ImportOptions,
} from "../../interchange/importReport";
import { studioImportDeps } from "../../sim/importDeps";
import type { MechanismStore } from "../../store";
import type { StudioState } from "../../uiState/studioStore";
import { openTextFromFile } from "../../persistence/fileIO";
import { commitImportedDocument } from "./commitDocument";
import { ImportReportList } from "./ImportReportList";
import { ImportPreview } from "./ImportPreview";

export interface ImportDialogProps {
  studioStore: StoreApi<StudioState>;
  mechanismStore: MechanismStore;
  /** Injection seam for tests; defaults to the real layout + verifier. */
  deps?: ImportDeps;
}

interface PlanResult {
  text: string;
  options: ImportOptions;
  plan: ImportPlan;
}

interface Progress {
  options: ImportOptions;
  tries: number;
  max: number;
}

export function ImportDialog(props: ImportDialogProps): ReactNode {
  const open = useStore(props.studioStore, (s) => s.dialog === "import");
  const nonce = useStore(props.studioStore, (s) => s.importRequest?.nonce ?? 0);
  if (!open) return null;
  return <ImportDialogBody key={nonce} {...props} />;
}

function ImportDialogBody({
  studioStore,
  mechanismStore,
  deps = studioImportDeps,
}: ImportDialogProps): ReactNode {
  const { t } = useTranslation();
  const theme = useTheme();
  const request = studioStore.getState().importRequest;
  const [showPaste] = useState(request === null);
  const [text, setText] = useState(request?.text ?? "");
  const [options, setOptions] = useState<ImportOptions>(DEFAULT_IMPORT_OPTIONS);
  const [result, setResult] = useState<PlanResult | null>(null);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [fileError, setFileError] = useState(false);
  const controllerRef = useRef<AbortController | null>(null);

  const document = useStore(mechanismStore, (s) => s.document);
  const canUndo = useStore(mechanismStore, (s) => s.canUndo);

  useEffect(() => {
    if (text === "") return;
    const controller = new AbortController();
    controllerRef.current = controller;
    let stale = false;
    void planImport(text, options, deps, {
      signal: controller.signal,
      onProgress: (tries, max) => {
        if (!stale) setProgress({ options, tries, max });
      },
    }).then((plan) => {
      if (!stale) setResult({ text, options, plan });
    });
    return () => {
      stale = true;
      controller.abort();
    };
  }, [text, options, deps]);

  const running = text !== "" && (result?.text !== text || result.options !== options);
  // The previous plan stays visible (Import disabled) while a re-plan runs.
  const plan = text !== "" ? (result?.plan ?? null) : null;
  const progressNow = running && progress?.options === options ? progress : null;
  const replaces = document.links.length > 0 && canUndo;

  function applyFix(option: Partial<ImportOptions>): void {
    setOptions((prev) => ({ ...prev, ...option }));
  }

  async function handleOpenFile(): Promise<void> {
    setFileError(false);
    try {
      const opened = await openTextFromFile();
      if (opened.kind === "opened") {
        setText(opened.text);
        setOptions(DEFAULT_IMPORT_OPTIONS);
      }
    } catch {
      setFileError(true);
    }
  }

  function handleCancel(): void {
    const studio = studioStore.getState();
    studio.clearImportRequest();
    studio.closeDialog();
  }

  function handleCommit(): void {
    if (running || plan === null || plan.doc === null || plan.fatal) return;
    commitImportedDocument(plan.doc, {
      mechanismStore,
      studioStore,
      simulate: plan.verdict?.status === "ready",
    });
  }

  const canCommit = !running && plan !== null && !plan.fatal && plan.doc !== null;

  return (
    <Dialog open maxWidth="lg" fullWidth onClose={handleCancel} data-testid="import-dialog">
      <DialogTitle>{t("import.title")}</DialogTitle>
      <DialogContent dividers>
        {showPaste ? (
          <Stack spacing={1} sx={{ mb: 2 }}>
            <TextField
              multiline
              minRows={3}
              maxRows={8}
              fullWidth
              size="small"
              label={t("import.paste")}
              value={text}
              onChange={(e) => {
                setText(e.target.value);
                setOptions(DEFAULT_IMPORT_OPTIONS);
              }}
              inputProps={{ "data-testid": "import-paste" }}
            />
            <Box>
              <Button
                size="small"
                variant="outlined"
                data-testid="import-open-file"
                onClick={() => void handleOpenFile()}
              >
                {t("import.openFile")}
              </Button>
            </Box>
            {fileError ? <Alert severity="error">{t("import.report.unparseable")}</Alert> : null}
          </Stack>
        ) : null}

        {running ? (
          <Stack spacing={1} sx={{ mb: 2 }} data-testid="import-progress">
            <LinearProgress
              variant={progressNow ? "determinate" : "indeterminate"}
              value={progressNow ? (100 * progressNow.tries) / Math.max(1, progressNow.max) : 0}
            />
            {progressNow ? (
              <Box sx={{ typography: "body2" }}>
                {t("import.progress", { tries: progressNow.tries, max: progressNow.max })}
              </Box>
            ) : null}
            <Box>
              <Button
                size="small"
                variant="outlined"
                data-testid="import-cancel-layout"
                onClick={() => controllerRef.current?.abort()}
              >
                {t("import.cancelLayout")}
              </Button>
            </Box>
          </Stack>
        ) : null}

        {plan !== null ? (
          <Box
            sx={{
              display: "flex",
              flexDirection: { xs: "column", md: "row" },
              gap: 2,
              alignItems: "flex-start",
            }}
          >
            <Box sx={{ flex: "1 1 320px", minWidth: 0 }}>
              <ImportReportList items={plan.items} onFix={applyFix} />
              {plan.mode === "layout" ? (
                <Button
                  size="small"
                  variant="outlined"
                  data-testid="import-relayout"
                  onClick={() =>
                    applyFix({ layoutVariant: options.layoutVariant + 1, positions: "layout" })
                  }
                >
                  {t("import.relayout")}
                </Button>
              ) : null}
            </Box>
            {plan.doc !== null ? (
              <Box sx={{ flex: "1 1 440px", minWidth: 0 }}>
                <ImportPreview
                  doc={plan.doc}
                  verdict={plan.verdict}
                  themeMode={theme.palette.mode === "dark" ? "dark" : "light"}
                />
              </Box>
            ) : null}
          </Box>
        ) : null}

        {replaces ? (
          <Alert severity="warning" data-testid="import-replace-notice" sx={{ mt: 2 }}>
            {t("import.replaceNotice")}
          </Alert>
        ) : null}
      </DialogContent>
      <DialogActions>
        <Button data-testid="import-cancel" onClick={handleCancel}>
          {t("import.cancel")}
        </Button>
        <Button
          variant="contained"
          data-testid="import-commit"
          disabled={!canCommit}
          onClick={handleCommit}
        >
          {replaces ? t("import.replace") : t("import.commit")}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
