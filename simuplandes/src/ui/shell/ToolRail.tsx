/**
 * The vertical tool rail: `TOOL_REGISTRY.map` builds one button per registry
 * entry inside a single `ToggleButtonGroup` -- no hard-coded tool list.
 * Registry groups are separated visually with extra spacing after the last
 * button of each group, rather than a literal `Divider` element (a `Divider`
 * sibling inside `ToggleButtonGroup` would receive cloned group props it
 * doesn't understand).
 */

import type { MouseEvent, ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useStore, type StoreApi } from "zustand";
import { Stack, ToggleButton, ToggleButtonGroup, Tooltip } from "@mui/material";
import { TOOL_REGISTRY, type ToolId } from "../../tools/registry";
import { TOOL_ICONS } from "./toolIcons";
import type { StudioState } from "../../uiState/studioStore";

export function ToolRail({ studioStore }: { studioStore: StoreApi<StudioState> }): ReactNode {
  const { t } = useTranslation();
  const activeTool = useStore(studioStore, (s) => s.activeTool);

  function handleChange(_event: MouseEvent<HTMLElement>, value: ToolId | null): void {
    if (value !== null) studioStore.getState().setActiveTool(value);
  }

  return (
    <Stack
      component="nav"
      aria-label={t("shell.rail.label")}
      spacing={0.5}
      alignItems="center"
      sx={{ gridArea: "rail", py: 1, borderRight: 1, borderColor: "divider", overflowY: "auto" }}
    >
      <ToggleButtonGroup
        orientation="vertical"
        exclusive
        value={activeTool}
        onChange={handleChange}
        size="small"
      >
        {TOOL_REGISTRY.map((tool, index) => {
          const Icon = TOOL_ICONS[tool.id];
          const label = `${t(tool.labelKey)} (${tool.key.toUpperCase()})`;
          const tooltip = `${t(tool.labelKey)} — ${tool.key.toUpperCase()} — ${t(tool.descKey)}`;
          const nextTool = TOOL_REGISTRY[index + 1];
          const isLastOfGroup = nextTool === undefined || nextTool.group !== tool.group;

          return (
            <Tooltip key={tool.id} title={tooltip} placement="right">
              <ToggleButton
                value={tool.id}
                data-tool-id={tool.id}
                aria-label={label}
                sx={isLastOfGroup ? { mb: 1 } : undefined}
              >
                <Icon fontSize="small" />
              </ToggleButton>
            </Tooltip>
          );
        })}
      </ToggleButtonGroup>
    </Stack>
  );
}
