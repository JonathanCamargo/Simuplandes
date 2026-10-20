/**
 * The floating toolbar Edit shape shows above a selected edge: switch it
 * between Line / Arc / Curve, or Split it at its midpoint (plates only).
 * Every button goes back to the tool as a `command` event, so the tool
 * owns all the geometry. Mouse-downs never take focus, so Space and Delete
 * keep going to the studio shortcuts and the tool.
 */

import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Button, Paper, ToggleButton, ToggleButtonGroup } from "@mui/material";
import { worldToScreen, type Viewport } from "../../canvas/viewport";
import type { EdgeMenu } from "../types";

export interface EdgeToolbarProps {
  menu: EdgeMenu | undefined;
  viewport: Viewport;
  onCommand: (command: string) => void;
}

/** Screen px between the edge's midpoint and the toolbar's bottom edge. */
const OFFSET_PX = 18;

export function EdgeToolbar({ menu, viewport, onCommand }: EdgeToolbarProps): ReactNode {
  const { t } = useTranslation();
  if (!menu) return null;
  const at = worldToScreen(viewport, menu.at);

  return (
    <Paper
      elevation={3}
      data-testid="edge-toolbar"
      role="toolbar"
      aria-label={t("tools.vertex.edge.label")}
      onMouseDown={(event) => event.preventDefault()}
      sx={{
        position: "absolute",
        left: at.x,
        top: at.y - OFFSET_PX,
        transform: "translate(-50%, -100%)",
        display: "flex",
        alignItems: "center",
        gap: 0.5,
        p: 0.5,
        zIndex: 5,
      }}
    >
      <ToggleButtonGroup
        exclusive
        size="small"
        value={menu.kind}
        onChange={(_event, kind: string | null) => {
          if (kind !== null) onCommand(`edge:${kind}`);
        }}
      >
        <ToggleButton value="line" sx={{ py: 0.25, px: 1 }}>
          {t("tools.vertex.edge.line")}
        </ToggleButton>
        <ToggleButton value="arc" sx={{ py: 0.25, px: 1 }}>
          {t("tools.vertex.edge.arc")}
        </ToggleButton>
        <ToggleButton value="bezier" sx={{ py: 0.25, px: 1 }}>
          {t("tools.vertex.edge.bezier")}
        </ToggleButton>
      </ToggleButtonGroup>
      {menu.canSplit && (
        <Button size="small" onClick={() => onCommand("edge:split")} sx={{ py: 0.25 }}>
          {t("tools.vertex.edge.split")}
        </Button>
      )}
    </Paper>
  );
}
