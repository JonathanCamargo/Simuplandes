/** Marker Inspector form: name, world X/Y, and a link to the owning link. */

import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Link as MuiLink, Stack, TextField, Typography } from "@mui/material";
import { NumberField } from "../NumberField";
import { markerWorldRecipes } from "../edits";
import { rename } from "../../../store/commands";
import {
  indexDocument,
  siteWorldPosition,
  type Marker,
  type MechanismDocument,
} from "../../../model";
import type { MechanismStore } from "../../../store";

export interface MarkerFormProps {
  store: MechanismStore;
  doc: MechanismDocument;
  marker: Marker;
}

export function MarkerForm({ store, doc, marker }: MarkerFormProps): ReactNode {
  const { t } = useTranslation();
  const link = indexDocument(doc).links.get(marker.linkId);
  if (!link) {
    // Document integrity (checkDocumentIntegrity) guarantees every marker's
    // linkId resolves; this only guards against a stale/invalid caller.
    throw new Error(`inspector: marker "${marker.id}" references unknown link "${marker.linkId}"`);
  }
  const world = siteWorldPosition(link, marker.local);

  function commitName(name: string): void {
    if (name !== marker.name) {
      store.getState().execute("inspector-marker-name", rename(marker.id, name));
    }
  }

  function commitWorld(edit: { x?: number; y?: number }): void {
    const next = { x: edit.x ?? world.x, y: edit.y ?? world.y };
    store.getState().execute("inspector-marker-move", markerWorldRecipes(doc, marker, next));
  }

  return (
    <Stack spacing={2}>
      <Typography variant="subtitle2">{t("inspector.marker.title")}</Typography>
      <TextField
        size="small"
        label={t("inspector.common.name")}
        defaultValue={marker.name}
        key={`${marker.id}-${marker.name}`}
        onBlur={(event) => commitName(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") commitName((event.target as HTMLInputElement).value);
        }}
      />
      <NumberField
        label={t("inspector.common.x")}
        value={world.x}
        onCommit={(v) => commitWorld({ x: v })}
      />
      <NumberField
        label={t("inspector.common.y")}
        value={world.y}
        onCommit={(v) => commitWorld({ y: v })}
      />
      <MuiLink
        component="button"
        type="button"
        variant="body2"
        underline="hover"
        onClick={() => store.getState().select([link.id])}
      >
        {t("inspector.marker.link")}: {link.name}
      </MuiLink>
    </Stack>
  );
}
