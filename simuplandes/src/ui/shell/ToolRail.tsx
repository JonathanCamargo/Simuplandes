/**
 * The tool rail: one button per registry entry of the current editing mode
 * (`toolsForMode`) inside a single `ToggleButtonGroup` -- no hard-coded tool
 * list. Vertical at the left of the canvas, or a horizontal, scrollable bar
 * under it in the compact portrait layout; `touch` enlarges the buttons to
 * finger size.
 * Registry groups are separated visually with extra spacing after the last
 * button of each group, rather than a literal `Divider` element (a `Divider`
 * sibling inside `ToggleButtonGroup` would receive cloned group props it
 * doesn't understand).
 */

import type { MouseEvent, ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useStore, type StoreApi } from "zustand";
import { Stack, ToggleButton, ToggleButtonGroup, Tooltip } from "@mui/material";
import { toolsForMode, type ToolId } from "../../tools/registry";
import { TOOL_ICONS } from "./toolIcons";
import type { StudioState } from "../../uiState/studioStore";

export interface ToolRailProps {
  studioStore: StoreApi<StudioState>;
  orientation?: "vertical" | "horizontal";
  /** Finger-sized (44px) buttons for the compact layout. */
  touch?: boolean;
}

export function ToolRail({
  studioStore,
  orientation = "vertical",
  touch = false,
}: ToolRailProps): ReactNode {
  const { t } = useTranslation();
  const activeTool = useStore(studioStore, (s) => s.activeTool);
  // Simulate keeps Build's rail (its Select/Pan stay usable there).
  const railMode = useStore(studioStore, (s) => (s.mode === "draw" ? "draw" : "build"));
  const tools = toolsForMode(railMode);
  const horizontal = orientation === "horizontal";

  function handleChange(_event: MouseEvent<HTMLElement>, value: ToolId | null): void {
    if (value !== null) studioStore.getState().setActiveTool(value);
  }

  return (
    <Stack
      component="nav"
      aria-label={t("shell.rail.label")}
      spacing={0.5}
      // Start-aligned when horizontal, so a bar wider than the screen scrolls to its first tool.
      alignItems={horizontal ? "flex-start" : "center"}
      sx={
        horizontal
          ? {
              gridArea: "rail",
              px: 1,
              py: 0.5,
              borderTop: 1,
              borderColor: "divider",
              overflowX: "auto",
            }
          : { gridArea: "rail", py: 1, borderRight: 1, borderColor: "divider", overflowY: "auto" }
      }
    >
      <ToggleButtonGroup
        orientation={orientation}
        exclusive
        value={activeTool}
        onChange={handleChange}
        size="small"
        sx={touch ? { "& .MuiToggleButton-root": { minWidth: 44, minHeight: 44 } } : undefined}
      >
        {tools.map((tool, index) => {
          const Icon = TOOL_ICONS[tool.id];
          const label = `${t(tool.labelKey)} (${tool.key.toUpperCase()})`;
          const tooltip = `${t(tool.labelKey)} — ${tool.key.toUpperCase()} — ${t(tool.descKey)}`;
          const nextTool = tools[index + 1];
          const isLastOfGroup = nextTool === undefined || nextTool.group !== tool.group;
          const groupGap = horizontal ? { mr: 1 } : { mb: 1 };

          return (
            <Tooltip key={tool.id} title={tooltip} placement={horizontal ? "top" : "right"}>
              <ToggleButton
                value={tool.id}
                data-tool-id={tool.id}
                aria-label={label}
                sx={isLastOfGroup ? groupGap : undefined}
              >
                <Icon fontSize={touch ? "medium" : "small"} />
              </ToggleButton>
            </Tooltip>
          );
        })}
      </ToggleButtonGroup>
    </Stack>
  );
}
