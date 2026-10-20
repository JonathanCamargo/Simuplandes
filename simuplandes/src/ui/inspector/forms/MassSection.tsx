/**
 * A moving link's mass properties, for dynamics: computed from its shape
 * and the document densities (read-only), or custom (mass, center of mass,
 * inertia about the center of mass). Switching to custom starts from the
 * computed values; switching back drops the custom ones.
 */

import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Stack, ToggleButton, ToggleButtonGroup, Typography } from "@mui/material";
import { NumberField } from "../NumberField";
import { setLinkMassProperties } from "../../../store/commands";
import {
  computedMassProperties,
  resolveMassProperties,
  type Link,
  type MassProperties,
  type MechanismDocument,
} from "../../../model";
import { formatSignificant, type Language } from "../../../i18n/numberFormat";
import type { MechanismStore } from "../../../store";

export interface MassSectionProps {
  store: MechanismStore;
  doc: MechanismDocument;
  link: Link;
}

export function MassSection({ store, doc, link }: MassSectionProps): ReactNode {
  const { t, i18n } = useTranslation();
  const lang = i18n.language as Language;
  const resolved = resolveMassProperties(link, doc);
  const unit = doc.units.length;
  const custom = resolved.source === "authored";

  function setMode(mode: "computed" | "custom" | null): void {
    if (mode === null || mode === (custom ? "custom" : "computed")) return;
    store
      .getState()
      .execute(
        "inspector-link-mass",
        setLinkMassProperties(
          link.id,
          mode === "custom" ? computedMassProperties(link, doc) : undefined,
        ),
      );
  }

  function commit(edit: Partial<MassProperties>): void {
    const { mass, com, inertia } = resolved;
    store.getState().execute(
      "inspector-link-mass",
      setLinkMassProperties(link.id, {
        mass: Math.max(0, edit.mass ?? mass),
        com: edit.com ?? com,
        inertia: Math.max(0, edit.inertia ?? inertia),
      }),
    );
  }

  return (
    <Stack spacing={1.5}>
      <Typography variant="caption" color="text.secondary">
        {t("inspector.link.mass")}
      </Typography>
      <ToggleButtonGroup
        size="small"
        exclusive
        value={custom ? "custom" : "computed"}
        onChange={(_event, value: "computed" | "custom" | null) => setMode(value)}
        aria-label={t("inspector.link.mass")}
      >
        <ToggleButton value="computed">{t("inspector.link.massComputed")}</ToggleButton>
        <ToggleButton value="custom">{t("inspector.link.massCustom")}</ToggleButton>
      </ToggleButtonGroup>
      {custom ? (
        <>
          <NumberField
            label={t("inspector.link.massValue")}
            unit="kg"
            value={resolved.mass}
            fractionDigits={4}
            onCommit={(v) => commit({ mass: v })}
          />
          <NumberField
            label={t("inspector.link.comX")}
            unit={unit}
            value={resolved.com[0]}
            onCommit={(v) => commit({ com: [v, resolved.com[1]] })}
          />
          <NumberField
            label={t("inspector.link.comY")}
            unit={unit}
            value={resolved.com[1]}
            onCommit={(v) => commit({ com: [resolved.com[0], v] })}
          />
          <NumberField
            label={t("inspector.link.inertia")}
            unit="kg·m²"
            value={resolved.inertia}
            fractionDigits={8}
            onCommit={(v) => commit({ inertia: v })}
          />
        </>
      ) : (
        <Typography variant="body2" color="text.secondary" data-testid="computed-mass">
          {`${t("inspector.link.massValue")}: ${formatSignificant(resolved.mass, lang)} kg · ${t(
            "inspector.link.inertia",
          )}: ${formatSignificant(resolved.inertia, lang)} kg·m²`}
          <br />
          {t("inspector.link.massHint")}
        </Typography>
      )}
    </Stack>
  );
}
