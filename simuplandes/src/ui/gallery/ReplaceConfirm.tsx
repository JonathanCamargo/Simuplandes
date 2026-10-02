/**
 * "Replace the current drawing?" confirmation shared by the examples gallery
 * and (09-06) the atlas. Pure presentation: the caller decides when to ask.
 */

import type { ReactNode } from "react";
import { Button, Dialog, DialogActions, DialogContent, DialogTitle } from "@mui/material";
import { useTranslation } from "react-i18next";

export interface ReplaceConfirmProps {
  open: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ReplaceConfirm({ open, onConfirm, onCancel }: ReplaceConfirmProps): ReactNode {
  const { t } = useTranslation();
  return (
    <Dialog open={open} onClose={onCancel} data-testid="replace-confirm">
      <DialogTitle>{t("gallery.replace.title")}</DialogTitle>
      <DialogContent>{t("gallery.replace.text")}</DialogContent>
      <DialogActions>
        <Button onClick={onCancel}>{t("gallery.replace.cancel")}</Button>
        <Button onClick={onConfirm} variant="contained" autoFocus>
          {t("gallery.replace.confirm")}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
