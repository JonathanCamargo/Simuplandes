/**
 * The studio top bar. Replaces `src/app/DocumentPanel.tsx`: every
 * New/Load-example/Open/Save/Save-as/Undo/Redo behaviour (including the
 * visible restore/open-error alert) is ported here verbatim, plus the
 * Build|Simulate toggle, the ES/EN language toggle, the theme toggle, the
 * `?` shortcut-sheet button and the command-palette button.
 *
 * The bar stays on one line from laptop widths down to an embedded studio:
 * the document name, the "Studio" suffix and the mode labels drop out at
 * narrower breakpoints, while every control keeps its accessible name.
 * Status messages show as a toast so they never push the canvas down.
 *
 * In the compact layout the File button becomes a menu icon whose menu also
 * holds the palette, shortcuts, language, theme, grid/snap and layout
 * controls, and a panel button opens the dock sheet. What stays on the bar
 * (undo/redo, the mode switch, the DOF badge) is finger-sized.
 */

import { useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useStore, type StoreApi } from "zustand";
import { useHotkeys } from "react-hotkeys-hook";
import {
  Alert,
  Box,
  Button,
  Divider,
  IconButton,
  ListItemIcon,
  ListItemText,
  Menu,
  MenuItem,
  Snackbar,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
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
import SearchIcon from "@mui/icons-material/esm/Search";
import KeyboardIcon from "@mui/icons-material/esm/Keyboard";
import ConstructionIcon from "@mui/icons-material/esm/Construction";
import PlayArrowIcon from "@mui/icons-material/esm/PlayArrow";
import DrawIcon from "@mui/icons-material/esm/Draw";
import KeyboardArrowDownIcon from "@mui/icons-material/esm/KeyboardArrowDown";
import NoteAddIcon from "@mui/icons-material/esm/NoteAdd";
import FolderOpenIcon from "@mui/icons-material/esm/FolderOpen";
import SaveIcon from "@mui/icons-material/esm/Save";
import SaveAsIcon from "@mui/icons-material/esm/SaveAs";
import CollectionsIcon from "@mui/icons-material/esm/Collections";
import MenuBookIcon from "@mui/icons-material/esm/MenuBook";
import AccountTreeIcon from "@mui/icons-material/esm/AccountTree";
import LinkIcon from "@mui/icons-material/esm/Link";
import ImageIcon from "@mui/icons-material/esm/Image";
import MenuIcon from "@mui/icons-material/esm/Menu";
import ViewSidebarIcon from "@mui/icons-material/esm/ViewSidebar";
import TranslateIcon from "@mui/icons-material/esm/Translate";
import GridOnIcon from "@mui/icons-material/esm/GridOn";
import AdsClickIcon from "@mui/icons-material/esm/AdsClick";
import DevicesIcon from "@mui/icons-material/esm/Devices";
import CheckIcon from "@mui/icons-material/esm/Check";
import { DofBadge } from "./DofBadge";
import { DEFAULT_DOCUMENT_NAME, DocumentLoadError, parseDocumentJson } from "../../model";
import { buildExampleFourBar } from "../../store";
import { saveDocumentToFile, openTextFromFile, sniffDocumentText } from "../../persistence/fileIO";
import { buildShareUrl } from "../../persistence/shareLink";
import type { Session, SessionLoadResult } from "../../persistence/session";
import type { StudioMode, StudioState } from "../../uiState/studioStore";
import {
  LAYOUT_MODES,
  type LayoutMode,
  type PreferencesState,
  type ThemeMode,
} from "../../uiState/preferences";
import type { Language } from "../../i18n/numberFormat";

type Severity = "success" | "info" | "error";

type Status =
  | { severity: Severity; kind: "raw"; text: string }
  | { severity: Severity; kind: "i18n"; key: string; values?: Record<string, string> };

/** Hidden on screen, still read by screen readers. */
const visuallyHidden = {
  position: "absolute",
  width: "1px",
  height: "1px",
  overflow: "hidden",
  clip: "rect(0 0 0 0)",
  whiteSpace: "nowrap",
} as const;

/** Success/info toasts hide on their own; errors stay until dismissed. */
const TOAST_HIDE_MS = 4000;

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

/** "Ctrl" or "⌘", for the shortcut hints shown next to menu items. */
function modKeyLabel(): string {
  return typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform)
    ? "⌘"
    : "Ctrl+";
}

export interface TopBarProps {
  session: Session;
  preferencesStore: StoreApi<PreferencesState>;
  studioStore: StoreApi<StudioState>;
  /** The compact (phone) layout: see this file's TSDoc. */
  compact?: boolean;
}

export function TopBar({
  session,
  preferencesStore,
  studioStore,
  compact = false,
}: TopBarProps): ReactNode {
  const { t } = useTranslation();

  const mode = useStore(studioStore, (s) => s.mode);
  const storedName = useStore(session.store, (s) => s.document.name);
  const documentName =
    storedName === DEFAULT_DOCUMENT_NAME ? t("inspector.document.untitled") : storedName;
  const canUndo = useStore(session.store, (s) => s.canUndo);
  const canRedo = useStore(session.store, (s) => s.canRedo);
  const undoLabel = useStore(session.store, (s) => s.undoLabel);
  const redoLabel = useStore(session.store, (s) => s.redoLabel);

  const themeMode = useStore(preferencesStore, (s) => s.themeMode);
  const language = useStore(preferencesStore, (s) => s.language);
  const layoutMode = useStore(preferencesStore, (s) => s.layoutMode);
  const gridVisible = useStore(preferencesStore, (s) => s.gridVisible);
  const snapEnabled = useStore(preferencesStore, (s) => s.snapEnabled);
  const dockSheetOpen = useStore(studioStore, (s) => s.dockSheetOpen);

  const [status, setStatus] = useState<Status | null>(() => initialStatus(session.restore));
  const [fileMenuAnchor, setFileMenuAnchor] = useState<HTMLElement | null>(null);
  const [layoutMenuAnchor, setLayoutMenuAnchor] = useState<HTMLElement | null>(null);
  const handleRef = useRef<FileSystemFileHandle | null>(null);
  const mod = modKeyLabel();

  function closeFileMenu(): void {
    setFileMenuAnchor(null);
  }

  function handleLayoutMode(next: LayoutMode): void {
    setFileMenuAnchor(null);
    setLayoutMenuAnchor(null);
    preferencesStore.getState().setLayoutMode(next);
  }

  // Touch targets in the compact layout: ~43px buttons (the theme's UI_SCALE
  // enlarges both the small icon and the padding).
  const iconSize = compact ? "medium" : "small";
  const compactIconSx = compact ? { p: 1 } : undefined;

  function handleNew(): void {
    session.store.getState().newDocument();
    handleRef.current = null;
    setStatus(null);
  }

  function handleLoadExample(): void {
    session.store.getState().newDocument({ name: t("shell.exampleFourBarName") });
    buildExampleFourBar(session.store);
    // Built with undoable steps, so the canvas does not see a freshly opened
    // document and keeps the default view. That view shows the example on a
    // desktop canvas but cuts it off on a phone: frame it there.
    if (compact) studioStore.getState().requestFit();
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

  async function handleCopyShareLink(): Promise<void> {
    try {
      const url = await buildShareUrl(session.store.getState().document, window.location);
      await navigator.clipboard.writeText(url);
      setStatus({ severity: "success", kind: "i18n", key: "shell.alerts.linkCopied" });
    } catch {
      setStatus({ severity: "error", kind: "i18n", key: "shell.alerts.linkFailed" });
    }
  }

  function handleExportImage(): void {
    studioStore.getState().setRightDockTab("export");
  }

  // File shortcuts. Enabled in form fields too, so Ctrl+S saves while the
  // document name is being edited, and the browser's own Save/Open never fires.
  const fileHotkeyOptions = { enableOnFormTags: true, preventDefault: true } as const;
  useHotkeys("mod+s", () => void handleSave(), fileHotkeyOptions);
  useHotkeys("mod+shift+s", () => void handleSaveAs(), fileHotkeyOptions);
  useHotkeys("mod+o", () => void handleOpen(), fileHotkeyOptions);

  const statusText =
    status === null ? null : status.kind === "raw" ? status.text : t(status.key, status.values);

  return (
    <Box component="header" sx={{ gridArea: "top", borderBottom: 1, borderColor: "divider" }}>
      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          gap: compact ? 0.25 : { xs: 0.5, md: 1 },
          px: compact ? 1 : 1.5,
          py: compact ? 0.5 : 0.75,
          minWidth: 0,
          flexWrap: "nowrap",
        }}
      >
        <Typography
          variant="h6"
          component="h1"
          noWrap
          aria-label={t("shell.appName")}
          sx={{
            fontWeight: 800,
            flexShrink: 0,
            mr: 0.5,
            fontSize: { xs: "1.05rem", md: "1.2rem" },
            // A phone needs the room for the controls; the heading stays for screen readers.
            ...(compact ? visuallyHidden : {}),
          }}
        >
          {t("shell.appNameShort")}
          <Box component="span" sx={{ display: { xs: "none", lg: "inline" } }}>
            {" "}
            {t("shell.appNameSuffix")}
          </Box>
        </Typography>

        <Typography
          variant="body2"
          color="text.secondary"
          noWrap
          title={documentName}
          sx={{
            display: compact ? "none" : { xs: "none", md: "block" },
            maxWidth: 220,
            minWidth: 0,
            flexShrink: 1,
          }}
        >
          {documentName}
        </Typography>

        {compact ? (
          <IconButton
            id="file-menu-button"
            aria-haspopup="true"
            aria-controls={fileMenuAnchor ? "file-menu" : undefined}
            aria-label={t("shell.menu.main")}
            onClick={(event) => setFileMenuAnchor(event.currentTarget)}
            sx={{ flexShrink: 0, ml: -0.5, p: 1 }}
          >
            <MenuIcon fontSize="small" />
          </IconButton>
        ) : (
          <Button
            id="file-menu-button"
            size="small"
            aria-haspopup="true"
            aria-controls={fileMenuAnchor ? "file-menu" : undefined}
            onClick={(event) => setFileMenuAnchor(event.currentTarget)}
            endIcon={<KeyboardArrowDownIcon aria-hidden="true" />}
            sx={{ flexShrink: 0 }}
          >
            {t("shell.menu.file")}
          </Button>
        )}
        <Menu
          id="file-menu"
          anchorEl={fileMenuAnchor}
          open={fileMenuAnchor !== null}
          onClose={closeFileMenu}
          slotProps={{
            paper: { sx: { minWidth: compact ? 260 : 280, maxWidth: "calc(100vw - 32px)" } },
          }}
        >
          <FileMenuItem
            icon={<NoteAddIcon fontSize="small" />}
            label={t("shell.menu.new")}
            onSelect={() => {
              closeFileMenu();
              handleNew();
            }}
          />
          <FileMenuItem
            icon={<FolderOpenIcon fontSize="small" />}
            label={t("shell.menu.open")}
            shortcut={`${mod}O`}
            onSelect={() => {
              closeFileMenu();
              void handleOpen();
            }}
          />
          <FileMenuItem
            icon={<SaveIcon fontSize="small" />}
            label={t("shell.menu.save")}
            shortcut={`${mod}S`}
            onSelect={() => {
              closeFileMenu();
              void handleSave();
            }}
          />
          <FileMenuItem
            icon={<SaveAsIcon fontSize="small" />}
            label={t("shell.menu.saveAs")}
            shortcut={`${mod}${mod === "⌘" ? "⇧" : "Shift+"}S`}
            onSelect={() => {
              closeFileMenu();
              void handleSaveAs();
            }}
          />
          <Divider />
          <FileMenuItem
            icon={<CollectionsIcon fontSize="small" />}
            label={t("shell.menu.examples")}
            onSelect={() => {
              closeFileMenu();
              studioStore.getState().openDialog("examples");
            }}
          />
          <FileMenuItem
            icon={<CollectionsIcon fontSize="small" />}
            label={t("shell.menu.loadExample")}
            onSelect={() => {
              closeFileMenu();
              handleLoadExample();
            }}
          />
          <FileMenuItem
            icon={<MenuBookIcon fontSize="small" />}
            label={t("shell.menu.atlas")}
            onSelect={() => {
              closeFileMenu();
              studioStore.getState().openDialog("atlas");
            }}
          />
          <FileMenuItem
            icon={<AccountTreeIcon fontSize="small" />}
            label={t("shell.menu.importGraph")}
            onSelect={() => {
              closeFileMenu();
              studioStore.getState().openDialog("import");
            }}
          />
          <Divider />
          <FileMenuItem
            icon={<LinkIcon fontSize="small" />}
            label={t("shell.menu.share")}
            onSelect={() => {
              closeFileMenu();
              void handleCopyShareLink();
            }}
          />
          <FileMenuItem
            icon={<ImageIcon fontSize="small" />}
            label={t("shell.menu.exportImage")}
            onSelect={() => {
              closeFileMenu();
              handleExportImage();
            }}
          />
          {compact
            ? [
                <Divider key="view-divider" />,
                <FileMenuItem
                  key="palette"
                  icon={<SearchIcon fontSize="small" />}
                  label={t("shell.buttons.commandPalette")}
                  onSelect={() => {
                    closeFileMenu();
                    studioStore.getState().openPalette();
                  }}
                />,
                <FileMenuItem
                  key="shortcuts"
                  icon={<KeyboardIcon fontSize="small" />}
                  label={t("shell.buttons.shortcuts")}
                  onSelect={() => {
                    closeFileMenu();
                    studioStore.getState().openShortcutSheet();
                  }}
                />,
                <FileMenuItem
                  key="language"
                  icon={<TranslateIcon fontSize="small" />}
                  label={t("shell.menu.otherLanguage")}
                  onSelect={() => {
                    closeFileMenu();
                    preferencesStore.getState().setLanguage(language === "es" ? "en" : "es");
                  }}
                />,
                <FileMenuItem
                  key="theme"
                  icon={
                    themeMode === "light" ? (
                      <DarkModeIcon fontSize="small" />
                    ) : (
                      <LightModeIcon fontSize="small" />
                    )
                  }
                  label={t(themeModeToggleLabelKey(themeMode))}
                  onSelect={() => {
                    closeFileMenu();
                    preferencesStore.getState().toggleThemeMode();
                  }}
                />,
                <FileMenuItem
                  key="grid"
                  icon={<GridOnIcon fontSize="small" />}
                  label={t("shell.status.grid")}
                  checked={gridVisible}
                  onSelect={() => preferencesStore.getState().setGridVisible(!gridVisible)}
                />,
                <FileMenuItem
                  key="snap"
                  icon={<AdsClickIcon fontSize="small" />}
                  label={t("shell.status.snapToggle")}
                  checked={snapEnabled}
                  onSelect={() => preferencesStore.getState().setSnapEnabled(!snapEnabled)}
                />,
                <Divider key="layout-divider" />,
                ...layoutMenuItems(layoutMode, handleLayoutMode, t),
              ]
            : null}
        </Menu>

        <IconButton
          size={iconSize}
          onClick={handleUndo}
          disabled={!canUndo}
          title={undoLabel ?? ""}
          sx={compactIconSx}
          aria-label={t("shell.undo", { label: undoLabel ?? "" })}
        >
          <UndoIcon fontSize="small" />
        </IconButton>
        <IconButton
          size={iconSize}
          onClick={handleRedo}
          disabled={!canRedo}
          title={redoLabel ?? ""}
          sx={compactIconSx}
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
            // "simulate"/"draw" while a tool is mid-gesture or a modal is
            // open; "build" is always allowed.
            if (value !== null) studioStore.getState().setMode(value);
          }}
          sx={{
            flexShrink: 0,
            ml: 0.5,
            "& .MuiToggleButton-root": compact
              ? { gap: 0.75, px: 1, py: 0.75 }
              : { gap: 0.75, px: 1.25, py: 0.5 },
          }}
        >
          <ToggleButton value="build" aria-label={t("shell.mode.build")}>
            <ConstructionIcon fontSize="small" aria-hidden="true" />
            <Box component="span" sx={{ display: { xs: "none", md: "inline" } }}>
              {t("shell.mode.build")}
            </Box>
          </ToggleButton>
          <ToggleButton value="draw" aria-label={t("shell.mode.draw")}>
            <DrawIcon fontSize="small" aria-hidden="true" />
            <Box component="span" sx={{ display: { xs: "none", md: "inline" } }}>
              {t("shell.mode.draw")}
            </Box>
          </ToggleButton>
          <ToggleButton value="simulate" aria-label={t("shell.mode.simulate")}>
            <PlayArrowIcon fontSize="small" aria-hidden="true" />
            <Box component="span" sx={{ display: { xs: "none", md: "inline" } }}>
              {t("shell.mode.simulate")}
            </Box>
          </ToggleButton>
        </ToggleButtonGroup>

        {/* The compact bar has no room for "F = 1": the badge is its colored
            severity icon, and the count stays in its name and its popover. */}
        <Box
          sx={{
            flexShrink: 0,
            display: "flex",
            ...(compact
              ? {
                  "& .MuiChip-root .MuiChip-label": { display: "none" },
                  // Doubled class: outranks the Chip's own (negative) icon margins.
                  "& .MuiChip-root .MuiChip-icon.MuiChip-icon": { mx: "6px" },
                }
              : {}),
          }}
        >
          <DofBadge mechanismStore={session.store} />
        </Box>

        <Box sx={{ flex: 1, minWidth: compact ? 0 : 8 }} />

        {compact ? (
          <Tooltip title={t("shell.dock.toggle")}>
            <IconButton
              onClick={() => studioStore.getState().setDockSheetOpen(!dockSheetOpen)}
              aria-label={t("shell.dock.toggle")}
              aria-pressed={dockSheetOpen}
              color={dockSheetOpen ? "primary" : "default"}
              sx={{ flexShrink: 0, mr: -0.5, p: 1 }}
            >
              <ViewSidebarIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        ) : null}

        {compact ? null : (
          <>
            <Tooltip title={`${t("shell.buttons.commandPalette")} (${mod}K)`}>
              <IconButton
                size="small"
                onClick={() => studioStore.getState().openPalette()}
                aria-label={t("shell.buttons.commandPalette")}
              >
                <SearchIcon fontSize="small" />
              </IconButton>
            </Tooltip>

            <Tooltip title={`${t("shell.buttons.shortcuts")} (?)`}>
              <IconButton
                size="small"
                onClick={() => studioStore.getState().openShortcutSheet()}
                aria-label={t("shell.buttons.shortcuts")}
              >
                <KeyboardIcon fontSize="small" />
              </IconButton>
            </Tooltip>

            <ToggleButtonGroup
              exclusive
              size="small"
              value={language}
              aria-label={t("shell.language")}
              onChange={(_event, value: Language | null) => {
                if (value !== null) preferencesStore.getState().setLanguage(value);
              }}
              sx={{
                flexShrink: 0,
                "& .MuiToggleButton-root": { px: 1, py: 0.25, fontSize: "0.75rem" },
              }}
            >
              <ToggleButton value="es">ES</ToggleButton>
              <ToggleButton value="en">EN</ToggleButton>
            </ToggleButtonGroup>

            <Tooltip title={t(themeModeToggleLabelKey(themeMode))}>
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
            </Tooltip>

            <Tooltip title={t("shell.layout.label")}>
              <IconButton
                size="small"
                aria-haspopup="true"
                aria-controls={layoutMenuAnchor ? "layout-menu" : undefined}
                aria-label={t("shell.layout.label")}
                onClick={(event) => setLayoutMenuAnchor(event.currentTarget)}
              >
                <DevicesIcon fontSize="small" />
              </IconButton>
            </Tooltip>
            <Menu
              id="layout-menu"
              anchorEl={layoutMenuAnchor}
              open={layoutMenuAnchor !== null}
              onClose={() => setLayoutMenuAnchor(null)}
            >
              {layoutMenuItems(layoutMode, handleLayoutMode, t)}
            </Menu>
          </>
        )}
      </Box>

      {status !== null ? (
        <Snackbar
          open
          anchorOrigin={{ vertical: "top", horizontal: "center" }}
          autoHideDuration={status.severity === "error" ? null : TOAST_HIDE_MS}
          onClose={(_event, reason) => {
            if (reason !== "clickaway") setStatus(null);
          }}
        >
          <Alert
            role="alert"
            severity={status.severity}
            variant="filled"
            onClose={() => setStatus(null)}
            sx={{ maxWidth: 640 }}
          >
            {statusText}
          </Alert>
        </Snackbar>
      ) : null}
    </Box>
  );
}

interface FileMenuItemProps {
  icon: ReactNode;
  label: string;
  /** Shown at the right; `aria-hidden`, so the item's accessible name stays just `label`. */
  shortcut?: string;
  /** Makes the item a checkbox item (a toggle that keeps the menu open). */
  checked?: boolean;
  onSelect: () => void;
}

function FileMenuItem({ icon, label, shortcut, checked, onSelect }: FileMenuItemProps): ReactNode {
  const isToggle = checked !== undefined;
  return (
    <MenuItem
      onClick={onSelect}
      role={isToggle ? "menuitemcheckbox" : undefined}
      aria-checked={isToggle ? checked : undefined}
    >
      <ListItemIcon>{icon}</ListItemIcon>
      <ListItemText>{label}</ListItemText>
      {isToggle && checked ? <CheckIcon fontSize="small" color="primary" sx={{ ml: 3 }} /> : null}
      {shortcut ? (
        <Typography variant="body2" color="text.secondary" aria-hidden="true" sx={{ ml: 3 }}>
          {shortcut}
        </Typography>
      ) : null}
    </MenuItem>
  );
}

/** "Automatic / Desktop / Compact" radio items, shared by the desktop layout menu and the compact main menu. */
function layoutMenuItems(
  current: LayoutMode,
  onSelect: (mode: LayoutMode) => void,
  t: (key: string) => string,
): ReactNode[] {
  return [
    <Typography
      key="layout-heading"
      variant="overline"
      color="text.secondary"
      component="li"
      role="presentation"
      sx={{ px: 2, display: "block", lineHeight: 2.5 }}
    >
      {t("shell.layout.label")}
    </Typography>,
    ...LAYOUT_MODES.map((option) => (
      <MenuItem
        key={`layout-${option}`}
        role="menuitemradio"
        aria-checked={current === option}
        selected={current === option}
        onClick={() => onSelect(option)}
      >
        <ListItemIcon>{current === option ? <CheckIcon fontSize="small" /> : null}</ListItemIcon>
        <ListItemText>{t(`shell.layout.${option}`)}</ListItemText>
      </MenuItem>
    )),
  ];
}

function themeModeToggleLabelKey(current: ThemeMode): string {
  return current === "light" ? "shell.theme.dark" : "shell.theme.light";
}
