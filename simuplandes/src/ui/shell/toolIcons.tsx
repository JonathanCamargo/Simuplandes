/**
 * `ToolId -> icon` for the rail. Kept in its own module so `ToolRail.tsx`
 * stays a thin `TOOL_REGISTRY.map`.
 */

import type { ComponentType } from "react";
import type { SvgIconProps } from "@mui/material/SvgIcon";
// Imported from the `esm/` subpath, not the package root: see TopBar.tsx's
// TSDoc for why (a real-browser-only `@mui/icons-material` CJS/ESM interop
// break, first caught by 04-06's E2E suite).
import NearMeIcon from "@mui/icons-material/esm/NearMe";
import PanToolIcon from "@mui/icons-material/esm/PanTool";
import HorizontalRuleIcon from "@mui/icons-material/esm/HorizontalRule";
import PentagonIcon from "@mui/icons-material/esm/Pentagon";
import AnchorIcon from "@mui/icons-material/esm/Anchor";
import RadioButtonUncheckedIcon from "@mui/icons-material/esm/RadioButtonUnchecked";
import SwapHorizIcon from "@mui/icons-material/esm/SwapHoriz";
import AutorenewIcon from "@mui/icons-material/esm/Autorenew";
import AddLocationAltIcon from "@mui/icons-material/esm/AddLocationAlt";
import type { ToolId } from "../../tools/registry";

export const TOOL_ICONS: Record<ToolId, ComponentType<SvgIconProps>> = {
  select: NearMeIcon,
  pan: PanToolIcon,
  bar: HorizontalRuleIcon,
  plate: PentagonIcon,
  groundPivot: AnchorIcon,
  pin: RadioButtonUncheckedIcon,
  slider: SwapHorizIcon,
  motor: AutorenewIcon,
  marker: AddLocationAltIcon,
};
