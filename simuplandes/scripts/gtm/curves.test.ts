/**
 * Freshness + rigidity proof for the checked-in `fixtures/*.curve.json`
 * files (DMS-03/DMS-06): every curve on disk must be exactly what
 * `sweepFixture` produces right now (so a stale curve fails CI, not just
 * `--check`), and every same-link REVOLUTE joint pair must keep its
 * reference-pose distance to 1e-9 relative across every solved sample
 * (rigidity, by construction) -- a pair involving a prismatic joint is
 * skipped (a slider/block link's revolute and prismatic joints are
 * intentionally coincident at reference, refDist = 0, and rigidity across a
 * sliding joint is not a fixed-distance property; mirrors
 * `validateGtmFixture`'s own coincident-joints exception).
 */

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import {
  parseGtmFixture,
  validateGtmFixture,
  fixtureHash,
  isPrismatic,
  type GtmFixture,
} from "./fixture";
import { sweepFixture, type CurveFile } from "./sweep";

const FIXTURES_DIR = join(import.meta.dirname, "..", "..", "fixtures");

function edgeKey(u: number, v: number): string {
  const lo = Math.min(u, v);
  const hi = Math.max(u, v);
  return `${lo}-${hi}`;
}

function distance(a: readonly [number, number], b: readonly [number, number]): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1]);
}

function linksToEdgeKeys(fx: GtmFixture): Map<number, string[]> {
  const byLink = new Map<number, string[]>();
  for (const node of fx.graph.nodes) byLink.set(node.id, []);
  for (const edge of fx.graph.edges) {
    byLink.get(edge.source)?.push(edgeKey(edge.source, edge.target));
    byLink.get(edge.target)?.push(edgeKey(edge.source, edge.target));
  }
  return byLink;
}

const gtmFiles = readdirSync(FIXTURES_DIR)
  .filter((f) => f.endsWith(".gtm.json"))
  .sort();

// Sweeping all 13 fixtures (some with 300+ solved samples in both
// directions) is the expensive part of this suite, especially under
// coverage instrumentation -- compute each fixture's fresh curve exactly
// ONCE here (module scope, during collection) and reuse it in every test
// below, rather than re-sweeping per assertion.
const SWEEP_TIMEOUT_MS = 60_000;
const freshByFile = new Map<string, { text: string; fx: GtmFixture; fresh: CurveFile }>();
for (const file of gtmFiles) {
  const text = readFileSync(join(FIXTURES_DIR, file), "utf8");
  const fx = parseGtmFixture(text);
  const fresh = sweepFixture(fx, { fixtureFileName: file, fixtureSha256: fixtureHash(text) });
  freshByFile.set(file, { text, fx, fresh });
}

describe("fixtures/*.gtm.json + *.curve.json", () => {
  it("there are exactly 15 fixtures, at least one bounded and one full-rotation", () => {
    expect(gtmFiles).toHaveLength(15);

    const kinds = gtmFiles.map((file) => freshByFile.get(file)?.fresh.reachable.kind);
    expect(kinds).toContain("bounded");
    expect(kinds).toContain("full-rotation");
  });

  it("at least one fixture contains a prismatic edge", () => {
    const hasPrismatic = gtmFiles.some((file) => {
      const cached = freshByFile.get(file);
      if (!cached) return false;
      return cached.fx.graph.edges.some((e) => e.type === "prismatic");
    });
    expect(hasPrismatic).toBe(true);
  });

  for (const file of gtmFiles) {
    describe(file, () => {
      const cached = freshByFile.get(file);
      if (!cached) throw new Error(`missing precomputed sweep for ${file}`);
      const { text, fx, fresh } = cached;
      const stem = file.replace(/\.gtm\.json$/, "");
      const curvePath = join(FIXTURES_DIR, `${stem}.curve.json`);

      it("validates with no issues", () => {
        expect(validateGtmFixture(fx)).toEqual([]);
      });

      it(
        "has a checked-in curve file that is fresh (fixtureSha256 matches, output deep-equals)",
        () => {
          expect(existsSync(curvePath)).toBe(true);
          const checkedIn = JSON.parse(readFileSync(curvePath, "utf8")) as CurveFile;
          expect(checkedIn.fixtureSha256).toBe(fixtureHash(text));
          expect(checkedIn).toEqual(fresh);
        },
        SWEEP_TIMEOUT_MS,
      );

      it("keeps every same-link REVOLUTE joint pair within 1e-9 relative of its reference distance", () => {
        const checkedIn = JSON.parse(readFileSync(curvePath, "utf8")) as CurveFile;
        const byLink = linksToEdgeKeys(fx);
        const refPosByKey = new Map<string, [number, number]>();
        const prismaticByKey = new Set<string>();
        for (const edge of fx.graph.edges) {
          const key = edgeKey(edge.source, edge.target);
          refPosByKey.set(key, edge.pos);
          if (isPrismatic(edge)) prismaticByKey.add(key);
        }

        let pairsChecked = 0;
        for (const keys of byLink.values()) {
          for (let a = 0; a < keys.length; a++) {
            for (let b = a + 1; b < keys.length; b++) {
              if (prismaticByKey.has(keys[a]) || prismaticByKey.has(keys[b])) continue;
              const refA = refPosByKey.get(keys[a]);
              const refB = refPosByKey.get(keys[b]);
              if (!refA || !refB) throw new Error("missing reference position");
              const refDist = distance(refA, refB);
              expect(refDist).toBeGreaterThan(0);

              const curveA = checkedIn.joints[keys[a]];
              const curveB = checkedIn.joints[keys[b]];
              for (let i = 0; i < checkedIn.nSamples; i++) {
                const pa = curveA[i];
                const pb = curveB[i];
                if (!pa || !pb) continue;
                const actual = distance(pa, pb);
                expect(Math.abs(actual - refDist) / refDist).toBeLessThan(1e-9);
              }
              pairsChecked++;
            }
          }
        }
        expect(pairsChecked).toBeGreaterThan(0);
      });
    });
  }
});
