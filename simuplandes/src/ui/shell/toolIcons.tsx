/**
 * `ToolId -> icon` for the rail. Kept in its own module so `ToolRail.tsx`
 * stays a thin `TOOL_REGISTRY.map`.
 */

import type { ComponentType } from "react";
import type { SvgIconProps } from "@mui/material/SvgIcon";
import { createSvgIcon } from "@mui/material/utils";
// Imported from the `esm/` subpath, not the package root: see TopBar.tsx's
// TSDoc for why (a real-browser-only `@mui/icons-material` CJS/ESM interop
// break, first caught by 04-06's E2E suite).
import NearMeIcon from "@mui/icons-material/esm/NearMe";
import PanToolIcon from "@mui/icons-material/esm/PanTool";
import HorizontalRuleIcon from "@mui/icons-material/esm/HorizontalRule";
import PentagonIcon from "@mui/icons-material/esm/Pentagon";
import AnchorIcon from "@mui/icons-material/esm/Anchor";
import RadioButtonUncheckedIcon from "@mui/icons-material/esm/RadioButtonUnchecked";
import AutorenewIcon from "@mui/icons-material/esm/Autorenew";
import AddLocationAltIcon from "@mui/icons-material/esm/AddLocationAlt";
import ShapeLineIcon from "@mui/icons-material/esm/ShapeLine";
import BrushIcon from "@mui/icons-material/esm/Brush";
import AutoFixNormalIcon from "@mui/icons-material/esm/AutoFixNormal";
import ImageIcon from "@mui/icons-material/esm/Image";
import type { ToolId } from "../../tools/registry";

/** A zigzag spring between two end dots; MUI has no spring glyph. */
const SpringIcon = createSvgIcon(
  <path
    d="M2 12h3l2-5 3 10 3-10 3 10 2-5h4"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinejoin="round"
    strokeLinecap="round"
  />,
  "Spring",
);

/** A block on a hatched guide: the pure prismatic joint. */
const SliderIcon = createSvgIcon(
  <g fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
    <rect x="5" y="5" width="14" height="10" rx="1" />
    <path d="M2 18h20M5 18l-2 4M10 18l-2 4M15 18l-2 4M20 18l-2 4" />
  </g>,
  "Slider",
);

/** A block (square) pinned by a revolute (circle): the slider block as its own body. */
const SliderRevoluteIcon = createSvgIcon(
  <g fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
    <rect x="5" y="3" width="14" height="12" rx="1" />
    <circle cx="12" cy="9" r="3" />
    <path d="M2 18h20M5 18l-2 4M10 18l-2 4M15 18l-2 4M20 18l-2 4" />
  </g>,
  "SliderRevolute",
);

export const TOOL_ICONS: Record<ToolId, ComponentType<SvgIconProps>> = {
  select: NearMeIcon,
  pan: PanToolIcon,
  bar: HorizontalRuleIcon,
  plate: PentagonIcon,
  groundPivot: AnchorIcon,
  pin: RadioButtonUncheckedIcon,
  slider: SliderIcon,
  sliderRevolute: SliderRevoluteIcon,
  spring: SpringIcon,
  motor: AutorenewIcon,
  marker: AddLocationAltIcon,
  vertex: ShapeLineIcon,
  brush: BrushIcon,
  eraser: AutoFixNormalIcon,
  image: ImageIcon,
};
