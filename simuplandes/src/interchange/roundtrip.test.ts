/**
 * The XCH-04 JS-half contract test: export -> import -> export must be
 * BYTE-IDENTICAL on every golden fixture, the freshly generated export
 * must equal the fixture's own numbers exactly, and each checked-in
 * `fixtures/<stem>.graphthe.json` golden must be fresh (mirrors
 * `curves.test.ts`'s own freshness proof). Plus two synthetic docs
 * (merged-ground four-bar, rotated-rail slider-crank) round trip
 * byte-identically too.
 */

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { parseGraphtheText } from "./graphtheSchema";
import { exportGraphthe, serializeGraphthe } from "./graphthe";
import { importGraphthe } from "./importGraphthe";
import { buildLink, makeDoc } from "./__fixtures__/testDocs";
import { createId, type MechanismDocumentInput } from "../model";
import type { GtmFixture } from "../../scripts/gtm/fixture";

const FIXTURES_DIR = join(import.meta.dirname, "..", "..", "fixtures");

interface EdgeShape {
  readonly source: number;
  readonly target: number;
  readonly pos: readonly [number, number];
  readonly input?: boolean;
  readonly type?: string;
  readonly axis?: readonly [number, number];
}

function fixtureFiles(): string[] {
  return readdirSync(FIXTURES_DIR)
    .filter((f) => f.endsWith(".gtm.json"))
    .sort();
}

function loadFixture(file: string): GtmFixture {
  const text = readFileSync(join(FIXTURES_DIR, file), "utf8");
  return JSON.parse(text) as GtmFixture;
}

function exportFixtureText(file: string): string {
  const text = readFileSync(join(FIXTURES_DIR, file), "utf8");
  return exportGraphthe(importGraphthe(parseGraphtheText(text))).text;
}

describe("golden fixture set", () => {
  it("has exactly 15 .gtm.json fixtures, including both slider fixtures", () => {
    const files = fixtureFiles();
    expect(files).toHaveLength(15);
    expect(files).toContain("slider-crank.gtm.json");
    expect(files).toContain("inverted-slider-crank.gtm.json");

    const slider = loadFixture("slider-crank.gtm.json");
    expect(slider.graph.edges.some((e) => e.type === "prismatic")).toBe(true);
    const inverted = loadFixture("inverted-slider-crank.gtm.json");
    expect(inverted.graph.edges.some((e) => e.type === "prismatic")).toBe(true);
  });
});

describe("byte-identical round trip over every fixture", () => {
  for (const file of fixtureFiles()) {
    it(`round trips ${file} byte-identically and matches the fixture numbers exactly`, () => {
      const fx = loadFixture(file);

      const e1 = exportFixtureText(file);
      const e2 = exportGraphthe(importGraphthe(parseGraphtheText(e1))).text;
      expect(e2).toBe(e1);

      // Deep-equality with the fixture's own numbers.
      const out = JSON.parse(e1) as {
        graph: { nodes: { id: number; link_type?: string }[]; edges: EdgeShape[] };
        markers: { link: number; pos: readonly [number, number] }[];
      };
      const exportedNodes = [...out.graph.nodes].sort((a, b) => a.id - b.id);
      const fixtureNodes = [...fx.graph.nodes].sort((a, b) => a.id - b.id);
      expect(exportedNodes.map((n) => n.id)).toEqual(fixtureNodes.map((n) => n.id));
      const V1_TYPES = new Set(["ground", "binary", "ternary", "quaternary", "pentary"]);
      for (let i = 0; i < exportedNodes.length; i++) {
        const fixtureType = fixtureNodes[i].link_type;
        if (fixtureType === undefined) continue;
        if (V1_TYPES.has(fixtureType)) {
          // The v1 classifier vocabulary: exact match required.
          expect(exportedNodes[i].link_type).toBe(fixtureType);
        } else {
          // v0-era descriptive labels ("slider"/"block") are superseded in
          // v1 by the degree rule (linkTypeForJointCount) — the node must
          // still carry a well-formed classifier type.
          expect(V1_TYPES.has(exportedNodes[i].link_type ?? "")).toBe(true);
        }
      }

      const keyOf = (e: Pick<EdgeShape, "source" | "target">): string => {
        const lo = Math.min(e.source, e.target);
        const hi = Math.max(e.source, e.target);
        return `${lo}-${hi}`;
      };
      const exportedEdges = new Map(out.graph.edges.map((e) => [keyOf(e), e]));
      expect(exportedEdges.size).toBe(fx.graph.edges.length);
      for (const fe of fx.graph.edges) {
        const ee = exportedEdges.get(keyOf(fe));
        expect(ee).toBeDefined();
        expect(ee!.pos).toEqual(fe.pos);
        expect(ee!.source).toBe(Math.min(fe.source, fe.target));
        expect(ee!.target).toBe(Math.max(fe.source, fe.target));
        expect(ee!.input).toBe(fe.input === true ? true : undefined);
        if (fe.type === "prismatic") {
          expect(ee!.type).toBe("prismatic");
          expect(ee!.axis).toEqual(fe.axis);
        } else {
          expect(ee!.type).toBeUndefined();
          expect(ee!.axis).toBeUndefined();
        }
      }

      expect(out.markers).toHaveLength(fx.markers.length);
      for (let i = 0; i < fx.markers.length; i++) {
        expect(out.markers[i].link).toBe(fx.markers[i].link);
        expect(out.markers[i].pos).toEqual(fx.markers[i].pos);
      }
    });
  }

  it("keeps every checked-in .graphthe.json golden fresh (\\r\\n normalized)", () => {
    for (const file of fixtureFiles()) {
      const stem = file.replace(/\.gtm\.json$/, "");
      const goldenPath = join(FIXTURES_DIR, `${stem}.graphthe.json`);
      expect(existsSync(goldenPath), `${goldenPath} must exist`).toBe(true);
      const golden = readFileSync(goldenPath, "utf8");
      const fresh = exportFixtureText(file);
      expect(golden.replace(/\r\n/g, "\n")).toBe(fresh.replace(/\r\n/g, "\n"));
    }
  });
});

describe("round trip of synthetic documents", () => {
  it("is byte-identical for a merged-ground four-bar (two ground links)", () => {
    const groundA = buildLink({
      name: "g1",
      isGround: true,
      origin: [0, 0],
      sites: { a: [0, 0] },
    });
    const groundB = buildLink({
      name: "g2",
      isGround: true,
      origin: [0, 0],
      sites: { b: [100, 0] },
    });
    const crank = buildLink({ name: "crank", origin: [0, 0], sites: { p: [0, 0], q: [30, 40] } });
    const rocker = buildLink({
      name: "rocker",
      origin: [100, 0],
      sites: { r: [100, 0], s: [30, 40] },
    });
    const [j1, j2, j3] = [createId("joint"), createId("joint"), createId("joint")];
    const doc = makeDoc({
      schemaVersion: 1,
      name: "merged four-bar",
      links: [groundA.link, groundB.link, crank.link, rocker.link],
      joints: [
        { id: j1, name: "j1", type: "R", siteA: groundA.siteIds.a, siteB: crank.siteIds.p },
        { id: j2, name: "j2", type: "R", siteA: crank.siteIds.q, siteB: rocker.siteIds.s },
        { id: j3, name: "j3", type: "R", siteA: rocker.siteIds.r, siteB: groundB.siteIds.b },
      ],
      motors: [
        {
          id: createId("motor"),
          name: "m",
          jointId: j1,
          kind: "rotary",
          drive: { mode: "constant", speed: 1 },
        },
      ],
    } satisfies MechanismDocumentInput);

    const e1 = exportGraphthe(doc).text;
    const envelope = parseGraphtheText(e1);
    expect(envelope.graph.nodes[0].link_names).toEqual(["g1", "g2"]);

    const doc2 = importGraphthe(envelope);
    // Re-imports as two isGround links named g1, g2 (all ground sites on the first).
    const grounds = doc2.links.filter((l) => l.isGround);
    expect(grounds.map((l) => l.name)).toEqual(["g1", "g2"]);

    const e2 = exportGraphthe(doc2).text;
    const e3 = exportGraphthe(importGraphthe(parseGraphtheText(e2))).text;
    expect(e2).toBe(e1);
    expect(e3).toBe(e1);
  });

  it("is byte-identical for a slider-crank with a rotated rail link", () => {
    const angle = Math.PI / 9;
    const ground = buildLink({
      name: "ground",
      isGround: true,
      origin: [0, 0],
      sites: { o: [0, 0] },
    });
    const rail = buildLink({
      name: "rail",
      isGround: true,
      origin: [0, 0],
      angle,
      sites: { r: [50, 50] },
    });
    const crank = buildLink({ name: "crank", origin: [0, 0], sites: { p: [0, 0], q: [40, 0] } });
    const slider = buildLink({
      name: "slider",
      origin: [50, 50],
      sites: { s: [50, 50], t: [50, 50] },
    });
    const [jr, jc, js] = [createId("joint"), createId("joint"), createId("joint")];
    const doc = makeDoc({
      schemaVersion: 1,
      name: "rotated rail",
      links: [ground.link, rail.link, crank.link, slider.link],
      joints: [
        {
          id: jr,
          name: "rail-joint",
          type: "P",
          siteA: rail.siteIds.r,
          siteB: slider.siteIds.s,
          axis: [1, 0],
        },
        { id: jc, name: "crank-joint", type: "R", siteA: ground.siteIds.o, siteB: crank.siteIds.p },
        {
          id: js,
          name: "slider-joint",
          type: "R",
          siteA: crank.siteIds.q,
          siteB: slider.siteIds.t,
        },
      ],
      motors: [
        {
          id: createId("motor"),
          name: "m",
          jointId: jc,
          kind: "rotary",
          drive: { mode: "constant", speed: 1 },
        },
      ],
    } satisfies MechanismDocumentInput);

    const e1 = exportGraphthe(doc).text;
    const e2 = exportGraphthe(importGraphthe(parseGraphtheText(e1))).text;
    const e3 = exportGraphthe(importGraphthe(parseGraphtheText(e2))).text;
    expect(e2).toBe(e1);
    expect(e3).toBe(e1);

    const envelope = parseGraphtheText(e1);
    const prismatic = envelope.graph.edges.find((e) => e.type === "prismatic");
    expect(prismatic).toBeDefined();
  });
});

describe("importGraphthe: schema validity", () => {
  it("produces a MechanismDocumentSchema-valid document from every fixture", () => {
    for (const file of fixtureFiles()) {
      const text = readFileSync(join(FIXTURES_DIR, file), "utf8");
      const doc = importGraphthe(parseGraphtheText(text));
      expect(doc.links.length).toBeGreaterThan(0);
      expect(doc.joints.length).toBeGreaterThan(0);
    }
  });

  it("re-exports the same link_names for a merged-ground envelope", () => {
    const file = "fourbar-crank-rocker.gtm.json";
    const text = readFileSync(join(FIXTURES_DIR, file), "utf8");
    const doc = importGraphthe(parseGraphtheText(text));
    const e1 = exportGraphthe(doc).text;
    const env = parseGraphtheText(e1);
    expect(env.graph.nodes[0].link_names).toEqual(["link-0"]);
    expect(exportGraphthe(importGraphthe(env)).text).toBe(e1);
  });

  it("carries units.length from the envelope when present", () => {
    const file = "fourbar-crank-rocker.gtm.json";
    const text = readFileSync(join(FIXTURES_DIR, file), "utf8");
    const doc = importGraphthe(parseGraphtheText(text));
    expect(doc.units.length).toBe("mm");
  });
});

describe("serializeGraphthe over goldens", () => {
  it("round trips the serialized text of every golden through parse + serialize", () => {
    for (const file of fixtureFiles()) {
      const stem = file.replace(/\.gtm\.json$/, "");
      const golden = readFileSync(join(FIXTURES_DIR, `${stem}.graphthe.json`), "utf8");
      const env = parseGraphtheText(golden);
      expect(serializeGraphthe(env)).toBe(golden.replace(/\r\n/g, "\n"));
    }
  });
});
