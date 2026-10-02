/**
 * Link Inspector form: name, colour (with a reset to the link-type default),
 * a read-only ground chip, position X/Y + angle (degrees), an exact bar
 * length for two-site links, and a clickable list of the link's sites.
 */

import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import {
  Button,
  Chip,
  Divider,
  List,
  ListItemButton,
  ListItemText,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import { NumberField } from "../NumberField";
import { barLength, linkPoseRecipe, setBarLengthRecipes } from "../edits";
import { rename, setLinkColor } from "../../../store/commands";
import { siteWorldPosition, radToDeg, type Link, type MechanismDocument } from "../../../model";
import type { MechanismStore } from "../../../store";

export interface LinkFormProps {
  store: MechanismStore;
  doc: MechanismDocument;
  link: Link;
}

/** Neutral swatch shown while a link has no explicit color override. */
const DEFAULT_COLOR_SWATCH = "#808080";

export function LinkForm({ store, doc, link }: LinkFormProps): ReactNode {
  const { t } = useTranslation();
  const length = barLength(link);

  function commitName(name: string): void {
    if (name !== link.name) {
      store.getState().execute("inspector-link-name", rename(link.id, name));
    }
  }

  function commitPose(edit: { x?: number; y?: number; angleDeg?: number }): void {
    store.getState().execute("inspector-link-pose", linkPoseRecipe(link, edit));
  }

  function commitLength(value: number): void {
    store.getState().execute("inspector-link-length", setBarLengthRecipes(doc, link, value));
  }

  function commitColor(color: string): void {
    store.getState().execute("inspector-link-color", setLinkColor(link.id, color));
  }

  function resetColor(): void {
    store.getState().execute("inspector-link-color", setLinkColor(link.id, undefined));
  }

  return (
    <Stack spacing={2}>
      <Typography variant="subtitle2">{t("inspector.link.title")}</Typography>
      <TextField
        size="small"
        label={t("inspector.common.name")}
        defaultValue={link.name}
        key={`${link.id}-${link.name}`}
        onBlur={(event) => commitName(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") commitName((event.target as HTMLInputElement).value);
        }}
      />
      <Stack direction="row" spacing={1} alignItems="center">
        <label>
          {t("inspector.link.color")}
          <input
            type="color"
            aria-label={t("inspector.link.color")}
            value={link.color ?? DEFAULT_COLOR_SWATCH}
            onChange={(event) => commitColor(event.target.value)}
            style={{ marginLeft: 8, verticalAlign: "middle" }}
          />
        </label>
        {link.color !== undefined ? (
          <Button size="small" onClick={resetColor}>
            {t("inspector.link.resetColor")}
          </Button>
        ) : null}
        {link.isGround ? <Chip size="small" label={t("inspector.link.ground")} /> : null}
      </Stack>
      <NumberField
        label={t("inspector.common.x")}
        value={link.pose.position[0]}
        onCommit={(v) => commitPose({ x: v })}
      />
      <NumberField
        label={t("inspector.common.y")}
        value={link.pose.position[1]}
        onCommit={(v) => commitPose({ y: v })}
      />
      <NumberField
        label={t("inspector.common.angle")}
        unit="°"
        value={radToDeg(link.pose.angle)}
        onCommit={(v) => commitPose({ angleDeg: v })}
      />
      {length !== null ? (
        <NumberField label={t("inspector.link.length")} value={length} onCommit={commitLength} />
      ) : null}
      <Divider />
      <Typography variant="caption" color="text.secondary">
        {t("inspector.link.sites")}
      </Typography>
      <List dense disablePadding>
        {link.sites.map((site) => {
          const world = siteWorldPosition(link, site.local);
          return (
            <ListItemButton key={site.id} onClick={() => store.getState().select([site.id])}>
              <ListItemText
                primary={site.name || site.id}
                secondary={`${world.x.toFixed(2)}, ${world.y.toFixed(2)}`}
              />
            </ListItemButton>
          );
        })}
      </List>
    </Stack>
  );
}
