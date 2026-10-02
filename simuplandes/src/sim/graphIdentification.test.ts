/**
 * Cross-validates GRF-03/GRF-04 against real, drawn `MechanismDocument`
 * fixtures (not `documentFromEdges` abstractions): the Watt II / Stephenson
 * III six-bars, the four-bar family, and the ten-bar synthetic mechanism,
 * all built by `src/kinematics/__fixtures__`. Lives in `src/sim/` (not
 * `src/graph/`) because this is the one place the ESLint seam allows
 * importing both `../graph` and kinematics fixtures -- `src/graph/**` must
 * never import `src/kinematics` (see `mobility.ts`'s own doc comment), and
 * this file is exactly SC-3/SC-4's "logic level, on real drawn fixtures"
 * proof the plan requires.
 */

import { describe, expect, it } from "vitest";
import * as sixBars from "../kinematics/__fixtures__/sixBars";
import * as fourBar from "../kinematics/__fixtures__/fourBar";
import * as sliderCrank from "../kinematics/__fixtures__/sliderCrank";
import * as nonGrashofFourBar from "../kinematics/__fixtures__/nonGrashofFourBar";
import * as tenBar from "../kinematics/__fixtures__/tenBar";
import * as doubleParallelogram from "../kinematics/__fixtures__/doubleParallelogram";
import { analyzeDocument, atlasSizes } from "../graph";

describe("graph identification on real drawn kinematics fixtures", () => {
  it("Stephenson III (drawn) identifies as the Stephenson chain", () => {
    const { doc } = sixBars.buildStephensonIII();
    const analysis = analyzeDocument(doc);
    expect(analysis.topology).toMatchObject({ kind: "atlas", id: "T6B_S", name: "stephenson" });
    expect(analysis.mobility.gruebler).toBe(1);
    expect(analysis.baranov).toEqual({ status: "pass" });
  });

  it("Watt II (drawn) identifies as the Watt chain", () => {
    const { doc } = sixBars.buildWattII();
    const analysis = analyzeDocument(doc);
    expect(analysis.topology).toMatchObject({ kind: "atlas", id: "T6B_W", name: "watt" });
    expect(analysis.mobility.gruebler).toBe(1);
    expect(analysis.baranov).toEqual({ status: "pass" });
  });

  it("four-bar, slider-crank and non-Grashof four-bar all identify as fourBar", () => {
    for (const doc of [fourBar.build(), sliderCrank.build(), nonGrashofFourBar.build()]) {
      const analysis = analyzeDocument(doc);
      expect(analysis.topology).toEqual({ kind: "fourBar" });
    }
  });

  it("ten-bar: an atlas match if a 10-bar atlas is bundled, else a reasoned noAtlasForSize -- Baranov pass and Gruebler 1 either way", () => {
    const { doc } = tenBar.build();
    const analysis = analyzeDocument(doc);

    if (atlasSizes().includes(10)) {
      expect(analysis.topology).toMatchObject({ kind: "atlas", nLinks: 10 });
    } else {
      expect(analysis.topology).toEqual({ kind: "none", reason: "noAtlasForSize" });
    }
    expect(analysis.baranov).toEqual({ status: "pass" });
    expect(analysis.mobility.gruebler).toBe(1);
  });

  it("double parallelogram: Gruebler F = 0 (structurally redundant, kinematically mobile), Baranov pass, no atlas for its 5-link size", () => {
    const analysis = analyzeDocument(doubleParallelogram.build());
    expect(analysis.mobility).toEqual({ n: 5, j: 6, gruebler: 0 });
    expect(analysis.assortment).toEqual({ n2: 3, n3: 2, n4: 0, n5: 0, other: 0 });
    expect(analysis.baranov).toEqual({ status: "pass" });
    expect(analysis.topology).toEqual({ kind: "none", reason: "noAtlasForSize" });
  });
});
