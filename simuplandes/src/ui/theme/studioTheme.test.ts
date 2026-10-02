import { describe, it, expect } from "vitest";
import { createStudioTheme, canvasTokensFor } from "./studioTheme";
import { CANVAS_TOKENS } from "./tokens";

describe("canvasTokensFor", () => {
  it("returns CANVAS_TOKENS.light for light mode", () => {
    expect(canvasTokensFor("light")).toBe(CANVAS_TOKENS.light);
  });

  it("returns CANVAS_TOKENS.dark for dark mode", () => {
    expect(canvasTokensFor("dark")).toBe(CANVAS_TOKENS.dark);
  });
});

describe("createStudioTheme", () => {
  it("dark/en: sets palette.mode and background.default to the dark paper token", () => {
    const theme = createStudioTheme("dark", "en");
    expect(theme.palette.mode).toBe("dark");
    expect(theme.palette.background.default).toBe(CANVAS_TOKENS.dark.paper);
    expect(theme.palette.background.paper).toBe(CANVAS_TOKENS.dark.panel);
  });

  it("light/es: sets palette.mode and background.default to the light paper token", () => {
    const theme = createStudioTheme("light", "es");
    expect(theme.palette.mode).toBe("light");
    expect(theme.palette.background.default).toBe(CANVAS_TOKENS.light.paper);
    expect(theme.palette.background.paper).toBe(CANVAS_TOKENS.light.panel);
  });

  it("maps text/primary/divider/semantic colors from the tokens for each mode", () => {
    for (const mode of ["light", "dark"] as const) {
      const theme = createStudioTheme(mode, "en");
      const tokens = CANVAS_TOKENS[mode];
      expect(theme.palette.text.primary).toBe(tokens.ink);
      expect(theme.palette.text.secondary).toBe(tokens.muted);
      expect(theme.palette.primary.main).toBe(tokens.accent);
      expect(theme.palette.divider).toBe(tokens.line);
      expect(theme.palette.success.main).toBe(tokens.ok);
      expect(theme.palette.warning.main).toBe(tokens.warn);
      expect(theme.palette.error.main).toBe(tokens.err);
    }
  });

  it("uses the robiolab website's Roboto body stack", () => {
    const theme = createStudioTheme("light", "en");
    expect(theme.typography.fontFamily).toBe('"Roboto",Arial,sans-serif');
  });

  it("applies tabular-nums to MuiCssBaseline body and MuiInputBase root", () => {
    const theme = createStudioTheme("light", "en");
    expect(theme.components?.MuiCssBaseline?.styleOverrides).toMatchObject({
      body: { fontVariantNumeric: "tabular-nums" },
    });
    expect(theme.components?.MuiInputBase?.styleOverrides).toMatchObject({
      root: { fontVariantNumeric: "tabular-nums" },
    });
  });

  it("merges the esES locale for lang='es'", () => {
    const theme = createStudioTheme("light", "es");
    expect(
      (theme.components as Record<string, { defaultProps?: { labelRowsPerPage?: string } }>)
        .MuiTablePagination?.defaultProps?.labelRowsPerPage,
    ).toBe("Filas por página:");
  });

  it("does not apply the Spanish table-pagination label for lang='en'", () => {
    const theme = createStudioTheme("light", "en");
    expect(
      (theme.components as Record<string, { defaultProps?: { labelRowsPerPage?: string } }>)
        .MuiTablePagination?.defaultProps?.labelRowsPerPage,
    ).toBeUndefined();
  });
});
