/**
 * The loads on a moving link's sites, for dynamics: each with its site, a
 * world-frame force (N) and a torque (N·m), and a remove button. New loads
 * start on the link's first site pointing down.
 */

import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import {
  Button,
  Divider,
  IconButton,
  MenuItem,
  Select,
  Stack,
  Typography,
  type SelectChangeEvent,
} from "@mui/material";
// Imported from the `esm/` subpath: see TopBar.tsx's TSDoc.
import DeleteOutlineIcon from "@mui/icons-material/esm/DeleteOutline";
import { NumberField } from "../NumberField";
import { loadsOnLink } from "../edits";
import { deleteEntities, setLoad } from "../../../store/commands";
import type { Link, MechanismDocument } from "../../../model";
import type { MechanismStore } from "../../../store";

export interface LoadsSectionProps {
  store: MechanismStore;
  doc: MechanismDocument;
  link: Link;
}

/** The force a new load starts with, N. */
const NEW_LOAD_FORCE: [number, number] = [0, -1];

export function LoadsSection({ store, doc, link }: LoadsSectionProps): ReactNode {
  const { t } = useTranslation();
  const entries = loadsOnLink(doc, link);

  function addLoad(): void {
    store.getState().addLoad({ siteId: link.sites[0].id, force: NEW_LOAD_FORCE, torque: 0 });
  }

  return (
    <Stack spacing={1.5}>
      <Typography variant="caption" color="text.secondary">
        {t("inspector.link.loads")}
      </Typography>
      {entries.length === 0 ? (
        <Typography variant="body2" color="text.secondary">
          {t("inspector.link.noLoads")}
        </Typography>
      ) : null}
      {entries.map(({ load }, i) => (
        <Stack
          key={load.id}
          spacing={1}
          role="group"
          aria-label={`${t("inspector.link.loads")} ${i + 1}`}
        >
          {i > 0 ? <Divider aria-hidden /> : null}
          <Stack direction="row" spacing={1} alignItems="center">
            <Select
              size="small"
              value={load.siteId}
              inputProps={{ "aria-label": t("inspector.link.loadSite") }}
              onChange={(event: SelectChangeEvent) =>
                store
                  .getState()
                  .execute("inspector-load", setLoad(load.id, { siteId: event.target.value }))
              }
              sx={{ flex: 1 }}
            >
              {link.sites.map((site) => (
                <MenuItem key={site.id} value={site.id}>
                  {site.name || site.id}
                </MenuItem>
              ))}
            </Select>
            <IconButton
              size="small"
              aria-label={t("inspector.link.removeLoad")}
              onClick={() =>
                store
                  .getState()
                  .execute("inspector-load-remove", deleteEntities(new Set([load.id])))
              }
            >
              <DeleteOutlineIcon fontSize="small" />
            </IconButton>
          </Stack>
          <Stack direction="row" spacing={1}>
            <NumberField
              label={t("inspector.link.loadFx")}
              unit="N"
              value={load.force[0]}
              onCommit={(v) =>
                store
                  .getState()
                  .execute("inspector-load", setLoad(load.id, { force: [v, load.force[1]] }))
              }
            />
            <NumberField
              label={t("inspector.link.loadFy")}
              unit="N"
              value={load.force[1]}
              onCommit={(v) =>
                store
                  .getState()
                  .execute("inspector-load", setLoad(load.id, { force: [load.force[0], v] }))
              }
            />
          </Stack>
          <NumberField
            label={t("inspector.link.loadTorque")}
            unit="N·m"
            value={load.torque}
            onCommit={(v) =>
              store.getState().execute("inspector-load", setLoad(load.id, { torque: v }))
            }
          />
        </Stack>
      ))}
      {link.sites.length > 0 ? (
        <Button size="small" variant="outlined" onClick={addLoad}>
          {t("inspector.link.addLoad")}
        </Button>
      ) : null}
    </Stack>
  );
}
