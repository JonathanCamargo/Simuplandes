import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { playwright } from "@vitest/browser-playwright";

export default defineConfig({
  plugins: [react()],
  optimizeDeps: { entries: ["index.html"] }, // never let the dep scanner crawl src/legacy/test.html
  test: {
    // Coverage stays at the root (thresholds below apply across every
    // project). `projects` splits the plain node/jsdom suite from the
    // real-Konva chromium suite (04-02 decision 2).
    projects: [
      {
        extends: true,
        test: {
          name: "unit",
          environment: "node", // DOM tests opt in per file with `// @vitest-environment jsdom`
          include: ["src/**/*.test.{ts,tsx}", "scripts/**/*.test.ts"],
          exclude: ["src/legacy/**", "node_modules/**", "src/**/*.chromium.test.{ts,tsx}"],
        },
      },
      {
        extends: true,
        test: {
          name: "browser",
          include: ["src/**/*.chromium.test.{ts,tsx}"],
          // Vitest's default browser API port (63315) can fall inside a
          // Windows/Hyper-V dynamic port exclusion (e.g. 63248-63347), which
          // makes the browser project fail with EACCES. Pin one outside it.
          api: { port: 51730 },
          browser: {
            enabled: true,
            provider: playwright(),
            headless: true,
            instances: [{ browser: "chromium" }],
          },
        },
      },
    ],
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "lcov"],
      include: ["src/**/*.{ts,tsx}"],
      exclude: [
        "src/legacy/**",
        "src/**/*.test.{ts,tsx}",
        "src/main.tsx",
        "src/**/*.d.ts",
        "src/**/__fixtures__/**",
        "src/test/**",
      ],
      // Phase 4 glob conventions (keep disjoint -- vitest applies EVERY glob a
      // file matches, so a file must match exactly one threshold bucket):
      // - pure `.ts` logic modules under `src/ui` live ONLY in `theme/`,
      //   `inspector/` (the `*.ts` files) or `palette/` (the `*.ts` files);
      // - React hooks live in `src/ui/shell/*.ts`, in `src/tools/react/`, or
      //   in a `.tsx` file under `src/ui/**`;
      // - `src/canvas` holds only pure `.ts` files (viewport/snapping/etc.)
      //   and Konva glue `.tsx` files -- no plain glue `.ts` files there.
      // Phase 5 glob conventions:
      // - `src/sim/*.ts` = pure orchestration (kinematics allowed, no React)
      // - `src/sim/react/` = React/rAF glue
      thresholds: {
        "src/geom/**": { statements: 100, branches: 100, functions: 100, lines: 100 },
        "src/model/**": { statements: 95, branches: 90, functions: 95, lines: 95 },
        "src/store/**": { statements: 95, branches: 90, functions: 95, lines: 95 },
        "src/persistence/**": { statements: 95, branches: 90, functions: 95, lines: 95 },
        "src/kinematics/**": { statements: 95, branches: 90, functions: 95, lines: 95 },
        // Phase 4 pure-logic globs (statements/branches/functions/lines).
        "src/tools/*.ts": { statements: 95, branches: 90, functions: 95, lines: 95 },
        "src/canvas/*.ts": { statements: 95, branches: 90, functions: 95, lines: 95 },
        "src/i18n/**": { statements: 95, branches: 90, functions: 95, lines: 95 },
        "src/uiState/**": { statements: 95, branches: 90, functions: 95, lines: 95 },
        "src/ui/theme/**": { statements: 95, branches: 90, functions: 95, lines: 95 },
        "src/ui/inspector/*.ts": { statements: 95, branches: 90, functions: 95, lines: 95 },
        "src/ui/palette/*.ts": { statements: 95, branches: 90, functions: 95, lines: 95 },
        // MUI glue, covered by RTL component tests.
        "src/ui/**/*.tsx": { statements: 80, branches: 70, functions: 75, lines: 80 },
        "src/ui/shell/*.ts": { statements: 80, branches: 70, functions: 75, lines: 80 },
        // React glue hooks.
        "src/tools/react/**": { statements: 80, branches: 70, functions: 75, lines: 80 },
        // Konva glue, covered by the chromium browser project added in 04-02.
        "src/canvas/**/*.tsx": { statements: 70, branches: 60, functions: 65, lines: 70 },
        // Phase 5: pure sim orchestration vs. React/rAF glue vs. plot components.
        "src/sim/*.ts": { statements: 95, branches: 90, functions: 95, lines: 95 },
        "src/sim/react/**": { statements: 80, branches: 70, functions: 75, lines: 80 },
        "src/ui/plots/**": { statements: 80, branches: 70, functions: 75, lines: 80 },
        // Phase 6: pure graph analysis
        "src/graph/**": { statements: 95, branches: 90, functions: 95, lines: 95 },
      },
    },
  },
});
