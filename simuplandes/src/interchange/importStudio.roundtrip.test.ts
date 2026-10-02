/**
 * The 09-01 studio-path contract: every golden `fixtures/*.graphthe.json`
 * imports through the anchored-pose builder into a document that
 * `createSimSession` classifies `ready` with rank DOF 1, and
 * export(import(x)) matches x's graph and positions within 1e-9 (anchored
 * poses add ~1e-13 of float noise, so not byte-identical).
 */

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { parseGraphtheText, type GraphtheEdge } from "./graphtheSchema";
import { exportGraphthe } from "./graphthe";
import { importGraphthe } from "./importGraphthe";
import { createSimSession } from "../sim/session";

const FIXTURES_DIR = join(import.meta.dirname, "..", "..", "fixtures");
const TOL = 1e-9;

const goldens = readdirSync(FIXTURES_DIR)
  .filter((f) => f.endsWith(".graphthe.json"))
  .sort();

const keyOf = (e: Pick<GraphtheEdge, "source" | "target">): string =>
  `${Math.min(e.source, e.target)}-${Math.max(e.source, e.target)}`;

function near(a: readonly number[], b: readonly number[]): void {
  expect(a).toHaveLength(b.length);
  a.forEach((x, i) => expect(Math.abs(x - b[i])).toBeLessThan(TOL));
}

describe("studio import round trip over the goldens", () => {
  it("covers exactly the 15 goldens", () => {
    expect(goldens).toHaveLength(15);
  });

  for (const file of goldens) {
    it(`${file}: ready, rank DOF 1, re-exports within 1e-9`, () => {
      const env = parseGraphtheText(readFileSync(join(FIXTURES_DIR, file), "utf8"));
      const doc = importGraphthe(env, { anchoredPoses: true });

      const summary = createSimSession(doc).summary;
      expect(summary.status).toBe("ready");
      expect(summary.rankDof).toBe(1);
      expect(summary.drivingMode).toBe("motor");

      const out = exportGraphthe(doc).envelope;
      expect(out.graph.nodes.map((n) => n.id)).toEqual(env.graph.nodes.map((n) => n.id));
      const exported = new Map(out.graph.edges.map((e) => [keyOf(e), e]));
      expect(exported.size).toBe(env.graph.edges.length);
      for (const edge of env.graph.edges) {
        const got = exported.get(keyOf(edge));
        expect(got, keyOf(edge)).toBeDefined();
        near(got!.pos, edge.pos);
        expect(got!.input).toBe(edge.input === true ? true : undefined);
        expect(got!.type).toBe(edge.type);
        if (edge.axis) near(got!.axis!, edge.axis);
        else expect(got!.axis).toBeUndefined();
      }
      expect(out.markers).toHaveLength(env.markers.length);
      env.markers.forEach((m, i) => {
        expect(out.markers[i].link).toBe(m.link);
        near(out.markers[i].pos, m.pos);
      });
    });
  }

  it("leaves the default importGraphthe path on identity poses", () => {
    const env = parseGraphtheText(
      readFileSync(join(FIXTURES_DIR, "fourbar-crank-rocker.graphthe.json"), "utf8"),
    );
    const doc = importGraphthe(env);
    expect(doc.links.every((l) => l.pose.angle === 0 && l.pose.position[0] === 0)).toBe(true);
  });

  it("treats anchoredPoses: false as the default path", () => {
    const env = parseGraphtheText(
      readFileSync(join(FIXTURES_DIR, "fourbar-crank-rocker.graphthe.json"), "utf8"),
    );
    const doc = importGraphthe(env, { anchoredPoses: false });
    expect(doc.links).toHaveLength(4);
  });
});
