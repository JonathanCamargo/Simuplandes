/**
 * Cross-checks `src/graph`'s independently-recomputed Gruebler F against
 * `src/kinematics`'s own (`computeDofReport`/`analyzeMobility`), on every
 * shared kinematics fixture. Lives in `src/sim/` (not `src/graph/`) because
 * this is the one place the ESLint seam allows importing BOTH `../graph`
 * and `../kinematics` -- `src/graph/**` itself must never import
 * `src/kinematics` (see `mobility.ts`'s own doc comment).
 */

import { describe, expect, it } from "vitest";
import * as fourBar from "../kinematics/__fixtures__/fourBar";
import * as sliderCrank from "../kinematics/__fixtures__/sliderCrank";
import * as invertedSliderCrank from "../kinematics/__fixtures__/invertedSliderCrank";
import * as doubleParallelogram from "../kinematics/__fixtures__/doubleParallelogram";
import * as nonGrashofFourBar from "../kinematics/__fixtures__/nonGrashofFourBar";
import * as sixBars from "../kinematics/__fixtures__/sixBars";
import * as tenBar from "../kinematics/__fixtures__/tenBar";
import * as misassembled from "../kinematics/__fixtures__/misassembled";
import type { MechanismDocument } from "../model";
import { fromDocument, graphMobility, linkAssortment, baranovCheck } from "../graph";
import { computeDofReport } from "./dof";

interface NamedDoc {
  name: string;
  doc: MechanismDocument;
}

const wattII = sixBars.buildWattII();
const stephensonIII = sixBars.buildStephensonIII();

const fixtures: NamedDoc[] = [
  { name: "fourBar", doc: fourBar.build() },
  { name: "sliderCrank", doc: sliderCrank.build() },
  { name: "invertedSliderCrank", doc: invertedSliderCrank.build() },
  { name: "doubleParallelogram", doc: doubleParallelogram.build() },
  { name: "nonGrashofFourBar", doc: nonGrashofFourBar.build() },
  { name: "sixBars.wattII", doc: wattII.doc },
  { name: "sixBars.stephensonIII", doc: stephensonIII.doc },
  { name: "tenBar", doc: tenBar.build().doc },
  { name: "misassembled.groundPairViolation", doc: misassembled.groundPairViolation() },
  {
    // A four-bar plus one redundant bar across two opposite pivots: 5 links,
    // 6 joints -> Gruebler F = 0 (same redundant-topology shape as
    // `src/graph/mobility.test.ts`'s own fixture, built here from a real
    // MechanismDocument instead of `documentFromEdges`).
    name: "fourBarPlusRedundantBar",
    doc: (() => {
      const base = fourBar.build();
      // Reuses the existing ground/crank/rocker geometry: adds a fifth,
      // independent link rigidly bracing the ground pivot to the coupler-
      // rocker pivot (redundant with the existing four-bar loop).
      const groundSite = base.links[0].sites[0]; // O2
      const rockerSite = base.links[3].sites[1]; // B (on rocker)
      const braceId = "brace-link";
      const brace: MechanismDocument["links"][number] = {
        id: braceId,
        name: "brace",
        isGround: false,
        pose: { position: [0, 0], angle: 0 },
        shape: { kind: "bar" },
        sites: [
          { id: "brace-site-1", name: "", local: [0, 0] },
          { id: "brace-site-2", name: "", local: [140, 80] },
        ],
      };
      return {
        ...base,
        links: [...base.links, brace],
        joints: [
          ...base.joints,
          {
            id: "brace-joint-1",
            name: "",
            type: "R" as const,
            siteA: groundSite.id,
            siteB: "brace-site-1",
          },
          {
            id: "brace-joint-2",
            name: "",
            type: "R" as const,
            siteA: "brace-site-2",
            siteB: rockerSite.id,
          },
        ],
      };
    })(),
  },
];

describe("graph vs kinematics Gruebler parity", () => {
  for (const { name, doc } of fixtures) {
    it(`${name}: graph Gruebler matches computeDofReport`, () => {
      const report = computeDofReport(doc);
      const mobility = graphMobility(fromDocument(doc));

      if (report.kind === "invalid" || report.kind === "empty") {
        // Explicitly documented instead of silently skipped: an
        // uncompilable or link-less document has no Gruebler F on either
        // side.
        expect(mobility.gruebler, `${name}: ${report.kind}`).toBeNull();
        return;
      }

      expect(mobility.gruebler, name).toBe(report.gruebler);
      expect(mobility.n, name).toBe(report.linkCount);
      expect(mobility.j, name).toBe(report.jointCount);
    });
  }

  it("Watt II and Stephenson III drawn six-bars pass Baranov and classify like the atlas ones", () => {
    for (const { doc } of [wattII, stephensonIII]) {
      const g = fromDocument(doc);
      expect(baranovCheck(g)).toEqual({ status: "pass" });
      expect(linkAssortment(g)).toEqual({ n2: 4, n3: 2, n4: 0, n5: 0, other: 0 });
    }
  });
});
