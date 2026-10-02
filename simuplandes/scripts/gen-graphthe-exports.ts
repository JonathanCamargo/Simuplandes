/**
 * Node CLI (run with `tsx`, `npm run fixtures:exports`): for every
 * `fixtures/*.gtm.json` (sorted), parses it through the GraphThe v1
 * reader, imports it headlessly, re-exports it, and writes
 * `fixtures/<stem>.graphthe.json` — the checked-in golden export set
 * (08-01, XCH-04's JS half).
 *
 * `--check`: regenerate in memory and exit non-zero if any golden file on
 * disk is missing or differs (used by humans/CI to detect stale
 * checked-in exports; never writes in this mode).
 */

import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { parseGraphtheText } from "../src/interchange/graphtheSchema";
import { exportGraphthe } from "../src/interchange/graphthe";
import { importGraphthe } from "../src/interchange/importGraphthe";

const FIXTURES_DIR = join(import.meta.dirname, "..", "fixtures");

function listFixtureFiles(): string[] {
  return readdirSync(FIXTURES_DIR)
    .filter((f) => f.endsWith(".gtm.json"))
    .sort();
}

function readExisting(path: string): string | null {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
}

function main(): void {
  const checkMode = process.argv.includes("--check");
  const files = listFixtureFiles();
  let failed = false;
  const rows: string[][] = [["name", "nodes", "edges", "markers", "status"]];

  for (const file of files) {
    const path = join(FIXTURES_DIR, file);
    const text = readFileSync(path, "utf8");

    let serialized: string;
    let envelope: ReturnType<typeof exportGraphthe>["envelope"];
    try {
      const parsed = parseGraphtheText(text);
      const doc = importGraphthe(parsed);
      const result = exportGraphthe(doc);
      envelope = result.envelope;
      serialized = result.text;
    } catch (err) {
      console.error(`${file}: ${(err as Error).message}`);
      failed = true;
      continue;
    }

    const stem = file.replace(/\.gtm\.json$/, "");
    const outPath = join(FIXTURES_DIR, `${stem}.graphthe.json`);
    let status: string;

    if (checkMode) {
      const existing = readExisting(outPath);
      if (existing === null) {
        console.error(`${file}: golden export is MISSING (${outPath})`);
        failed = true;
        status = "missing";
      } else if (existing.replace(/\r\n/g, "\n") !== serialized.replace(/\r\n/g, "\n")) {
        console.error(`${file}: golden export is stale (${outPath})`);
        failed = true;
        status = "stale";
      } else {
        status = "fresh";
      }
    } else {
      writeFileSync(outPath, serialized, "utf8");
      status = "written";
    }

    rows.push([
      envelope.name,
      String(envelope.graph.nodes.length),
      String(envelope.graph.edges.length),
      String(envelope.markers.length),
      status,
    ]);
  }

  const widths = rows[0].map((_, col) => Math.max(...rows.map((r) => r[col].length)));
  for (const row of rows) {
    console.log(row.map((cell, col) => cell.padEnd(widths[col])).join("  "));
  }

  if (failed) {
    process.exitCode = 1;
  }
}

main();
