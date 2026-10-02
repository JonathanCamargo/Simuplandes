import { defineConfig } from "eslint/config";
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import globals from "globals";
import eslintConfigPrettier from "eslint-config-prettier";

export default defineConfig([
  {
    ignores: [
      "dist/**",
      "coverage/**",
      "node_modules/**",
      "src/legacy/**",
      "test-results/**",
      "playwright-report/**",
      "blob-report/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked.map((config) => ({
    ...config,
    files: ["**/*.{ts,tsx}"],
  })),
  {
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
      globals: globals.browser,
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      ...reactHooks.configs.flat.recommended.rules,
      "react-refresh/only-export-components": ["warn", { allowConstantExport: true }],
    },
  },
  {
    files: ["**/*.{js,mjs}"],
    languageOptions: {
      globals: globals.node,
    },
  },
  {
    files: ["src/kinematics/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: [
                "react",
                "react-*",
                "react/*",
                "zustand",
                "zustand/*",
                "immer",
                "konva",
                "react-konva",
                "matter-js",
                "@mui/*",
                "@emotion/*",
                "browser-fs-access",
                "../store",
                "../store/*",
                "../app",
                "../app/*",
                "../persistence",
                "../persistence/*",
                "../legacy",
                "../legacy/*",
                "../../store",
                "../../store/*",
                "../../app",
                "../../app/*",
                "../../persistence",
                "../../persistence/*",
                "../../legacy/*",
              ],
              message: "src/kinematics must stay pure: import only ../geom and ../model.",
            },
          ],
        },
      ],
      "no-restricted-globals": [
        "error",
        "window",
        "document",
        "localStorage",
        "sessionStorage",
        "navigator",
      ],
    },
  },
  {
    // Seam rule (decision 9, widened Phase 5): only src/sim/** may import
    // src/kinematics. UI/canvas/tools receive poses/readouts from src/sim.
    files: ["src/**/*.{ts,tsx}"],
    ignores: ["src/kinematics/**", "src/sim/**", "src/legacy/**"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["**/kinematics", "**/kinematics/*", "**/kinematics/**"],
              message:
                "Only src/sim/** may import src/kinematics (Phase 5 seam). UI/canvas/tools receive poses/readouts from src/sim.",
            },
          ],
        },
      ],
    },
  },
  {
    // Purity rule: these globs hold pure logic only -- no React/Konva/MUI.
    // zustand/vanilla and immer stay allowed (the store-building primitives).
    files: [
      "src/tools/*.ts",
      "src/canvas/*.ts",
      "src/uiState/*.ts",
      "src/graph/**/*.ts",
      "src/interchange/**/*.ts",
    ],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: [
                "react",
                "react-*",
                "react/*",
                "konva",
                "react-konva",
                "@mui/*",
                "@emotion/*",
                "matter-js",
                "**/kinematics",
                "**/kinematics/*",
              ],
              message: "pure logic: no React/Konva/MUI",
            },
          ],
        },
      ],
    },
  },
  {
    // src/sim/*.ts is pure orchestration: kinematics is allowed here (the
    // Phase 5 seam), but React/Konva/MUI glue belongs in src/sim/react/.
    files: ["src/sim/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: [
                "react",
                "react-*",
                "react/*",
                "konva",
                "react-konva",
                "@mui/*",
                "@emotion/*",
                "matter-js",
              ],
              message:
                "src/sim/*.ts is pure orchestration: no React/Konva/MUI (put glue in src/sim/react/)",
            },
          ],
        },
      ],
    },
  },
  {
    // No negative Konva scale (decision 7): never mirror a Konva node; the
    // y-flip happens once in canvas/viewport.ts's worldToScreen.
    files: ["src/**/*.tsx"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector:
            "JSXAttribute[name.name=/^scale[XY]$/] JSXExpressionContainer > UnaryExpression[operator='-']",
          message: "Never mirror Konva nodes; flip y once in canvas/viewport.ts worldToScreen",
        },
      ],
    },
  },
  eslintConfigPrettier,
]);
