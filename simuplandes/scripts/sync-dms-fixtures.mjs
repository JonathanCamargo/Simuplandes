#!/usr/bin/env node
/**
 * Copies every `fixtures/*.gtm.json` and `fixtures/*.curve.json` into the
 * dms repo's `tests/fixtures/` (never the reverse), so neither repo needs
 * the other at test time. Plain Node ESM, no dependencies. Not executed by
 * `npm run check` -- invoked manually (or by a later plan) via
 * `npm run fixtures:sync`.
 *
 * Destination resolution order: `--dest <dir>`, else `DMS_REPO` env var +
 * `/tests/fixtures`, else the hardcoded default dev path below. Refuses to
 * run if the destination's repo root (the parent of `tests/`) does not
 * look like the dms repo (missing `src/dms`).
 */

import { readdirSync, copyFileSync, unlinkSync, existsSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC_DIR = join(__dirname, "..", "fixtures");
const DEFAULT_DEST = "C:/git/dynamics_of_mechanical_systems/tests/fixtures";

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
  if (process.env.DMS_REPO) return resolve(process.env.DMS_REPO, "tests", "fixtures");
  return resolve(DEFAULT_DEST);
}

function isFixtureFile(name) {
  return name.endsWith(".gtm.json") || name.endsWith(".curve.json");
}

function main() {
  const destDir = resolveDest(process.argv.slice(2));
  const repoRoot = resolve(destDir, "..", "..");

  if (!existsSync(join(repoRoot, "src", "dms"))) {
    console.error(
      `sync-dms-fixtures: refusing to run -- "${repoRoot}" does not look like the dms repo root (missing src/dms)`,
    );
    process.exitCode = 1;
    return;
  }
  if (!existsSync(destDir)) {
    console.error(`sync-dms-fixtures: destination "${destDir}" does not exist`);
    process.exitCode = 1;
    return;
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

  console.log(`sync-dms-fixtures: ${copied} copied, ${deleted} deleted, dest="${destDir}"`);
}

main();
