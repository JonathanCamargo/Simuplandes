// @vitest-environment node
/// <reference types="node" />
/**
 * Executable proof of the Phase 5 kinematics import seam: only `src/sim/**`
 * may import `src/kinematics`. Two independent checks:
 * 1. The effective ESLint config for a representative set of non-sim paths
 *    blocks `**\/kinematics` imports, while `src/sim/**` paths do not (and
 *    `src/sim/*.ts` additionally blocks `react`).
 * 2. A belt-and-braces filesystem scan of every `src/**\/*.{ts,tsx}` file
 *    (outside the allowed directories) for a literal `from "…/kinematics…"`
 *    or `import("…/kinematics…")` specifier, so a regression in the lint
 *    config itself can't silently reopen the seam.
 */

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { ESLint } from "eslint";

const PROJECT_ROOT = fileURLToPath(new URL("../..", import.meta.url));

const NON_SIM_PATHS = [
  "src/ui/shell/X.tsx",
  "src/ui/plots/X.tsx",
  "src/canvas/X.ts",
  "src/canvas/layers/X.tsx",
  "src/tools/X.ts",
  "src/tools/react/X.ts",
  "src/uiState/X.ts",
  "src/i18n/X.ts",
  "src/store/X.ts",
  "src/model/X.ts",
  "src/persistence/X.ts",
  "src/app/X.tsx",
  "src/App.tsx",
];

/**
 * The shape of the bits of `ESLint#calculateConfigForFile`'s resolved config
 * this test reads. `calculateConfigForFile` itself returns `Promise<any>`
 * (untyped by `eslint`'s own typings), so every caller casts to this instead
 * of propagating `any`.
 */
interface ResolvedRuleConfig {
  readonly rules?: Record<string, unknown>;
}

async function resolveConfig(eslint: ESLint, path: string): Promise<ResolvedRuleConfig> {
  return (await eslint.calculateConfigForFile(path)) as ResolvedRuleConfig;
}

/** Extracts the `no-restricted-imports` pattern groups from a resolved ESLint config, or `[]` if the rule isn't set. */
function patternGroups(config: ResolvedRuleConfig): string[][] {
  const rule = config.rules?.["no-restricted-imports"];
  if (!Array.isArray(rule)) return [];
  const groups: string[][] = [];
  for (const option of rule.slice(1)) {
    if (
      option &&
      typeof option === "object" &&
      "patterns" in option &&
      Array.isArray((option as { patterns?: unknown }).patterns)
    ) {
      for (const pattern of (option as { patterns: unknown[] }).patterns) {
        if (
          pattern &&
          typeof pattern === "object" &&
          "group" in pattern &&
          Array.isArray((pattern as { group?: unknown }).group)
        ) {
          groups.push((pattern as { group: string[] }).group);
        }
      }
    }
  }
  return groups;
}

function blocksSpecifier(groups: string[][], specifier: string): boolean {
  return groups.some((group) => group.includes(specifier));
}

describe("kinematics import seam (ESLint config)", () => {
  it.each(NON_SIM_PATHS)("blocks **/kinematics for %s", async (path) => {
    const eslint = new ESLint({ cwd: PROJECT_ROOT });
    const config = await resolveConfig(eslint, path);
    const groups = patternGroups(config);
    expect(blocksSpecifier(groups, "**/kinematics"), path).toBe(true);
  });

  it("does not block kinematics for src/sim/X.ts", async () => {
    const eslint = new ESLint({ cwd: PROJECT_ROOT });
    const config = await resolveConfig(eslint, "src/sim/X.ts");
    const groups = patternGroups(config);
    expect(blocksSpecifier(groups, "**/kinematics")).toBe(false);
  });

  it("does not block kinematics for src/sim/react/X.ts", async () => {
    const eslint = new ESLint({ cwd: PROJECT_ROOT });
    const config = await resolveConfig(eslint, "src/sim/react/X.ts");
    const groups = patternGroups(config);
    expect(blocksSpecifier(groups, "**/kinematics")).toBe(false);
  });

  it("blocks react for src/sim/X.ts (pure orchestration)", async () => {
    const eslint = new ESLint({ cwd: PROJECT_ROOT });
    const config = await resolveConfig(eslint, "src/sim/X.ts");
    const groups = patternGroups(config);
    expect(blocksSpecifier(groups, "react")).toBe(true);
  });
});

const ALLOWED_DIR_PREFIXES = ["src/kinematics", "src/sim", "src/legacy"];
const KINEMATICS_IMPORT_PATTERN =
  /\bfrom\s+["'][^"']*\/kinematics(\/[^"']*)?["']|\bimport\(\s*["'][^"']*\/kinematics(\/[^"']*)?["']\s*\)/;

/** Recursively collects every `.ts`/`.tsx` file under `dir`, relative to `PROJECT_ROOT`, skipping `__fixtures__` and the allowed seam directories. */
function collectSourceFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const rel = relative(PROJECT_ROOT, full).split("\\").join("/");
    if (ALLOWED_DIR_PREFIXES.some((prefix) => rel === prefix || rel.startsWith(`${prefix}/`))) {
      continue;
    }
    if (entry === "__fixtures__") continue;
    const stats = statSync(full);
    if (stats.isDirectory()) {
      files.push(...collectSourceFiles(full));
    } else if (/\.(ts|tsx)$/.test(entry)) {
      files.push(full);
    }
  }
  return files;
}

describe("kinematics import seam (filesystem scan)", () => {
  it("no file outside src/kinematics, src/sim or src/legacy imports .../kinematics", () => {
    const srcDir = join(PROJECT_ROOT, "src");
    const offenders: string[] = [];
    for (const file of collectSourceFiles(srcDir)) {
      const contents = readFileSync(file, "utf8");
      if (KINEMATICS_IMPORT_PATTERN.test(contents)) {
        offenders.push(relative(PROJECT_ROOT, file));
      }
    }
    expect(offenders).toEqual([]);
  });
});
