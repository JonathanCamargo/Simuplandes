/**
 * Cross-validates the 06-08 gap-closure minimum-separation property against
 * real, drawn `MechanismDocument` fixtures (not `documentFromEdges`
 * abstractions): the Watt II / Stephenson III six-bars built by
 * `src/kinematics/__fixtures__/sixBars`. Lives in `src/sim/` (not
 * `src/graph/`) because this is the one place the ESLint seam allows
 * importing both `../graph` and kinematics fixtures -- `src/graph/**` must
 * never import `src/kinematics` (see `mobility.ts`'s own doc comment).
 */

import { describe, expect, it } from "vitest";
import { buildStephensonIII, buildWattII } from "../kinematics/__fixtures__/sixBars";
import { fromDocument, layoutGraph, MIN_NODE_SEPARATION, type GraphLayoutKind } from "../graph";

const KINDS: GraphLayoutKind[] = ["spatial", "circular", "layered"];
const MARGIN = 0.08;

describe("layoutGraph: real drawn six-bar fixtures never overlap their footprints", () => {
  for (const [name, build] of [
    ["Stephenson III", buildStephensonIII],
    ["Watt II", buildWattII],
  ] as const) {
    for (const kind of KINDS) {
      it(`${name} (drawn) / ${kind}: every pairwise distance >= MIN_NODE_SEPARATION, every position in-box`, () => {
        const { doc } = build();
        const graph = fromDocument(doc);
        const map = layoutGraph(graph, kind);

        const points = Array.from(map.values());
        for (let i = 0; i < points.length; i += 1) {
          expect(points[i].x).toBeGreaterThanOrEqual(MARGIN - 1e-9);
          expect(points[i].x).toBeLessThanOrEqual(1 - MARGIN + 1e-9);
          expect(points[i].y).toBeGreaterThanOrEqual(MARGIN - 1e-9);
          expect(points[i].y).toBeLessThanOrEqual(1 - MARGIN + 1e-9);
          for (let j = i + 1; j < points.length; j += 1) {
            const dist = Math.hypot(points[i].x - points[j].x, points[i].y - points[j].y);
            expect(dist).toBeGreaterThanOrEqual(MIN_NODE_SEPARATION - 1e-9);
          }
        }
      });
    }
  }
});
