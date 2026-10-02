/** Multi-selection Inspector body: a count and a "Clear selection" button. */

import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Button, Stack, Typography } from "@mui/material";
import type { MechanismStore } from "../../../store";

export interface MultiSelectionFormProps {
  store: MechanismStore;
  count: number;
}

export function MultiSelectionForm({ store, count }: MultiSelectionFormProps): ReactNode {
  const { t } = useTranslation();

  return (
    <Stack spacing={2}>
      <Typography variant="subtitle2">{t("inspector.multi.count", { count })}</Typography>
      <Button size="small" variant="outlined" onClick={() => store.getState().clearSelection()}>
        {t("inspector.common.clearSelection")}
      </Button>
    </Stack>
  );
}
