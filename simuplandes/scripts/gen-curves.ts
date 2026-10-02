/**
 * Node CLI (run with `tsx`, `npm run fixtures:curves`): for every
 * `fixtures/*.gtm.json` (sorted), parses, validates, sweeps (Phase 3
 * `src/kinematics` solver) and writes `fixtures/<stem>.curve.json`.
 *
 * `--check`: regenerate in memory and exit non-zero if any curve file on
 * disk differs (used by humans/CI to detect stale checked-in curves;
 * never writes in this mode).
 */

import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { parseGtmFixture, validateGtmFixture, fixtureHash } from "./gtm/fixture";
import { sweepFixture } from "./gtm/sweep";

const FIXTURES_DIR = join(import.meta.dirname, "..", "fixtures");

function listFixtureFiles(): string[] {
  return readdirSync(FIXTURES_DIR)
    .filter((f) => f.endsWith(".gtm.json"))
    .sort();
}

function serializeCurve(curve: unknown): string {
  return `${JSON.stringify(curve, null, 2)}\n`;
}

function degrees(rad: number): string {
  return ((rad * 180) / Math.PI).toFixed(1);
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
  const rows: string[][] = [["name", "n", "kind", "range (deg)", "solved"]];

  for (const file of files) {
    const path = join(FIXTURES_DIR, file);
    const text = readFileSync(path, "utf8");

    let fx: ReturnType<typeof parseGtmFixture>;
    try {
      fx = parseGtmFixture(text);
    } catch (err) {
      console.error(`${file}: ${(err as Error).message}`);
      failed = true;
      continue;
    }

    const issues = validateGtmFixture(fx);
    if (issues.length > 0) {
      console.error(`${file}: ${issues.length} validation issue(s):`);
      for (const issue of issues) console.error(`  - ${issue.message}`);
      failed = true;
      continue;
    }

    const curve = sweepFixture(fx, {
      fixtureFileName: file,
      fixtureSha256: fixtureHash(text),
    });
    const stem = file.replace(/\.gtm\.json$/, "");
    const curvePath = join(FIXTURES_DIR, `${stem}.curve.json`);
    const serialized = serializeCurve(curve);

    if (checkMode) {
      const existing = readExisting(curvePath);
      if (existing !== serialized) {
        console.error(`${file}: curve file is stale (${curvePath})`);
        failed = true;
      }
    } else {
      writeFileSync(curvePath, serialized, "utf8");
    }

    const firstJointCurve = Object.values(curve.joints)[0];
    const nSolved = firstJointCurve?.filter((p) => p !== null).length ?? 0;
    rows.push([
      fx.name,
      String(fx.graph.nodes.length),
      curve.reachable.kind,
      `${degrees(curve.reachable.thetaMin)}..${degrees(curve.reachable.thetaMax)}`,
      `${nSolved}/${curve.nSamples}`,
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
