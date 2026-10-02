#!/usr/bin/env node
/**
 * Copies every `fixtures/*.gtm.json` and `fixtures/*.graphthe.json` (NOT
 * `.curve.json` — that is dms's parity sync's business) into the GraphThe
 * repo's `tests/fixtures/` (never the reverse), so the Python contract
 * tests (08-02/08-06) read the same golden set the JS round-trip test
 * uses. Plain Node ESM, no dependencies. Not executed by `npm run check`
 * -- invoked manually (or by 08-06) via `npm run fixtures:sync:graphthe`.
 *
 * Destination resolution order: `--dest <dir>`, else `GRAPHTHE_REPO` env
 * var + `/tests/fixtures`, else the hardcoded default dev path below.
 * Refuses to run if the destination's repo root does not look like the
 * GraphThe repo (missing `graphthe/` and `pyproject.toml`). Creates the
 * destination directory if missing (GraphThe has no `tests/fixtures`
 * yet); deletes stale synced files of the two suffixes only.
 */

import { readdirSync, copyFileSync, unlinkSync, existsSync, mkdirSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC_DIR = join(__dirname, "..", "fixtures");
const DEFAULT_DEST = "C:/git/New folder/GraphThe-main/tests/fixtures";

function parseArgs(argv) {
  let dest = null;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--dest" && argv[i + 1] !== undefined) {
      dest = argv[i + 1];
      i++;
    }
  }
  return { dest };
}

function resolveDest(argv) {
  const { dest } = parseArgs(argv);
  if (dest) return resolve(dest);
  if (process.env.GRAPHTHE_REPO) return resolve(process.env.GRAPHTHE_REPO, "tests", "fixtures");
  return resolve(DEFAULT_DEST);
}

function isFixtureFile(name) {
  return name.endsWith(".gtm.json") || name.endsWith(".graphthe.json");
}

function main() {
  const destDir = resolveDest(process.argv.slice(2));
  const repoRoot = resolve(destDir, "..", "..");

  if (!existsSync(join(repoRoot, "graphthe")) || !existsSync(join(repoRoot, "pyproject.toml"))) {
    console.error(
      `sync-graphthe-fixtures: refusing to run -- "${repoRoot}" does not look like the GraphThe repo root (missing graphthe/ or pyproject.toml)`,
    );
    process.exitCode = 1;
    return;
  }
  if (!existsSync(destDir)) {
    mkdirSync(destDir, { recursive: true });
    console.log(`created ${destDir}`);
  }

  const srcFiles = new Set(readdirSync(SRC_DIR).filter(isFixtureFile));
  const destFiles = readdirSync(destDir).filter(isFixtureFile);

  let copied = 0;
  for (const file of srcFiles) {
    copyFileSync(join(SRC_DIR, file), join(destDir, file));
    console.log(`copied ${file}`);
    copied++;
  }

  let deleted = 0;
  for (const file of destFiles) {
    if (!srcFiles.has(file)) {
      unlinkSync(join(destDir, file));
      console.log(`deleted ${file} (no longer in source)`);
      deleted++;
    }
  }

  console.log(`sync-graphthe-fixtures: ${copied} copied, ${deleted} deleted, dest="${destDir}"`);
}

main();
