/**
 * The Ctrl+K command palette: the bare `cmdk` primitives (`Command`,
 * `Command.Input`, `Command.List`, `Command.Item`, `Command.Empty`) inside a
 * plain MUI `Dialog` -- deliberately NOT `Command.Dialog`, so only MUI's own
 * focus trap is active (no double dialog/double focus-trap). `cmdk` owns
 * filtering (fuzzy, via its default `command-score` filter over each item's
 * `value` + `keywords`) and all arrow-key/Enter navigation; this component
 * only wires `onSelect` to the real store calls and handles Escape itself.
 *
 * Escape isolation (must_haves: "Esc ... does not cancel an in-progress
 * draw"): `disableEscapeKeyDown` turns off MUI's own document-level Escape
 * listener, and this component installs its OWN `document`-level, CAPTURE-
 * phase `keydown` listener (only while `open`) that calls `stopPropagation()`
 * before closing -- so the native keydown never reaches `window`, where
 * `useToolController`'s own listener lives. (That listener also
 * independently no-ops while `selectModalOpen()` is true, but stopping
 * propagation here avoids the race where closing the palette flips
 * `paletteOpen` back to `false` in the SAME tick the event would otherwise
 * still be bubbling toward `window`.)
 *
 * The listener is on `document`, not a React `onKeyDownCapture` prop on some
 * element inside the dialog: MUI's `FocusTrap` moves focus to the Paper
 * root (or later, `cmdk`'s own input) in a PASSIVE EFFECT, which can still
 * be pending when Escape is pressed -- during that window
 * `document.activeElement` is `<body>`, and a React-element-scoped capture
 * handler on any DESCENDANT of body (Paper, the input, ...) never receives
 * an event whose target IS body (only a target's ANCESTORS receive it). A
 * plain `document.addEventListener(..., true)` is unaffected by exactly
 * where focus currently sits -- confirmed by an E2E test that failed
 * intermittently with the React-prop version (Escape pressed immediately
 * after the dialog became visible, before focus finished settling) and
 * passes reliably with this one.
 */

import { useEffect, useMemo, useRef, type ReactNode } from "react";
import { useStore, type StoreApi } from "zustand";
import { useTranslation } from "react-i18next";
import { Command } from "cmdk";
import { Box, Dialog, Typography } from "@mui/material";
import type { MechanismStore } from "../../store";
import type { StudioState } from "../../uiState/studioStore";
import type { PreferencesState } from "../../uiState/preferences";
import { TOOL_ICONS } from "../shell/toolIcons";
import {
  buildPaletteCommands,
  type PaletteAction,
  type PaletteCommand,
  type PaletteGroup,
} from "./paletteCommands";

export interface CommandPaletteProps {
  studioStore: StoreApi<StudioState>;
  mechanismStore: MechanismStore;
  preferencesStore: StoreApi<PreferencesState>;
}

const GROUP_ORDER: readonly PaletteGroup[] = [
  "file",
  "tools",
  "edit",
  "view",
  "preferences",
  "help",
];

export function CommandPalette({
  studioStore,
  mechanismStore,
  preferencesStore,
}: CommandPaletteProps): ReactNode {
  const { t } = useTranslation();
  const open = useStore(studioStore, (s) => s.paletteOpen);
  const commands = useMemo(() => buildPaletteCommands(), []);
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (open) {
      previouslyFocusedRef.current =
        document.activeElement instanceof HTMLElement ? document.activeElement : null;
    }
  }, [open]);

  function close(): void {
    studioStore.getState().closePalette();
    previouslyFocusedRef.current?.focus();
  }

  // `close` (referenced below) reads fresh store state via `.getState()`
  // and the ref directly, so it never needs to be in this effect's own
  // dependency list -- only `open` controls whether the listener is live.
  useEffect(() => {
    if (!open) return;
    function handleDocumentKeyDown(event: KeyboardEvent): void {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      close();
    }
    document.addEventListener("keydown", handleDocumentKeyDown, true);
    return () => document.removeEventListener("keydown", handleDocumentKeyDown, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  function runAction(action: PaletteAction): void {
    switch (action.type) {
      case "setTool":
        studioStore.getState().setActiveTool(action.tool);
        break;
      case "undo":
        mechanismStore.getState().undo();
        break;
      case "redo":
        mechanismStore.getState().redo();
        break;
      case "delete":
        mechanismStore.getState().deleteSelection();
        break;
      case "fit":
        studioStore.getState().requestFit();
        break;
      case "toggleGrid":
        preferencesStore.getState().setGridVisible(!preferencesStore.getState().gridVisible);
        break;
      case "toggleSnap":
        preferencesStore.getState().setSnapEnabled(!preferencesStore.getState().snapEnabled);
        break;
      case "toggleTheme":
        preferencesStore.getState().toggleThemeMode();
        break;
      case "setLanguage":
        preferencesStore.getState().setLanguage(action.language);
        break;
      case "openShortcutSheet":
        studioStore.getState().openShortcutSheet();
        break;
      case "openDialog":
        studioStore.getState().openDialog(action.dialog);
        break;
    }
  }

  function handleSelect(command: PaletteCommand): void {
    runAction(command.action);
    close();
  }

  return (
    <Dialog
      open={open}
      onClose={close}
      disableEscapeKeyDown
      fullWidth
      maxWidth="sm"
      // `transitionDuration={0}`: a real browser's default ~225ms Fade
      // otherwise leaves a real window where `[data-testid]`/`toBeVisible()`
      // already sees the dialog while focus is STILL on the Paper root
      // (MUI's FocusTrap target) rather than the input -- during that
      // window a real Enter/Escape keypress lands on the wrong element.
      // Zero duration collapses that window; `onEntered` below still fires
      // (react-transition-group processes it on the next tick either way).
      transitionDuration={0}
      PaperProps={{ sx: { position: "fixed", top: "12%" } }}
      // MUI's Modal defers actually mounting its children by one commit (it
      // tracks its own `exited` state, so `inputRef.current` is still `null`
      // on the very first `open`-becomes-true render) -- `onEntered` fires
      // only once the child is truly mounted (and any enter transition has
      // finished), which is also AFTER MUI's own FocusTrap has run its
      // one-shot auto-focus, so this always wins the race deterministically.
      TransitionProps={{ onEntered: () => inputRef.current?.focus() }}
    >
      <Command label={t("palette.label")}>
        <Box sx={{ p: 1.5, borderBottom: 1, borderColor: "divider" }}>
          <Command.Input
            ref={inputRef}
            placeholder={t("palette.placeholder")}
            style={{
              width: "100%",
              border: "none",
              outline: "none",
              font: "inherit",
              fontSize: "1rem",
              background: "transparent",
              padding: "8px 4px",
            }}
          />
        </Box>
        <Command.List style={{ maxHeight: 360, overflowY: "auto", padding: "4px 0" }}>
          <Command.Empty>
            <Box sx={{ px: 2, py: 3, color: "text.secondary" }}>{t("palette.empty")}</Box>
          </Command.Empty>
          {GROUP_ORDER.map((group) => (
            <Command.Group key={group} heading={t(`palette.groups.${group}`)}>
              {commands
                .filter((c) => c.group === group)
                .map((command) => {
                  const Icon =
                    command.action.type === "setTool" ? TOOL_ICONS[command.action.tool] : null;
                  const label = t(command.labelKey);
                  return (
                    <Command.Item
                      key={command.id}
                      value={label}
                      keywords={command.keywordsKeys.map((key) => t(key))}
                      onSelect={() => handleSelect(command)}
                    >
                      <Box
                        sx={{
                          display: "flex",
                          alignItems: "center",
                          gap: 1,
                          width: "100%",
                          px: 1,
                          py: 0.75,
                        }}
                      >
                        {Icon ? <Icon fontSize="small" /> : null}
                        <Typography component="span" sx={{ flex: 1 }}>
                          {label}
                        </Typography>
                        {command.shortcut ? (
                          <Typography component="kbd" variant="caption" sx={{ opacity: 0.7 }}>
                            {command.shortcut}
                          </Typography>
                        ) : null}
                      </Box>
                    </Command.Item>
                  );
                })}
            </Command.Group>
          ))}
        </Command.List>
      </Command>
    </Dialog>
  );
}
