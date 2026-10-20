/**
 * Opens a mechanism shared through a `#m=<data>` link (see
 * `persistence/shareLink.ts`), at startup and whenever the fragment changes
 * (a link pasted into a tab that already shows the studio only changes the
 * fragment; the page doesn't reload). An empty drawing is replaced straight
 * away; a drawing with links asks first, because the restored autosave may be
 * the student's own work. Either way the fragment is removed afterwards, so a
 * reload never reopens the link over later edits.
 */

import { useEffect, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { StoreApi } from "zustand";
import {
  Alert,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Snackbar,
} from "@mui/material";
import type { MechanismDocument } from "../../model";
import type { MechanismStore } from "../../store";
import type { StudioState } from "../../uiState/studioStore";
import { decodeShareHash, isShareHash } from "../../persistence/shareLink";

export interface ShareLinkLoaderProps {
  mechanismStore: MechanismStore;
  studioStore: StoreApi<StudioState>;
  /** Injectable for tests; default to `window.location` / `window.history` / `window`. */
  location?: Pick<Location, "hash" | "pathname" | "search">;
  history?: Pick<History, "replaceState">;
  events?: Pick<Window, "addEventListener" | "removeEventListener">;
}

type Notice = { severity: "success" | "error"; text: string };

export function ShareLinkLoader({
  mechanismStore,
  studioStore,
  location = window.location,
  history = window.history,
  events = window,
}: ShareLinkLoaderProps): ReactNode {
  const { t } = useTranslation();
  const [pending, setPending] = useState<MechanismDocument | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);

  useEffect(() => {
    let cancelled = false;

    function clearHash(): void {
      history.replaceState(null, "", `${location.pathname}${location.search}`);
    }

    function handle(hash: string): void {
      if (!isShareHash(hash)) return;
      decodeShareHash(hash)
        .then((doc) => {
          if (cancelled) return;
          if (mechanismStore.getState().document.links.length > 0) {
            setPending(doc);
          } else {
            open(doc);
          }
        })
        .catch((e: unknown) => {
          if (cancelled) return;
          clearHash();
          const message = e instanceof Error ? e.message : String(e);
          setNotice({ severity: "error", text: t("shell.alerts.shareFailed", { message }) });
        });
    }

    function open(doc: MechanismDocument): void {
      mechanismStore.getState().loadDocument(doc);
      clearHash();
      studioStore.getState().setMode("simulate");
      setNotice({ severity: "success", text: t("shell.alerts.shareLoaded") });
    }

    function onHashChange(): void {
      handle(location.hash);
    }

    handle(location.hash);
    events.addEventListener("hashchange", onHashChange);
    return () => {
      cancelled = true;
      events.removeEventListener("hashchange", onHashChange);
    };
    // Subscribes once per mount; the injected location/history/events are fixed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function confirm(): void {
    if (pending === null) return;
    mechanismStore.getState().loadDocument(pending);
    setPending(null);
    history.replaceState(null, "", `${location.pathname}${location.search}`);
    studioStore.getState().setMode("simulate");
    setNotice({ severity: "success", text: t("shell.alerts.shareLoaded") });
  }

  function keepMine(): void {
    setPending(null);
    history.replaceState(null, "", `${location.pathname}${location.search}`);
  }

  return (
    <>
      <Dialog open={pending !== null} onClose={keepMine} data-testid="share-confirm">
        <DialogTitle>{t("shell.share.title")}</DialogTitle>
        <DialogContent>{t("shell.share.text")}</DialogContent>
        <DialogActions>
          <Button onClick={keepMine}>{t("shell.share.keep")}</Button>
          <Button onClick={confirm} variant="contained" autoFocus>
            {t("shell.share.open")}
          </Button>
        </DialogActions>
      </Dialog>
      {notice !== null ? (
        <Snackbar
          open
          anchorOrigin={{ vertical: "top", horizontal: "center" }}
          autoHideDuration={notice.severity === "error" ? null : 4000}
          onClose={(_event, reason) => {
            if (reason !== "clickaway") setNotice(null);
          }}
        >
          <Alert severity={notice.severity} variant="filled" onClose={() => setNotice(null)}>
            {notice.text}
          </Alert>
        </Snackbar>
      ) : null}
    </>
  );
}
