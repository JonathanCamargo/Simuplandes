/**
 * Canvas color tokens aligned with the robiolab website theme
 * (`robiolab_theme/src/globalStyles/theme.css`): navy `#142430` ink / dark
 * background, `#F2F2F2` tertiary / `#FFFFFF` card surfaces, `#555555` /
 * `#CCCCCC` subtext, and the site's salmon `#EE826D` as the accent. The
 * salmon is only 2.3:1 on white, so light mode uses a darkened `#C4503A`
 * (4.6:1). Plus the GraphThe link-type palette. Pure data, no MUI/React dependency --
 * `studioTheme.ts` builds the MUI theme from these, and canvas layers (which
 * need concrete `fill`/`stroke` strings, not CSS variables) read them
 * directly via `canvasTokensFor(mode)`.
 */

import type { ThemeMode } from "../../uiState/preferences";

export interface CanvasTokens {
  paper: string;
  panel: string;
  panel2: string;
  ink: string;
  muted: string;
  line: string;
  grid: string;
  gridMajor: string;
  accent: string;
  accentSoft: string;
  ok: string;
  warn: string;
  err: string;
  pin: string;
  /** The stroke every link body draws in addition to its type fill (WCAG 1.4.11 -- see `contrast.test.ts`). */
  linkOutline: string;
  /** The active-selection accent (same value as `accent`). */
  selection: string;
  /** GRF-02: the shared canvas/graph-panel hover halo/outline color. Distinct from `selection`/`issue`. */
  hover: string;
  /** GRF-03: the Baranov-offending-link outline color. Meets WCAG 1.4.11 (>=3:1) against `paper`/`panel` in both themes. */
  issue: string;
}

export const CANVAS_TOKENS: Record<ThemeMode, CanvasTokens> = {
  light: {
    paper: "#F2F2F2",
    panel: "#FFFFFF",
    panel2: "#E8EAEC",
    ink: "#142430",
    muted: "#555555",
    line: "#D5D9DD",
    grid: "#E4E6E8",
    gridMajor: "#CDD1D5",
    accent: "#C4503A",
    accentSoft: "rgba(196,80,58,.12)",
    ok: "#2E7D4F",
    warn: "#9A6412",
    err: "#B3261E",
    pin: "#FFFFFF",
    linkOutline: "#142430",
    selection: "#C4503A",
    hover: "#1967D2",
    issue: "#C62828",
  },
  dark: {
    paper: "#142430",
    panel: "#1A2E3D",
    panel2: "#213847",
    ink: "#FFFFFF",
    muted: "#CCCCCC",
    line: "#2C4354",
    grid: "#1A2C39",
    gridMajor: "#253C4C",
    accent: "#EE826D",
    accentSoft: "rgba(238,130,109,.16)",
    ok: "#5CC08A",
    warn: "#E3AE55",
    err: "#F0766B",
    pin: "#142430",
    linkOutline: "#FFFFFF",
    selection: "#EE826D",
    hover: "#8AB4F8",
    issue: "#EF5350",
  },
};

/**
 * GraphThe's link-type palette (`graphthe/visualization/animation.py`),
 * identical in both themes so the canvas-legend-to-graph-panel color
 * mapping reads at a glance regardless of theme (per `research/UX.md`).
 */
export const LINK_TYPE_COLORS = {
  ground: "#555555",
  binary: "#4285F4",
  ternary: "#34A853",
  quaternary: "#FBBC04",
  pentary: "#EA4335",
} as const;

export type LinkType = keyof typeof LINK_TYPE_COLORS;
