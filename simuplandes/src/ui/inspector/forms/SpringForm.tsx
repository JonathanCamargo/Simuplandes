/**
 * Spring Inspector form: name, stiffness, damping, and the free length (a
 * linear spring, with its current reference length for comparison) or the
 * free angle (a torsional spring, in degrees, with its joint). Negative
 * values are clamped to 0 before committing.
 */

import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Stack, TextField, Typography } from "@mui/material";
import { NumberField } from "../NumberField";
import { springJointLabel, springReferenceLength } from "../edits";
import { rename, setSpringParameters, type SpringParameters } from "../../../store/commands";
import { degToRad, radToDeg, type MechanismDocument, type Spring } from "../../../model";
import { formatNumber, type Language } from "../../../i18n/numberFormat";
import type { MechanismStore } from "../../../store";

export interface SpringFormProps {
  store: MechanismStore;
  doc: MechanismDocument;
  spring: Spring;
}

export function SpringForm({ store, doc, spring }: SpringFormProps): ReactNode {
  const { t, i18n } = useTranslation();
  const lang = i18n.language as Language;
  const linear = spring.kind === "linear";
  const unit = doc.units.length;

  function commitName(name: string): void {
    if (name !== spring.name) {
      store.getState().execute("inspector-spring-name", rename(spring.id, name));
    }
  }

  function commit(params: SpringParameters): void {
    store.getState().execute("inspector-spring", setSpringParameters(spring.id, params));
  }

  const nonNegative = (value: number): number => Math.max(0, value);

  return (
    <Stack spacing={2}>
      <Typography variant="subtitle2">
        {linear ? t("inspector.spring.title") : t("inspector.spring.titleTorsional")}
      </Typography>
      <TextField
        size="small"
        label={t("inspector.common.name")}
        defaultValue={spring.name}
        key={`${spring.id}-${spring.name}`}
        onBlur={(event) => commitName(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") commitName((event.target as HTMLInputElement).value);
        }}
      />
      {spring.kind === "torsional" ? (
        <Typography variant="body2" color="text.secondary">
          {t("inspector.spring.joint", { joint: springJointLabel(doc, spring) })}
        </Typography>
      ) : null}
      <NumberField
        label={t("inspector.spring.stiffness")}
        unit={linear ? "N/m" : "N·m/rad"}
        value={spring.stiffness}
        fractionDigits={3}
        onCommit={(v) => commit({ stiffness: nonNegative(v) })}
      />
      <NumberField
        label={t("inspector.spring.damping")}
        unit={linear ? "N·s/m" : "N·m·s/rad"}
        value={spring.damping}
        fractionDigits={3}
        onCommit={(v) => commit({ damping: nonNegative(v) })}
      />
      {spring.kind === "linear" ? (
        <>
          <NumberField
            label={t("inspector.spring.freeLength")}
            unit={unit}
            value={spring.freeLength}
            onCommit={(v) => commit({ freeLength: nonNegative(v) })}
          />
          <Typography variant="caption" color="text.secondary">
            {t("inspector.spring.length", {
              length: `${formatNumber(springReferenceLength(doc, spring), lang, 2)} ${unit}`,
            })}
          </Typography>
        </>
      ) : (
        <NumberField
          label={t("inspector.spring.freeAngle")}
          unit="°"
          value={radToDeg(spring.freeAngle)}
          onCommit={(v) => commit({ freeAngle: degToRad(v) })}
        />
      )}
    </Stack>
  );
}
