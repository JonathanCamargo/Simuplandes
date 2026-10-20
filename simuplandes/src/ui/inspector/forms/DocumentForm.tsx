/** Empty-selection Inspector body: document name, units, entity counts, and dynamics settings (gravity, densities). */

import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import {
  Divider,
  FormControl,
  InputLabel,
  MenuItem,
  Select,
  Stack,
  TextField,
  Typography,
  type SelectChangeEvent,
} from "@mui/material";
import { setDocumentName, setDynamicsSettings, setUnits } from "../../../store/commands";
import { NumberField } from "../NumberField";
import { DEFAULT_DOCUMENT_NAME, type LengthUnit, type MechanismDocument } from "../../../model";
import type { MechanismStore } from "../../../store";

export interface DocumentFormProps {
  store: MechanismStore;
  doc: MechanismDocument;
}

export function DocumentForm({ store, doc }: DocumentFormProps): ReactNode {
  const { t } = useTranslation();

  // The untranslated default name shows as an empty field with a translated
  // placeholder; leaving that field empty keeps the default.
  const isDefaultName = doc.name === DEFAULT_DOCUMENT_NAME;

  function commitName(name: string): void {
    if (isDefaultName && name === "") return;
    if (name !== doc.name) {
      store.getState().execute("inspector-document-name", setDocumentName(name));
    }
  }

  function commitDynamics(edit: Parameters<typeof setDynamicsSettings>[0]): void {
    store.getState().execute("inspector-dynamics", setDynamicsSettings(edit));
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
        defaultValue={isDefaultName ? "" : doc.name}
        placeholder={t("inspector.document.untitled")}
        InputLabelProps={{ shrink: true }}
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
        {[
          t("inspector.document.linkCount", { count: doc.links.length }),
          t("inspector.document.jointCount", { count: doc.joints.length }),
          t("inspector.document.motorCount", { count: doc.motors.length }),
          ...(doc.springs.length > 0
            ? [t("inspector.document.springCount", { count: doc.springs.length })]
            : []),
        ].join(" · ")}
      </Typography>
      <Divider aria-hidden />
      <Typography variant="caption" color="text.secondary">
        {t("inspector.document.dynamics")}
      </Typography>
      <Stack direction="row" spacing={1}>
        <NumberField
          label={t("inspector.document.gravityX")}
          unit="m/s²"
          value={doc.dynamics.gravity[0]}
          onCommit={(v) => commitDynamics({ gravity: [v, doc.dynamics.gravity[1]] })}
        />
        <NumberField
          label={t("inspector.document.gravityY")}
          unit="m/s²"
          value={doc.dynamics.gravity[1]}
          onCommit={(v) => commitDynamics({ gravity: [doc.dynamics.gravity[0], v] })}
        />
      </Stack>
      <NumberField
        label={t("inspector.document.barDensity")}
        unit="kg/m"
        value={doc.dynamics.barDensity}
        fractionDigits={3}
        onCommit={(v) => {
          if (v > 0) commitDynamics({ barDensity: v });
        }}
      />
      <NumberField
        label={t("inspector.document.plateDensity")}
        unit="kg/m²"
        value={doc.dynamics.plateDensity}
        fractionDigits={3}
        onCommit={(v) => {
          if (v > 0) commitDynamics({ plateDensity: v });
        }}
      />
    </Stack>
  );
}
