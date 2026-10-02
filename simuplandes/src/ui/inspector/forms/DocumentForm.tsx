/** Empty-selection Inspector body: document name, units, and entity counts. */

import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import {
  FormControl,
  InputLabel,
  MenuItem,
  Select,
  Stack,
  TextField,
  Typography,
  type SelectChangeEvent,
} from "@mui/material";
import { setDocumentName, setUnits } from "../../../store/commands";
import type { LengthUnit, MechanismDocument } from "../../../model";
import type { MechanismStore } from "../../../store";

export interface DocumentFormProps {
  store: MechanismStore;
  doc: MechanismDocument;
}

export function DocumentForm({ store, doc }: DocumentFormProps): ReactNode {
  const { t } = useTranslation();

  function commitName(name: string): void {
    if (name !== doc.name) {
      store.getState().execute("inspector-document-name", setDocumentName(name));
    }
  }

  function commitUnits(event: SelectChangeEvent): void {
    const value = event.target.value as LengthUnit;
    if (value !== doc.units.length) {
      store.getState().execute("inspector-units", setUnits(value));
    }
  }

  return (
    <Stack spacing={2}>
      <Typography variant="subtitle2">{t("inspector.document.title")}</Typography>
      <TextField
        size="small"
        label={t("inspector.document.name")}
        defaultValue={doc.name}
        key={doc.name}
        onBlur={(event) => commitName(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") commitName((event.target as HTMLInputElement).value);
        }}
      />
      <FormControl size="small">
        <InputLabel id="inspector-units-label">{t("inspector.document.units")}</InputLabel>
        <Select
          labelId="inspector-units-label"
          label={t("inspector.document.units")}
          value={doc.units.length}
          onChange={commitUnits}
        >
          <MenuItem value="mm">{t("common.units.mm")}</MenuItem>
          <MenuItem value="m">{t("common.units.m")}</MenuItem>
        </Select>
      </FormControl>
      <Typography variant="body2" color="text.secondary">
        {t("inspector.document.counts", {
          links: doc.links.length,
          joints: doc.joints.length,
          motors: doc.motors.length,
        })}
      </Typography>
    </Stack>
  );
}
