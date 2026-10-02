import { describe, it, expect } from "vitest";
import { contrastRatio } from "./contrast";
import { CANVAS_TOKENS } from "./tokens";
import type { ThemeMode } from "../../uiState/preferences";

const MODES: readonly ThemeMode[] = ["light", "dark"];
const BACKGROUNDS = ["paper", "panel"] as const;

describe("CanvasTokens: hover/issue (GRF-02/GRF-03)", () => {
  it.each(MODES)("hover and issue exist and are distinct hex colors in %s mode", (mode) => {
    const tokens = CANVAS_TOKENS[mode];
    expect(tokens.hover).toMatch(/^#([0-9a-fA-F]{6})$/);
    expect(tokens.issue).toMatch(/^#([0-9a-fA-F]{6})$/);
  });

  it.each(MODES)("issue meets WCAG 1.4.11 (>=3:1) against paper and panel in %s mode", (mode) => {
    const tokens = CANVAS_TOKENS[mode];
    for (const bg of BACKGROUNDS) {
      expect(contrastRatio(tokens.issue, tokens[bg])).toBeGreaterThanOrEqual(3);
    }
  });

  it.each(MODES)("issue differs from selection and hover in %s mode", (mode) => {
    const tokens = CANVAS_TOKENS[mode];
    expect(tokens.issue).not.toBe(tokens.selection);
    expect(tokens.issue).not.toBe(tokens.hover);
    expect(tokens.hover).not.toBe(tokens.selection);
  });
});
