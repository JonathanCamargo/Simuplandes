/** Free-site Inspector form (a site with no joint): name, world X/Y. */

import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Stack, TextField, Typography } from "@mui/material";
import { NumberField } from "../NumberField";
import { moveSiteClusterRecipes } from "../edits";
import { rename } from "../../../store/commands";
import { siteWorldPosition, type Link, type MechanismDocument, type Site } from "../../../model";
import type { MechanismStore } from "../../../store";

export interface SiteFormProps {
  store: MechanismStore;
  doc: MechanismDocument;
  site: Site;
  link: Link;
}

export function SiteForm({ store, doc, site, link }: SiteFormProps): ReactNode {
  const { t } = useTranslation();
  const world = siteWorldPosition(link, site.local);

  function commitName(name: string): void {
    if (name !== site.name) {
      store.getState().execute("inspector-site-name", rename(site.id, name));
    }
  }

  function commitWorld(edit: { x?: number; y?: number }): void {
    const next = { x: edit.x ?? world.x, y: edit.y ?? world.y };
    store.getState().execute("inspector-site-move", moveSiteClusterRecipes(doc, site.id, next));
  }

  return (
    <Stack spacing={2}>
      <Typography variant="subtitle2">{t("inspector.site.title")}</Typography>
      <TextField
        size="small"
        label={t("inspector.common.name")}
        defaultValue={site.name}
        key={`${site.id}-${site.name}`}
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
    </Stack>
  );
}
