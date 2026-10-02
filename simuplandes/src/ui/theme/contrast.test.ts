import { describe, it, expect } from "vitest";
import { relativeLuminance, contrastRatio } from "./contrast";
import { CANVAS_TOKENS, LINK_TYPE_COLORS, type LinkType } from "./tokens";
import type { ThemeMode } from "../../uiState/preferences";

describe("relativeLuminance/contrastRatio", () => {
  it("contrastRatio(white, black) is ~21", () => {
    expect(contrastRatio("#FFFFFF", "#000000")).toBeCloseTo(21, 0);
  });

  it("contrastRatio(x, x) is 1", () => {
    expect(contrastRatio("#4285F4", "#4285F4")).toBe(1);
  });

  it("is order-independent", () => {
    expect(contrastRatio("#FFFFFF", "#4285F4")).toBeCloseTo(
      contrastRatio("#4285F4", "#FFFFFF"),
      10,
    );
  });

  it("relativeLuminance(#FFFFFF) is 1 and relativeLuminance(#000000) is 0", () => {
    expect(relativeLuminance("#FFFFFF")).toBeCloseTo(1, 10);
    expect(relativeLuminance("#000000")).toBeCloseTo(0, 10);
  });

  it("throws for a non-#RRGGBB input", () => {
    expect(() => relativeLuminance("blue")).toThrow();
    expect(() => relativeLuminance("#fff")).toThrow();
    expect(() => contrastRatio("#GGGGGG", "#000000")).toThrow();
  });
});

const MODES: readonly ThemeMode[] = ["light", "dark"];
const BACKGROUNDS = ["paper", "panel"] as const;

describe("LINK_TYPE_COLORS", () => {
  it("is identical for light and dark and matches the approved prototype PAL exactly", () => {
    expect(LINK_TYPE_COLORS).toEqual({
      ground: "#555555",
      binary: "#4285F4",
      ternary: "#34A853",
      quaternary: "#FBBC04",
      pentary: "#EA4335",
    });
  });
});

describe("WCAG 1.4.11 contrast contract", () => {
  // Computed while planning (see 04-01-PLAN.md): several link-type fills fall
  // below 3:1 on their own against at least one theme background. The
  // rendering contract (enforced by 04-02) is that every link body is drawn
  // as the fill PLUS a `linkOutline` stroke, and the outline alone clears
  // 3:1 against every background in both themes -- so WCAG 1.4.11 is met via
  // the outline even where the fill isn't sufficient alone.
  const EXPECTED_LOW_CONTRAST_FILLS: Record<ThemeMode, readonly LinkType[]> = {
    light: ["ternary", "quaternary"],
    dark: ["ground"],
  };

  it("prints a markdown ratio table for the SUMMARY", () => {
    const rows: string[] = [
      "| theme | background | swatch | fill ratio | outline ratio |",
      "|---|---|---|---|---|",
    ];
    for (const mode of MODES) {
      const tokens = CANVAS_TOKENS[mode];
      for (const bg of BACKGROUNDS) {
        const bgColor = tokens[bg];
        for (const [name, fill] of Object.entries(LINK_TYPE_COLORS)) {
          const fillRatio = contrastRatio(fill, bgColor);
          const outlineRatio = contrastRatio(tokens.linkOutline, bgColor);
          rows.push(
            `| ${mode} | ${bg} | ${name} | ${fillRatio.toFixed(3)} | ${outlineRatio.toFixed(3)} |`,
          );
        }
      }
    }
    console.info(rows.join("\n"));
    expect(rows.length).toBeGreaterThan(1);
  });

  it.each(MODES)("linkOutline clears 3:1 against paper and panel in %s mode", (mode) => {
    const tokens = CANVAS_TOKENS[mode];
    for (const bg of BACKGROUNDS) {
      expect(contrastRatio(tokens.linkOutline, tokens[bg])).toBeGreaterThanOrEqual(3);
    }
  });

  it.each(MODES)(
    "every link-type colour clears 3:1 via fill-or-outline against paper and panel in %s mode",
    (mode) => {
      const tokens = CANVAS_TOKENS[mode];
      for (const bg of BACKGROUNDS) {
        for (const fill of Object.values(LINK_TYPE_COLORS)) {
          const best = Math.max(
            contrastRatio(fill, tokens[bg]),
            contrastRatio(tokens.linkOutline, tokens[bg]),
          );
          expect(best).toBeGreaterThanOrEqual(3);
        }
      }
    },
  );

  it.each(MODES)("pins the exact set of fills below 3:1 on their own in %s mode", (mode) => {
    const tokens = CANVAS_TOKENS[mode];
    const belowThreshold = (Object.entries(LINK_TYPE_COLORS) as [LinkType, string][]).filter(
      ([, fill]) => BACKGROUNDS.some((bg) => contrastRatio(fill, tokens[bg]) < 3),
    );
    expect(belowThreshold.map(([name]) => name).sort()).toEqual(
      [...EXPECTED_LOW_CONTRAST_FILLS[mode]].sort(),
    );
  });
});
