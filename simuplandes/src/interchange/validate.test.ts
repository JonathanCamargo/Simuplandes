import { describe, it, expect } from "vitest";
import { buildExportReport } from "./validate";
import { exportGraphthe } from "./graphthe";
import { buildLink, makeDoc } from "./__fixtures__/testDocs";
import { createId, type MechanismDocument, type MechanismDocumentInput } from "../model";

/** A clean Grashof four-bar: 1 ground, 1 rotary motor on the ground pivot, F = 1. */
function cleanFourBar(): MechanismDocument {
  const ground = buildLink({
    name: "ground",
    isGround: true,
    origin: [0, 0],
    sites: { a: [0, 0], d: [100, 0] },
  });
  const crank = buildLink({ name: "crank", origin: [0, 0], sites: { a: [0, 0], b: [20, 34.64] } });
  const coupler = buildLink({
    name: "coupler",
    origin: [20, 34.64],
    sites: { b: [20, 34.64], c: [110, 80] },
  });
  const rocker = buildLink({
    name: "rocker",
    origin: [100, 0],
    sites: { d: [100, 0], c: [110, 80] },
  });
  const [jOA, jAB, jBC, jCD] = [
    createId("joint"),
    createId("joint"),
    createId("joint"),
    createId("joint"),
  ];
  return makeDoc({
    schemaVersion: 1,
    name: "clean four-bar",
    links: [ground.link, crank.link, coupler.link, rocker.link],
    joints: [
      { id: jOA, name: "O-A", type: "R", siteA: ground.siteIds.a, siteB: crank.siteIds.a },
      { id: jAB, name: "A-B", type: "R", siteA: crank.siteIds.b, siteB: coupler.siteIds.b },
      { id: jBC, name: "B-C", type: "R", siteA: coupler.siteIds.c, siteB: rocker.siteIds.c },
      { id: jCD, name: "C-D", type: "R", siteA: rocker.siteIds.d, siteB: ground.siteIds.d },
    ],
    motors: [
      {
        id: createId("motor"),
        name: "m",
        jointId: jOA,
        kind: "rotary",
        drive: { mode: "constant", speed: 1 },
      },
    ],
  } satisfies MechanismDocumentInput);
}

describe("buildExportReport: clean mechanism", () => {
  it("reports zero errors and zero warnings for a clean four-bar", () => {
    const doc = cleanFourBar();
    const report = buildExportReport(doc, exportGraphthe(doc));
    expect(report.counts).toEqual({ error: 0, warning: 0, info: 0 });
    expect(report.items).toHaveLength(0);
  });
});

describe("buildExportReport: merged ground", () => {
  it("emits one merged-ground info item naming the merged bodies", () => {
    const g1 = buildLink({ name: "g1", isGround: true, origin: [0, 0], sites: { a: [0, 0] } });
    const g2 = buildLink({ name: "g2", isGround: true, origin: [0, 0], sites: { b: [100, 0] } });
    const crank = buildLink({ name: "crank", origin: [0, 0], sites: { p: [0, 0], q: [40, 0] } });
    const rocker = buildLink({
      name: "rocker",
      origin: [100, 0],
      sites: { r: [100, 0], s: [40, 0] },
    });
    const [j1, j2, j3] = [createId("joint"), createId("joint"), createId("joint")];
    const doc = makeDoc({
      schemaVersion: 1,
      name: "merged",
      links: [g1.link, g2.link, crank.link, rocker.link],
      joints: [
        { id: j1, name: "j1", type: "R", siteA: g1.siteIds.a, siteB: crank.siteIds.p },
        { id: j2, name: "j2", type: "R", siteA: crank.siteIds.q, siteB: rocker.siteIds.s },
        { id: j3, name: "j3", type: "R", siteA: rocker.siteIds.r, siteB: g2.siteIds.b },
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

    const report = buildExportReport(doc, exportGraphthe(doc));
    const merged = report.items.find((i) => i.code === "merged-ground");
    expect(merged).toBeDefined();
    expect(merged!.severity).toBe("info");
    expect(merged!.linkIds).toEqual([g1.link.id, g2.link.id]);
  });
});

describe("buildExportReport: can't-simulate errors (warn but allow)", () => {
  it("flags a five-bar (F = 2) with cannot-simulate-dof while still producing the export text", () => {
    // Five-bar: ground + 4 moving links, 5 joints -> F = 3*(5-1) - 2*5 = 2.
    const ground = buildLink({
      name: "ground",
      isGround: true,
      origin: [0, 0],
      sites: { a: [0, 0], e: [120, 0] },
    });
    const l2 = buildLink({ name: "L2", origin: [0, 0], sites: { a: [0, 0], b: [30, 30] } });
    const l3 = buildLink({ name: "L3", origin: [30, 30], sites: { b: [30, 30], c: [60, 50] } });
    const l4 = buildLink({ name: "L4", origin: [60, 50], sites: { c: [60, 50], d: [90, 30] } });
    const l5 = buildLink({ name: "L5", origin: [90, 30], sites: { d: [90, 30], e: [120, 0] } });
    const joints: MechanismDocumentInput["joints"] = [
      { id: createId("joint"), name: "a", type: "R", siteA: ground.siteIds.a, siteB: l2.siteIds.a },
      { id: createId("joint"), name: "b", type: "R", siteA: l2.siteIds.b, siteB: l3.siteIds.b },
      { id: createId("joint"), name: "c", type: "R", siteA: l3.siteIds.c, siteB: l4.siteIds.c },
      { id: createId("joint"), name: "d", type: "R", siteA: l4.siteIds.d, siteB: l5.siteIds.d },
      { id: createId("joint"), name: "e", type: "R", siteA: l5.siteIds.e, siteB: ground.siteIds.e },
    ];
    const doc = makeDoc({
      schemaVersion: 1,
      name: "five-bar",
      links: [ground.link, l2.link, l3.link, l4.link, l5.link],
      joints,
      motors: [
        {
          id: createId("motor"),
          name: "m",
          jointId: joints[0].id,
          kind: "rotary",
          drive: { mode: "constant", speed: 1 },
        },
      ],
    } satisfies MechanismDocumentInput);

    const result = exportGraphthe(doc);
    const report = buildExportReport(doc, result);

    const dof = report.items.find((i) => i.code === "cannot-simulate-dof");
    expect(dof).toBeDefined();
    expect(dof!.severity).toBe("error");
    expect(dof!.params.dof).toBe(2);
    // The export is still written.
    expect(result.text.length).toBeGreaterThan(0);
    const parsed: unknown = JSON.parse(result.text);
    expect(typeof parsed).toBe("object");
  });

  it("flags no motor, several motors, motor not on ground, and a linear motor", () => {
    const base = cleanFourBar();

    // No motor.
    const noMotor = makeDoc({ ...base, motors: [] } satisfies MechanismDocumentInput);
    const r1 = buildExportReport(noMotor, exportGraphthe(noMotor));
    expect(
      r1.items.some((i) => i.code === "cannot-simulate-no-motor" && i.severity === "error"),
    ).toBe(true);

    // Two motors (both on ground pivots).
    const jAB = base.joints.find((j) => j.name === "A-B")!;
    const two = makeDoc({
      ...base,
      motors: [
        base.motors[0],
        {
          id: createId("motor"),
          name: "m2",
          jointId: jAB.id,
          kind: "rotary",
          drive: { mode: "constant", speed: 1 },
        },
      ],
    } satisfies MechanismDocumentInput);
    const r2 = buildExportReport(two, exportGraphthe(two));
    const several = r2.items.find((i) => i.code === "cannot-simulate-several-motors");
    expect(several).toBeDefined();
    expect(several!.params.count).toBe(2);
    expect(several!.jointIds).toEqual([base.motors[0].jointId, jAB.id]);

    // Motor on a joint between two moving links.
    const r3 = buildExportReport(two, exportGraphthe(two));
    expect(
      r3.items.some(
        (i) => i.code === "cannot-simulate-motor-not-on-ground" && i.jointIds.includes(jAB.id),
      ),
    ).toBe(true);

    // Linear motor on a P joint.
    const rail = buildLink({
      name: "rail",
      isGround: true,
      origin: [0, 0],
      sites: { r: [50, 20] },
    });
    const block = buildLink({ name: "block", origin: [50, 20], sites: { s: [50, 20] } });
    const jP = createId("joint");
    const linear = makeDoc({
      schemaVersion: 1,
      name: "linear",
      links: [rail.link, block.link],
      joints: [
        {
          id: jP,
          name: "P",
          type: "P",
          siteA: rail.siteIds.r,
          siteB: block.siteIds.s,
          axis: [1, 0],
        },
      ],
      motors: [
        {
          id: createId("motor"),
          name: "lm",
          jointId: jP,
          kind: "linear",
          drive: { mode: "constant", speed: 1 },
        },
      ],
    } satisfies MechanismDocumentInput);
    const r4 = buildExportReport(linear, exportGraphthe(linear));
    const lin = r4.items.find((i) => i.code === "cannot-simulate-linear-motor");
    expect(lin).toBeDefined();
    expect(lin!.jointIds).toEqual([jP]);
  });
});

describe("buildExportReport: structural notes", () => {
  it("turns no-ground into an error, parallel/dangling into warnings, ground-loop into info", () => {
    const ground = buildLink({
      name: "ground",
      isGround: true,
      origin: [0, 0],
      sites: { a: [0, 0], b: [10, 0] },
    });
    const link = buildLink({ name: "link", origin: [0, 0], sites: { c: [0, 0], d: [10, 0] } });
    const first = createId("joint");
    const second = createId("joint");
    const parsed = makeDoc({
      schemaVersion: 1,
      name: "parallel",
      links: [ground.link, link.link],
      joints: [
        { id: first, name: "j1", type: "R", siteA: ground.siteIds.a, siteB: link.siteIds.c },
        { id: second, name: "j2", type: "R", siteA: ground.siteIds.b, siteB: link.siteIds.d },
      ],
      motors: [
        {
          id: createId("motor"),
          name: "m",
          jointId: first,
          kind: "rotary",
          drive: { mode: "constant", speed: 1 },
        },
      ],
    } satisfies MechanismDocumentInput);

    const report = buildExportReport(parsed, exportGraphthe(parsed));
    const parallel = report.items.find((i) => i.code === "parallel-joint");
    expect(parallel).toBeDefined();
    expect(parallel!.severity).toBe("warning");
    expect(parallel!.jointIds).toEqual([second]);

    // No ground: error.
    const noGroundDoc = makeDoc({
      schemaVersion: 1,
      name: "no ground",
      links: [link.link],
      joints: [],
      motors: [],
    } satisfies MechanismDocumentInput);
    const r2 = buildExportReport(noGroundDoc, exportGraphthe(noGroundDoc));
    expect(r2.items.some((i) => i.code === "no-ground" && i.severity === "error")).toBe(true);

    // Dangling joint: warning (bypass integrity like 08-01's tests).
    const danglingId = createId("joint");
    const danglingDoc = {
      ...parsed,
      joints: [
        ...parsed.joints,
        {
          id: danglingId,
          name: "dangling",
          type: "R" as const,
          siteA: "site-missing",
          siteB: "site-missing",
        },
      ],
    };
    const r3 = buildExportReport(danglingDoc, exportGraphthe(danglingDoc));
    const dangling = r3.items.find((i) => i.code === "dangling-joint");
    expect(dangling).toBeDefined();
    expect(dangling!.severity).toBe("warning");

    // Ground loop: info.
    const g1 = buildLink({ name: "g1", isGround: true, origin: [0, 0], sites: { a: [0, 0] } });
    const g2 = buildLink({ name: "g2", isGround: true, origin: [0, 0], sites: { b: [10, 0] } });
    const loopId = createId("joint");
    const loopDoc = makeDoc({
      schemaVersion: 1,
      name: "loop",
      links: [g1.link, g2.link],
      joints: [{ id: loopId, name: "loop", type: "R", siteA: g1.siteIds.a, siteB: g2.siteIds.b }],
      motors: [],
    } satisfies MechanismDocumentInput);
    const r4 = buildExportReport(loopDoc, exportGraphthe(loopDoc));
    const loop = r4.items.find((i) => i.code === "ground-loop");
    expect(loop).toBeDefined();
    expect(loop!.severity).toBe("info");
  });

  it("warns unusual-link-degree for a moving node with exported degree 1", () => {
    const ground = buildLink({
      name: "ground",
      isGround: true,
      origin: [0, 0],
      sites: { a: [0, 0] },
    });
    const crank = buildLink({ name: "crank", origin: [0, 0], sites: { p: [0, 0], q: [30, 0] } });
    const danglingLink = buildLink({ name: "dangler", origin: [30, 0], sites: { r: [30, 0] } });
    const [j1, j2] = [createId("joint"), createId("joint")];
    const doc = makeDoc({
      schemaVersion: 1,
      name: "degree-1",
      links: [ground.link, crank.link, danglingLink.link],
      joints: [
        { id: j1, name: "j1", type: "R", siteA: ground.siteIds.a, siteB: crank.siteIds.p },
        { id: j2, name: "j2", type: "R", siteA: crank.siteIds.q, siteB: danglingLink.siteIds.r },
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

    const report = buildExportReport(doc, exportGraphthe(doc));
    const unusual = report.items.find((i) => i.code === "unusual-link-degree");
    expect(unusual).toBeDefined();
    expect(unusual!.severity).toBe("warning");
    expect(unusual!.params.degree).toBe(1);
  });
});

describe("buildExportReport: multi-joint", () => {
  it("emits one multi-joint-split info per group with the plan in params", () => {
    const B = buildLink({ name: "B", origin: [0, 0], sites: { p: [10, 10], q: [30, 10] } });
    const C = buildLink({ name: "C", origin: [0, 0], sites: { p: [10, 10], r: [10, -30] } });
    const D = buildLink({ name: "D", origin: [0, 0], sites: { p: [10, 10], s: [-25, 10] } });
    const [jBC, jCD] = [createId("joint"), createId("joint")];
    const doc = makeDoc({
      schemaVersion: 1,
      name: "chain",
      links: [B.link, C.link, D.link],
      joints: [
        { id: jBC, name: "BC", type: "R", siteA: B.siteIds.p, siteB: C.siteIds.p },
        { id: jCD, name: "CD", type: "R", siteA: C.siteIds.p, siteB: D.siteIds.p },
      ],
      motors: [],
    } satisfies MechanismDocumentInput);

    const report = buildExportReport(doc, exportGraphthe(doc));
    const splits = report.items.filter((i) => i.code === "multi-joint-split");
    expect(splits).toHaveLength(1);
    expect(splits[0].severity).toBe("info");
    expect(splits[0].jointIds).toEqual([jBC, jCD]);
    expect(splits[0].params.hub).toBe(2);
    expect(splits[0].params.kept).toEqual([jBC, jCD]);
    expect(splits[0].params.dropped).toEqual([]);
    expect(splits[0].params.synthesized).toEqual([]);
  });
});

describe("buildExportReport: ordering and keys", () => {
  it("sorts items errors, warnings, info; counts match; keys are unique and stable", () => {
    // Build a doc with one of everything: merged ground, parallel joint,
    // a DOF problem, and a multi-joint.
    const g1 = buildLink({ name: "g1", isGround: true, origin: [0, 0], sites: { a: [0, 0] } });
    const g2 = buildLink({ name: "g2", isGround: true, origin: [0, 0], sites: { b: [10, 10] } });
    const B = buildLink({ name: "B", origin: [0, 0], sites: { p: [10, 10], q: [30, 10] } });
    const C = buildLink({ name: "C", origin: [0, 0], sites: { p: [10, 10], r: [10, -30] } });
    const D = buildLink({ name: "D", origin: [0, 0], sites: { p: [10, 10], s: [-25, 10] } });
    const [jGC, jBC, jCD, jBD] = [
      createId("joint"),
      createId("joint"),
      createId("joint"),
      createId("joint"),
    ];
    const doc = makeDoc({
      schemaVersion: 1,
      name: "everything",
      links: [g1.link, g2.link, B.link, C.link, D.link],
      joints: [
        { id: jGC, name: "GC", type: "R", siteA: g2.siteIds.b, siteB: B.siteIds.p },
        { id: jBC, name: "BC", type: "R", siteA: B.siteIds.p, siteB: C.siteIds.p },
        { id: jCD, name: "CD", type: "R", siteA: C.siteIds.p, siteB: D.siteIds.p },
        { id: jBD, name: "BD", type: "R", siteA: B.siteIds.p, siteB: D.siteIds.p },
      ],
      motors: [],
    } satisfies MechanismDocumentInput);

    const report = buildExportReport(doc, exportGraphthe(doc));
    expect(report.items.length).toBeGreaterThan(0);

    // Severity ordering is monotone: all errors first, then warnings, then info.
    const order: Record<string, number> = { error: 0, warning: 1, info: 2 };
    const severities = report.items.map((i) => order[i.severity]);
    const sorted = [...severities].sort((a, b) => a - b);
    expect(severities).toEqual(sorted);

    // Counts match.
    const errors = report.items.filter((i) => i.severity === "error").length;
    const warnings = report.items.filter((i) => i.severity === "warning").length;
    const infos = report.items.filter((i) => i.severity === "info").length;
    expect(report.counts).toEqual({ error: errors, warning: warnings, info: infos });

    // Keys unique.
    const keys = report.items.map((i) => i.key);
    expect(new Set(keys).size).toBe(keys.length);

    // DOF is computed on the EXPORTED (post-split) graph: the four joints
    // at [10,10] (g2-B, B-C, C-D, B-D) form ONE group spanning nodes
    // {0, B, C, D} with hub = ground (node 0), exporting as a 3-edge star;
    // the three non-hub joints are dropped, not double-counted.
    const split = report.items.find((i) => i.code === "multi-joint-split");
    expect(split).toBeDefined();
    expect(split!.params.dropped).toEqual([jBC, jCD, jBD].map(String));

    // Deterministic across runs.
    const report2 = buildExportReport(doc, exportGraphthe(doc));
    expect(report2.items.map((i) => i.key)).toEqual(keys);
  });

  it("computes DOF from the exported graph: a triangle multi-joint's dropped joint does not double-count", () => {
    const B = buildLink({ name: "B", origin: [0, 0], sites: { p: [10, 10], q: [30, 10] } });
    const C = buildLink({ name: "C", origin: [0, 0], sites: { p: [10, 10], r: [10, -30] } });
    const D = buildLink({ name: "D", origin: [0, 0], sites: { p: [10, 10], s: [-25, 10] } });
    const [jBC, jCD, jBD] = [createId("joint"), createId("joint"), createId("joint")];
    const doc = makeDoc({
      schemaVersion: 1,
      name: "triangle",
      links: [B.link, C.link, D.link],
      joints: [
        { id: jBC, name: "BC", type: "R", siteA: B.siteIds.p, siteB: C.siteIds.p },
        { id: jCD, name: "CD", type: "R", siteA: C.siteIds.p, siteB: D.siteIds.p },
        { id: jBD, name: "BD", type: "R", siteA: B.siteIds.p, siteB: D.siteIds.p },
      ],
      motors: [],
    } satisfies MechanismDocumentInput);

    const result = exportGraphthe(doc);
    const report = buildExportReport(doc, result);

    // Exported: node 0 is ALWAYS emitted (this doc has no ground link),
    // so the graph has 4 nodes and 2 star edges -> F = 3*(4-1) - 2*2 = 5.
    // The point: the pre-split joint count was 3; the dropped cycle joint
    // must not leak into j (a naive pre-split count would give F = 4).
    const dof = report.items.find((i) => i.code === "cannot-simulate-dof");
    expect(dof).toBeDefined();
    expect(dof!.params.dof).toBe(5);
    expect(result.envelope.graph.edges).toHaveLength(2);
  });
});
