/**
 * The studio top bar. Replaces `src/app/DocumentPanel.tsx`: every
 * New/Load-example/Open/Save/Save-as/Undo/Redo behaviour (including the
 * visible restore/open-error alert) is ported here verbatim, plus the
 * Build|Simulate toggle (Simulate disabled), the ES/EN language toggle, the
 * theme toggle, the `?` shortcut-sheet button and the command-palette
 * button.
 */

import { useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useStore, type StoreApi } from "zustand";
import {
  Alert,
  Box,
  Button,
  IconButton,
  Menu,
  MenuItem,
  Stack,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from "@mui/material";
// Imported from the `esm/` subpath, not the package root (`@mui/icons-material/Undo`):
// the root CJS file breaks under this project's Vite 8 + @mui/icons-material 5.18
// combination in a REAL browser -- `React.createElement` receives the whole CJS
// module object instead of its unwrapped `.default`, throwing "Element type is
// invalid ... but got: object" the moment TopBar renders. First caught by 04-06's
// E2E suite (no earlier plan rendered the real app in a real browser); see
// `src/ui/shell/toolIcons.tsx` and `TransportPlaceholder.tsx` for the same fix.
import UndoIcon from "@mui/icons-material/esm/Undo";
import RedoIcon from "@mui/icons-material/esm/Redo";
import LightModeIcon from "@mui/icons-material/esm/LightMode";
import DarkModeIcon from "@mui/icons-material/esm/DarkMode";
import { DofBadge } from "./DofBadge";
import { DocumentLoadError, parseDocumentJson } from "../../model";
import { buildExampleFourBar } from "../../store";
import { saveDocumentToFile, openTextFromFile, sniffDocumentText } from "../../persistence/fileIO";
import type { Session, SessionLoadResult } from "../../persistence/session";
import type { StudioMode, StudioState } from "../../uiState/studioStore";
import type { PreferencesState, ThemeMode } from "../../uiState/preferences";
import type { Language } from "../../i18n/numberFormat";

type Status =
  | { severity: "success" | "info" | "error"; kind: "raw"; text: string }
  | {
      severity: "success" | "info" | "error";
      kind: "i18n";
      key: string;
      values?: Record<string, string>;
    };

function initialStatus(restore: SessionLoadResult): Status | null {
  if (restore.status === "error") {
    return {
      severity: "error",
      kind: "i18n",
      key: "shell.alerts.restoreFailed",
      values: { message: restore.error.message },
    };
  }
  if (restore.status === "restored") {
    return { severity: "info", kind: "i18n", key: "shell.alerts.restored" };
  }
  return null;
}

export interface TopBarProps {
  session: Session;
  preferencesStore: StoreApi<PreferencesState>;
  studioStore: StoreApi<StudioState>;
}

export function TopBar({ session, preferencesStore, studioStore }: TopBarProps): ReactNode {
  const { t } = useTranslation();

  const mode = useStore(studioStore, (s) => s.mode);
  const documentName = useStore(session.store, (s) => s.document.name);
  const canUndo = useStore(session.store, (s) => s.canUndo);
  const canRedo = useStore(session.store, (s) => s.canRedo);
  const undoLabel = useStore(session.store, (s) => s.undoLabel);
  const redoLabel = useStore(session.store, (s) => s.redoLabel);

  const themeMode = useStore(preferencesStore, (s) => s.themeMode);
  const language = useStore(preferencesStore, (s) => s.language);

  const [status, setStatus] = useState<Status | null>(() => initialStatus(session.restore));
  const [fileMenuAnchor, setFileMenuAnchor] = useState<HTMLElement | null>(null);
  const handleRef = useRef<FileSystemFileHandle | null>(null);

  function closeFileMenu(): void {
    setFileMenuAnchor(null);
  }

  function handleNew(): void {
    session.store.getState().newDocument();
    handleRef.current = null;
    setStatus(null);
  }

  function handleLoadExample(): void {
    session.store.getState().newDocument({ name: "Four-bar example" });
    buildExampleFourBar(session.store);
    handleRef.current = null;
    setStatus(null);
  }

  function handleUndo(): void {
    session.store.getState().undo();
  }

  function handleRedo(): void {
    session.store.getState().redo();
  }

  async function handleSave(): Promise<void> {
    const doc = session.store.getState().document;
    const result = await saveDocumentToFile(doc, { handle: handleRef.current });
    if (result.kind === "saved") {
      handleRef.current = result.handle;
      setStatus({
        severity: "success",
        kind: "i18n",
        key: "shell.alerts.saved",
        values: { fileName: result.fileName },
      });
    }
  }

  async function handleSaveAs(): Promise<void> {
    const doc = session.store.getState().document;
    const result = await saveDocumentToFile(doc);
    if (result.kind === "saved") {
      handleRef.current = result.handle;
      setStatus({
        severity: "success",
        kind: "i18n",
        key: "shell.alerts.saved",
        values: { fileName: result.fileName },
      });
    }
  }

  async function handleOpen(): Promise<void> {
    try {
      const result = await openTextFromFile();
      if (result.kind !== "opened") return;
      if (sniffDocumentText(result.text) === "graph") {
        // A graph goes to the import dialog; the open file handle is not
        // kept, so a later Save never overwrites the graph file.
        studioStore.getState().requestImport(result.text, result.fileName);
        setStatus(null);
        return;
      }
      // "simuplandes" and "unknown" take the same path as before: unknown
      // text surfaces parseDocumentJson's DocumentLoadError message.
      const document = parseDocumentJson(result.text);
      session.store.getState().loadDocument(document);
      handleRef.current = result.handle;
      setStatus(null);
    } catch (e) {
      const text = e instanceof DocumentLoadError || e instanceof Error ? e.message : String(e);
      setStatus({ severity: "error", kind: "raw", text });
    }
  }

  const statusText =
    status === null ? null : status.kind === "raw" ? status.text : t(status.key, status.values);

  return (
    <Box component="header" sx={{ gridArea: "top", borderBottom: 1, borderColor: "divider" }}>
      <Stack
        direction="row"
        spacing={1.5}
        alignItems="center"
        flexWrap="wrap"
        sx={{ px: 1.5, py: 1 }}
      >
        <Typography variant="h6" component="h1" sx={{ fontWeight: 800 }}>
          {t("shell.appName")}
        </Typography>

        <Typography variant="body2" color="text.secondary" noWrap sx={{ maxWidth: 220 }}>
          {documentName}
        </Typography>

        <Button
          id="file-menu-button"
          aria-haspopup="true"
          aria-controls={fileMenuAnchor ? "file-menu" : undefined}
          onClick={(event) => setFileMenuAnchor(event.currentTarget)}
        >
          {t("shell.menu.file")}
        </Button>
        <Menu
          id="file-menu"
          anchorEl={fileMenuAnchor}
          open={fileMenuAnchor !== null}
          onClose={closeFileMenu}
        >
          <MenuItem
            onClick={() => {
              closeFileMenu();
              handleNew();
            }}
          >
            {t("shell.menu.new")}
          </MenuItem>
          <MenuItem
            onClick={() => {
              closeFileMenu();
              handleLoadExample();
            }}
          >
            {t("shell.menu.loadExample")}
          </MenuItem>
          <MenuItem
            onClick={() => {
              closeFileMenu();
              studioStore.getState().openDialog("import");
            }}
          >
            {t("shell.menu.importGraph")}
          </MenuItem>
          <MenuItem
            onClick={() => {
              closeFileMenu();
              studioStore.getState().openDialog("examples");
            }}
          >
            {t("shell.menu.examples")}
          </MenuItem>
          <MenuItem
            onClick={() => {
              closeFileMenu();
              studioStore.getState().openDialog("atlas");
            }}
          >
            {t("shell.menu.atlas")}
          </MenuItem>
          <MenuItem
            onClick={() => {
              closeFileMenu();
              void handleOpen();
            }}
          >
            {t("shell.menu.open")}
          </MenuItem>
          <MenuItem
            onClick={() => {
              closeFileMenu();
              void handleSave();
            }}
          >
            {t("shell.menu.save")}
          </MenuItem>
          <MenuItem
            onClick={() => {
              closeFileMenu();
              void handleSaveAs();
            }}
          >
            {t("shell.menu.saveAs")}
          </MenuItem>
        </Menu>

        <IconButton
          size="small"
          onClick={handleUndo}
          disabled={!canUndo}
          title={undoLabel ?? ""}
          aria-label={t("shell.undo", { label: undoLabel ?? "" })}
        >
          <UndoIcon fontSize="small" />
        </IconButton>
        <IconButton
          size="small"
          onClick={handleRedo}
          disabled={!canRedo}
          title={redoLabel ?? ""}
          aria-label={t("shell.redo", { label: redoLabel ?? "" })}
        >
          <RedoIcon fontSize="small" />
        </IconButton>

        <ToggleButtonGroup
          exclusive
          value={mode}
          size="small"
          aria-label={t("shell.mode.build")}
          onChange={(_event, value: StudioMode | null) => {
            // `setMode`'s own guard (`selectCanToggleMode`) already refuses
            // "simulate" while a tool is mid-gesture or a modal is open;
            // "build" is always allowed.
            if (value !== null) studioStore.getState().setMode(value);
          }}
        >
          <ToggleButton value="build" aria-label={t("shell.mode.build")}>
            {t("shell.mode.build")}
          </ToggleButton>
          <ToggleButton value="simulate" aria-label={t("shell.mode.simulate")}>
            {t("shell.mode.simulate")}
          </ToggleButton>
        </ToggleButtonGroup>

        <DofBadge mechanismStore={session.store} />

        <Box sx={{ flex: 1 }} />

        <Button
          size="small"
          variant="outlined"
          onClick={() => studioStore.getState().openPalette()}
          aria-label={t("shell.buttons.commandPalette")}
        >
          {"⌘K / Ctrl+K"}
        </Button>

        <IconButton
          size="small"
          onClick={() => studioStore.getState().openShortcutSheet()}
          aria-label={t("shell.buttons.shortcuts")}
        >
          <Typography component="span" sx={{ fontWeight: 700 }}>
            ?
          </Typography>
        </IconButton>

        <ToggleButtonGroup
          exclusive
          size="small"
          value={language}
          aria-label={t("shell.language")}
          onChange={(_event, value: Language | null) => {
            if (value !== null) preferencesStore.getState().setLanguage(value);
          }}
        >
          <ToggleButton value="es">ES</ToggleButton>
          <ToggleButton value="en">EN</ToggleButton>
        </ToggleButtonGroup>

        <IconButton
          size="small"
          onClick={() => preferencesStore.getState().toggleThemeMode()}
          aria-label={t(themeModeToggleLabelKey(themeMode))}
        >
          {themeMode === "light" ? (
            <DarkModeIcon fontSize="small" />
          ) : (
            <LightModeIcon fontSize="small" />
          )}
        </IconButton>
      </Stack>

      {status !== null ? (
        <Alert role="alert" severity={status.severity} sx={{ mx: 1.5, mb: 1 }}>
          {statusText}
        </Alert>
      ) : null}
    </Box>
  );
}

function themeModeToggleLabelKey(current: ThemeMode): string {
  return current === "light" ? "shell.theme.dark" : "shell.theme.light";
}
