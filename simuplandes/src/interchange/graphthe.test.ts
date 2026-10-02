import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { exportGraphthe, serializeGraphthe, SIMUPLANDES_VERSION } from "./graphthe";
import { parseGraphtheText, GRAPHTHE_FORMAT } from "./graphtheSchema";
import { importGraphthe } from "./importGraphthe";
import { buildLink, makeDoc } from "./__fixtures__/testDocs";
import {
  createId,
  siteWorldPosition,
  indexDocument,
  type MechanismDocument,
  type MechanismDocumentInput,
} from "../model";
import { rotate, vec2 } from "../geom";
import { linkTypeOf } from "../canvas/linkType";

const PKG = JSON.parse(
  readFileSync(join(import.meta.dirname, "..", "..", "package.json"), "utf8"),
) as { version: string };

/** Joint ids created up front so the motor can reference one. */
function jointIds(n: number): string[] {
  return Array.from({ length: n }, () => createId("joint"));
}

/** A Grashof four-bar with one rotary motor on the ground-crank joint. */
function fourBarDoc(): { doc: MechanismDocument; ground: ReturnType<typeof buildLink> } {
  const ground = buildLink({
    name: "ground",
    isGround: true,
    origin: [0, 0],
    sites: { n1: [0, 0], n3: [100, 0] },
  });
  const crank = buildLink({
    name: "crank",
    origin: [0, 0],
    sites: { n0: [0, 0], n2: [20, 34.64101615137754] },
  });
  const coupler = buildLink({
    name: "coupler",
    origin: [20, 34.64101615137754],
    sites: { n1: [20, 34.64101615137754], n3: [110, 80] },
  });
  const rocker = buildLink({
    name: "rocker",
    origin: [100, 0],
    sites: { n0: [100, 0], n2: [110, 80] },
  });

  const [j01, j12, j23, j30] = jointIds(4);
  const doc = makeDoc({
    schemaVersion: 1,
    name: "four-bar",
    links: [ground.link, crank.link, coupler.link, rocker.link],
    joints: [
      { id: j01, name: "0-1", type: "R", siteA: ground.siteIds.n1, siteB: crank.siteIds.n0 },
      { id: j12, name: "1-2", type: "R", siteA: crank.siteIds.n2, siteB: coupler.siteIds.n1 },
      { id: j23, name: "2-3", type: "R", siteA: coupler.siteIds.n3, siteB: rocker.siteIds.n2 },
      { id: j30, name: "3-0", type: "R", siteA: rocker.siteIds.n0, siteB: ground.siteIds.n3 },
    ],
    motors: [
      {
        id: createId("motor"),
        name: "input-motor",
        jointId: j01,
        kind: "rotary",
        drive: { mode: "constant", speed: 1 },
      },
    ],
    markers: [],
  } satisfies MechanismDocumentInput);

  return { doc, ground };
}

describe("exportGraphthe: v1 envelope", () => {
  it("produces the v1 envelope with the right metadata and node-link shape", () => {
    const { doc } = fourBarDoc();
    const { envelope } = exportGraphthe(doc);

    expect(envelope.format).toBe("simuplandes-graphthe-export");
    expect(envelope.version).toBe(1);
    expect(envelope.name).toBe("four-bar");
    expect(envelope.units).toBe("mm");
    expect(envelope.source).toEqual({ app: "Simuplandes", version: PKG.version });
    expect(SIMUPLANDES_VERSION).toBe(PKG.version);
    expect(envelope.graph.directed).toBe(false);
    expect(envelope.graph.multigraph).toBe(false);
    expect(envelope.graph.graph).toEqual({});
    expect(envelope.graph.nodes).toHaveLength(4);
    expect(envelope.graph.edges).toHaveLength(4);
  });

  it("merges ground into node 0 and numbers moving links in document order", () => {
    const { doc } = fourBarDoc();
    const { envelope } = exportGraphthe(doc);

    expect(envelope.graph.nodes[0]).toEqual({ id: 0, link_type: "ground", link_names: ["ground"] });
    expect(envelope.graph.nodes.slice(1).map((n) => n.id)).toEqual([1, 2, 3]);
    expect(envelope.graph.nodes[1].link_names).toEqual(["crank"]);
  });

  it("computes every pos as the reference-pose world position of the joint's sites", () => {
    const { doc } = fourBarDoc();
    const { envelope } = exportGraphthe(doc);
    const index = indexDocument(doc);

    // Every exported pos equals a real joint site's world position exactly.
    const worldPoints = new Set(
      doc.joints.flatMap((j) => {
        const a = index.sites.get(j.siteA)!;
        const b = index.sites.get(j.siteB)!;
        const wa = siteWorldPosition(a.link, a.site.local);
        const wb = siteWorldPosition(b.link, b.site.local);
        return [`${wa.x},${wa.y}` as const, `${wb.x},${wb.y}` as const];
      }),
    );
    for (const edge of envelope.graph.edges) {
      expect(worldPoints.has(`${edge.pos[0]},${edge.pos[1]}`)).toBe(true);
    }

    // Ground-crank joint: pos must equal the siteA (ground side) world point.
    const motorJointId = doc.motors[0].jointId;
    const motorJoint = doc.joints.find((j) => j.id === motorJointId)!;
    const siteA = index.sites.get(motorJoint.siteA)!;
    const world = siteWorldPosition(siteA.link, siteA.site.local);
    const edge = envelope.graph.edges.find((e) => e.input === true)!;
    expect(edge.pos).toEqual([world.x, world.y]);
  });

  it("marks exactly the motor joint's edge input: true", () => {
    const { doc } = fourBarDoc();
    const { envelope } = exportGraphthe(doc);

    const inputEdges = envelope.graph.edges.filter((e) => e.input === true);
    expect(inputEdges).toHaveLength(1);
    expect(inputEdges[0].source).toBe(0);
    expect(inputEdges[0].target).toBe(1);
  });

  it("orders edges source < target and sorted by (source, target)", () => {
    const { doc } = fourBarDoc();
    const { envelope } = exportGraphthe(doc);
    const edges = envelope.graph.edges;

    for (const e of edges) expect(e.source).toBeLessThan(e.target);
    const keys = edges.map((e) => [e.source, e.target] as const);
    const sorted = [...keys].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    expect(keys).toEqual(sorted);
  });
});

describe("exportGraphthe: merged ground", () => {
  it("merges two isGround links into one node 0 with both names in document order", () => {
    const groundA = buildLink({
      name: "ground A",
      isGround: true,
      origin: [0, 0],
      sites: { n1: [0, 0] },
    });
    const groundB = buildLink({
      name: "ground B",
      isGround: true,
      origin: [0, 0],
      sites: { n3: [100, 0] },
    });
    const crank = buildLink({ name: "crank", origin: [0, 0], sites: { a: [0, 0], b: [20, 20] } });
    const rocker = buildLink({
      name: "rocker",
      origin: [100, 0],
      sites: { c: [100, 0], d: [20, 20] },
    });

    const j1 = createId("joint");
    const j2 = createId("joint");
    const doc = makeDoc({
      schemaVersion: 1,
      name: "merged",
      links: [groundA.link, groundB.link, crank.link, rocker.link],
      joints: [
        { id: j1, name: "j1", type: "R", siteA: groundA.siteIds.n1, siteB: crank.siteIds.a },
        { id: j2, name: "j2", type: "R", siteA: rocker.siteIds.c, siteB: groundB.siteIds.n3 },
        {
          id: createId("joint"),
          name: "j3",
          type: "R",
          siteA: crank.siteIds.b,
          siteB: rocker.siteIds.d,
        },
      ],
      motors: [],
    });

    const { envelope, notes, nodeOfLink } = exportGraphthe(doc);

    expect(envelope.graph.nodes[0]).toEqual({
      id: 0,
      link_type: "ground",
      link_names: ["ground A", "ground B"],
    });
    expect(nodeOfLink.get(groundA.link.id)).toBe(0);
    expect(nodeOfLink.get(groundB.link.id)).toBe(0);
    expect(nodeOfLink.get(crank.link.id)).toBe(1);
    expect(envelope.graph.edges).toContainEqual(expect.objectContaining({ source: 0, target: 1 }));
    expect(envelope.graph.edges).toContainEqual(expect.objectContaining({ source: 0, target: 2 }));
    expect(notes.some((n) => n.code === "merged-ground")).toBe(true);
  });

  it("still emits node 0 and notes no-ground when the document has no ground link", () => {
    const a = buildLink({ name: "a", origin: [0, 0], sites: { p: [0, 0], q: [30, 0] } });
    const b = buildLink({ name: "b", origin: [0, 0], sites: { r: [0, 0], s: [30, 40] } });
    const doc = makeDoc({
      schemaVersion: 1,
      name: "floating",
      links: [a.link, b.link],
      joints: [
        { id: createId("joint"), name: "j", type: "R", siteA: a.siteIds.p, siteB: b.siteIds.r },
      ],
      motors: [],
    });

    const { envelope, notes } = exportGraphthe(doc);

    expect(envelope.graph.nodes[0]).toEqual({ id: 0, link_type: "ground", link_names: [] });
    expect(notes.some((n) => n.code === "no-ground")).toBe(true);
  });
});

describe("exportGraphthe: prismatic joints", () => {
  it("exports type prismatic with the world axis = rotate(local axis, siteA link pose angle) and pos = siteB world point", () => {
    // A slider-crank: ground(0) owns the rail; the slider's siteA link is
    // ground with angle 0, so rotate the RAIL link instead to hit the angle
    // path: build a prismatic joint whose siteA link has pose.angle != 0.
    const angle = Math.PI / 6;
    const railOwner = buildLink({
      name: "owner",
      origin: [0, 0],
      angle,
      sites: { s: [0, 0] },
    });
    const slider = buildLink({ name: "slider", origin: [0, 0], sites: { t: [50, 20] } });
    const doc = makeDoc({
      schemaVersion: 1,
      name: "slider",
      links: [railOwner.link, slider.link],
      joints: [
        {
          id: createId("joint"),
          name: "p",
          type: "P",
          siteA: railOwner.siteIds.s,
          siteB: slider.siteIds.t,
          axis: [1, 0],
        },
      ],
      motors: [],
    });

    const { envelope } = exportGraphthe(doc);
    const edge = envelope.graph.edges[0];

    expect(edge.type).toBe("prismatic");
    const expected = rotate(vec2(1, 0), angle);
    expect(edge.axis).toEqual([expected.x, expected.y]);
    expect(edge.source).toBe(1);
    expect(edge.target).toBe(2);
    // pos = siteB world point (the dms convention reference point).
    expect(edge.pos).toEqual([50, 20]);
  });

  it("omits type/axis keys on revolute edges", () => {
    const { doc } = fourBarDoc();
    const { envelope } = exportGraphthe(doc);

    for (const edge of envelope.graph.edges) {
      expect("type" in edge).toBe(false);
      expect("axis" in edge).toBe(false);
    }
  });
});

describe("exportGraphthe: structural notes", () => {
  it("exports only the first of two parallel joints between the same node pair", () => {
    const ground = buildLink({
      name: "ground",
      isGround: true,
      origin: [0, 0],
      sites: { a: [0, 0], b: [10, 0] },
    });
    const link = buildLink({
      name: "link",
      origin: [0, 0],
      sites: { c: [0, 0], d: [10, 0] },
    });
    const first = createId("joint");
    const second = createId("joint");
    const doc = makeDoc({
      schemaVersion: 1,
      name: "parallel",
      links: [ground.link, link.link],
      joints: [
        { id: first, name: "j1", type: "R", siteA: ground.siteIds.a, siteB: link.siteIds.c },
        { id: second, name: "j2", type: "R", siteA: ground.siteIds.b, siteB: link.siteIds.d },
      ],
      motors: [],
    });

    const { envelope, notes, edgeOfJoint } = exportGraphthe(doc);

    expect(envelope.graph.edges).toHaveLength(1);
    expect(edgeOfJoint.get(first)).toEqual([0, 1]);
    expect(edgeOfJoint.get(second)).toBeNull();
    const parallel = notes.find((n) => n.code === "parallel-joint");
    expect(parallel).toBeDefined();
    expect(parallel!.jointIds).toEqual([second]);
  });

  it("lists groundLoop and dangling joints as notes without edges", () => {
    const ground = buildLink({
      name: "ground",
      isGround: true,
      origin: [0, 0],
      sites: { a: [0, 0] },
    });
    const ground2 = buildLink({
      name: "ground 2",
      isGround: true,
      origin: [0, 0],
      sites: { b: [10, 0] },
    });
    const loop = createId("joint");
    const dangling = createId("joint");
    const parsed = makeDoc({
      schemaVersion: 1,
      name: "warned",
      links: [ground.link, ground2.link],
      joints: [
        { id: loop, name: "loop", type: "R", siteA: ground.siteIds.a, siteB: ground2.siteIds.b },
      ],
      motors: [],
    });
    // Bypass schema integrity for the dangling joint (the schema itself
    // would reject an unknown site id — mirrors fromDocument.test.ts's own
    // pattern for this warning class).
    const doc = {
      ...parsed,
      joints: [
        ...parsed.joints,
        {
          id: dangling,
          name: "dangling",
          type: "R" as const,
          siteA: "site-missing",
          siteB: "site-missing",
        },
      ],
    };

    const { envelope, notes, edgeOfJoint } = exportGraphthe(doc);

    expect(envelope.graph.edges).toHaveLength(0);
    expect(notes.some((n) => n.code === "ground-loop" && n.jointIds.includes(loop))).toBe(true);
    expect(notes.some((n) => n.code === "dangling-joint" && n.jointIds.includes(dangling))).toBe(
      true,
    );
    expect(edgeOfJoint.get(loop)).toBeNull();
    expect(edgeOfJoint.get(dangling)).toBeNull();
  });

  it("marks every motor joint edge input: true; zero motors -> no input keys", () => {
    // four-bar with a motor on TWO joints: both edges get input: true.
    const { doc } = fourBarDoc();
    const docTwoMotors = makeDoc({
      ...doc,
      motors: [
        doc.motors[0],
        {
          id: createId("motor"),
          name: "m2",
          jointId: doc.joints[1].id,
          kind: "rotary",
          drive: { mode: "constant", speed: 1 },
        },
      ],
    });
    const two = exportGraphthe(docTwoMotors).envelope;
    expect(two.graph.edges.filter((e) => e.input === true)).toHaveLength(2);

    const docNoMotors = makeDoc({ ...doc, motors: [] });
    const zero = exportGraphthe(docNoMotors).envelope;
    for (const edge of zero.graph.edges) {
      expect("input" in edge).toBe(false);
    }
  });
});

describe("exportGraphthe: multi-joint star split", () => {
  /** Chain B-C-D at one point (the shape the tools produce) + a motor on B-C. */
  function multiJointChainDoc(): { doc: MechanismDocument; jBC: string; jCD: string } {
    const B = buildLink({ name: "B", origin: [0, 0], sites: { p: [10, 10], q: [30, 10] } });
    const C = buildLink({ name: "C", origin: [0, 0], sites: { p: [10, 10], r: [10, -30] } });
    const D = buildLink({ name: "D", origin: [0, 0], sites: { p: [10, 10], s: [-25, 10] } });
    const jBC = createId("joint");
    const jCD = createId("joint");
    const doc = makeDoc({
      schemaVersion: 1,
      name: "chain",
      links: [B.link, C.link, D.link],
      joints: [
        { id: jBC, name: "BC", type: "R", siteA: B.siteIds.p, siteB: C.siteIds.p },
        { id: jCD, name: "CD", type: "R", siteA: C.siteIds.p, siteB: D.siteIds.p },
      ],
      motors: [
        {
          id: createId("motor"),
          name: "m",
          jointId: jBC,
          kind: "rotary",
          drive: { mode: "constant", speed: 1 },
        },
      ],
    } satisfies MechanismDocumentInput);
    return { doc, jBC, jCD };
  }

  it("exports a chain multi-joint as a star with the same pos and a multi-joint-split note", () => {
    const { doc, jBC, jCD } = multiJointChainDoc();
    const { envelope, notes, edgeOfJoint } = exportGraphthe(doc);

    // Hub = C (node 2; most group joints), star edges 1-2 and 2-3 at [10,10].
    const pairs = envelope.graph.edges.map((e) => [e.source, e.target] as const).sort();
    expect(pairs).toEqual([
      [1, 2],
      [2, 3],
    ]);
    for (const edge of envelope.graph.edges) {
      expect(edge.pos).toEqual([10, 10]);
    }

    const note = notes.find((n) => n.code === "multi-joint-split");
    expect(note).toBeDefined();
    expect(note!.jointIds).toEqual([jBC, jCD]);
    expect(note!.split).toBeDefined();
    expect(note!.split!.hubNode).toBe(2);
    expect(note!.split!.edges).toHaveLength(2);
    expect(note!.split!.keptJointIds).toEqual([jBC, jCD]);
    expect(note!.split!.droppedJointIds).toHaveLength(0);

    // Both group joints map to their star edges.
    expect(edgeOfJoint.get(jBC)).toEqual([1, 2]);
    expect(edgeOfJoint.get(jCD)).toEqual([2, 3]);

    // The motor joint's input carries over to its star edge.
    const inputEdges = envelope.graph.edges.filter((e) => e.input === true);
    expect(inputEdges).toHaveLength(1);
    expect(inputEdges[0].source).toBe(1);
  });

  it("drops the redundant triangle joint and lists it in the note", () => {
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

    const { envelope, notes, edgeOfJoint } = exportGraphthe(doc);

    // 3 participants -> exactly 2 star edges.
    expect(envelope.graph.edges).toHaveLength(2);
    const note = notes.find((n) => n.code === "multi-joint-split")!;
    expect(note.split!.droppedJointIds).toEqual([jCD]);
    expect(edgeOfJoint.get(jCD)).toBeNull();
    expect(edgeOfJoint.get(jBC)).toBeDefined();
    expect(edgeOfJoint.get(jBD)).toBeDefined();
  });

  it("makes ground the hub: both ground-pivot edges stay ground edges with input carried over", () => {
    const ground = buildLink({
      name: "ground",
      isGround: true,
      origin: [0, 0],
      sites: { p: [10, 10] },
    });
    const C = buildLink({ name: "C", origin: [0, 0], sites: { p: [10, 10], r: [10, -30] } });
    const D = buildLink({ name: "D", origin: [0, 0], sites: { p: [10, 10], s: [-25, 10] } });
    const [jGC, jGD] = [createId("joint"), createId("joint")];
    const doc = makeDoc({
      schemaVersion: 1,
      name: "ground hub",
      links: [ground.link, C.link, D.link],
      joints: [
        { id: jGC, name: "GC", type: "R", siteA: ground.siteIds.p, siteB: C.siteIds.p },
        { id: jGD, name: "GD", type: "R", siteA: ground.siteIds.p, siteB: D.siteIds.p },
      ],
      motors: [
        {
          id: createId("motor"),
          name: "m",
          jointId: jGC,
          kind: "rotary",
          drive: { mode: "constant", speed: 1 },
        },
      ],
    } satisfies MechanismDocumentInput);

    const { envelope, notes } = exportGraphthe(doc);
    const pairs = envelope.graph.edges.map((e) => [e.source, e.target] as const).sort();
    expect(pairs).toEqual([
      [0, 1],
      [0, 2],
    ]);
    const note = notes.find((n) => n.code === "multi-joint-split")!;
    expect(note.split!.hubNode).toBe(0);
    const inputEdges = envelope.graph.edges.filter((e) => e.input === true);
    expect(inputEdges).toHaveLength(1);
    expect(inputEdges[0].source).toBe(0);
  });

  it("round trips byte-identically for a multi-joint doc (the re-imported star is canonical)", () => {
    const { doc } = multiJointChainDoc();
    const e1 = exportGraphthe(doc).text;
    const e2 = exportGraphthe(importGraphthe(parseGraphtheText(e1))).text;
    expect(e2).toBe(e1);

    // Triangle: the dropped joint never re-appears; the star is canonical.
    const e1t = exportGraphthe(triangleDocWithJoints()).text;
    const e2t = exportGraphthe(importGraphthe(parseGraphtheText(e1t))).text;
    expect(e2t).toBe(e1t);
  });

  /** The triangle doc built with real joint ids (schema needs valid site refs). */
  function triangleDocWithJoints(): MechanismDocument {
    const B = buildLink({ name: "B", origin: [0, 0], sites: { p: [10, 10], q: [30, 10] } });
    const C = buildLink({ name: "C", origin: [0, 0], sites: { p: [10, 10], r: [10, -30] } });
    const D = buildLink({ name: "D", origin: [0, 0], sites: { p: [10, 10], s: [-25, 10] } });
    const [jBC, jCD, jBD] = [createId("joint"), createId("joint"), createId("joint")];
    return makeDoc({
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
  }

  it("keeps the ordinary two-link pin and the slider-crank shape out of grouping", () => {
    // slider-crank: R(2,3) and P(0,3) coincide at reference — no split note.
    const ground = buildLink({
      name: "ground",
      isGround: true,
      origin: [0, 0],
      sites: { o: [0, 0], rail: [50, 20] },
    });
    const crank = buildLink({ name: "crank", origin: [0, 0], sites: { p: [0, 0], q: [50, 20] } });
    const slider = buildLink({
      name: "slider",
      origin: [50, 20],
      sites: { s: [50, 20], t: [50, 20] },
    });
    const [jR, jP] = [createId("joint"), createId("joint")];
    const doc = makeDoc({
      schemaVersion: 1,
      name: "slider-crank",
      links: [ground.link, crank.link, slider.link],
      joints: [
        { id: jR, name: "R", type: "R", siteA: slider.siteIds.s, siteB: crank.siteIds.q },
        {
          id: jP,
          name: "P",
          type: "P",
          siteA: ground.siteIds.rail,
          siteB: slider.siteIds.t,
          axis: [1, 0],
        },
      ],
      motors: [],
    } satisfies MechanismDocumentInput);

    const { notes } = exportGraphthe(doc);
    expect(notes.some((n) => n.code === "multi-joint-split")).toBe(false);
  });
});

describe("exportGraphthe: link_type from exported degree", () => {
  it("labels each moving node with linkTypeForJointCount(exported degree), matching linkTypeOf", () => {
    const { doc } = fourBarDoc();
    const { envelope } = exportGraphthe(doc);
    const index = indexDocument(doc);

    expect(envelope.graph.nodes.slice(1).every((n) => n.link_type === "binary")).toBe(true);
    for (const node of envelope.graph.nodes.slice(1)) {
      const link = index.links.get(node.link_names![0]);
      if (!link) continue;
      expect(node.link_type).toBe(linkTypeOf(doc, link));
    }
  });
});

describe("serializeGraphthe: contract key order", () => {
  it("writes the exact key order at every level", () => {
    const { doc } = fourBarDoc();
    const text = serializeGraphthe(exportGraphthe(doc).envelope);
    const parsed = JSON.parse(text) as Record<string, unknown>;

    expect(Object.keys(parsed)).toEqual([
      "format",
      "version",
      "name",
      "units",
      "source",
      "graph",
      "markers",
    ]);
    const source = parsed.source as Record<string, unknown>;
    expect(Object.keys(source)).toEqual(["app", "version"]);
    const graph = parsed.graph as Record<string, unknown>;
    expect(Object.keys(graph)).toEqual(["directed", "multigraph", "graph", "nodes", "edges"]);
    for (const node of graph.nodes as Record<string, unknown>[]) {
      expect(Object.keys(node)).toEqual(["id", "link_type", "link_names"]);
    }
    const edges = graph.edges as Record<string, unknown>[];
    const motorEdge = edges.find((e) => e.input === true);
    expect(motorEdge).toBeDefined();
    expect(Object.keys(motorEdge!)).toEqual(["source", "target", "pos", "input"]);
    const plainEdge = edges.find((e) => e.input === undefined);
    expect(Object.keys(plainEdge!)).toEqual(["source", "target", "pos"]);
    for (const marker of parsed.markers as Record<string, unknown>[]) {
      expect(Object.keys(marker)).toEqual(["link", "pos", "name"]);
    }
    expect(text.endsWith("\n")).toBe(true);
  });

  it("puts type/axis after input on prismatic edges", () => {
    const angle = Math.PI / 6;
    const railOwner = buildLink({ name: "owner", origin: [0, 0], angle, sites: { s: [0, 0] } });
    const slider = buildLink({ name: "slider", origin: [0, 0], sites: { t: [50, 20] } });
    const jointId = createId("joint");
    const doc = makeDoc({
      schemaVersion: 1,
      name: "slider-motor",
      links: [railOwner.link, slider.link],
      joints: [
        {
          id: jointId,
          name: "p",
          type: "P",
          siteA: railOwner.siteIds.s,
          siteB: slider.siteIds.t,
          axis: [1, 0],
        },
      ],
      motors: [
        {
          id: createId("motor"),
          name: "m",
          jointId,
          kind: "linear",
          drive: { mode: "constant", speed: 1 },
        },
      ],
    });

    const text = serializeGraphthe(exportGraphthe(doc).envelope);
    const parsed = JSON.parse(text) as Record<string, unknown>;
    const graph = parsed.graph as Record<string, unknown>;
    const edge = (graph.edges as Record<string, unknown>[]).find((e) => e.type === "prismatic");
    expect(edge).toBeDefined();
    expect(Object.keys(edge!)).toEqual(["source", "target", "pos", "input", "type", "axis"]);
  });
});

describe("exportGraphthe: purity", () => {
  it("never mutates the document and emits no document ids", () => {
    const { doc } = fourBarDoc();
    const before = structuredClone(doc);
    const { text } = exportGraphthe(doc);
    expect(doc).toEqual(before);

    for (const link of doc.links) expect(text).not.toContain(link.id);
    for (const site of doc.links.flatMap((l) => l.sites)) expect(text).not.toContain(site.id);
    for (const joint of doc.joints) expect(text).not.toContain(joint.id);
    for (const marker of doc.markers) expect(text).not.toContain(marker.id);
  });
});

describe("parseGraphtheText", () => {
  const v1Text = (() => {
    const { doc } = fourBarDoc();
    return serializeGraphthe(exportGraphthe(doc).envelope);
  })();

  const v0Envelope: {
    format: string;
    version: number;
    name: string;
    graph: {
      nodes: { id: number; link_type?: string }[];
      edges: Record<string, unknown>[];
    };
    markers: Record<string, unknown>[];
  } = {
    format: "simuplandes-parity-fixture",
    version: 0,
    name: "v0",
    graph: {
      nodes: [
        { id: 0, link_type: "ground" },
        { id: 1, link_type: "binary" },
      ],
      edges: [{ source: 0, target: 1, pos: [1, 2], input: true }],
    },
    markers: [{ link: 1, pos: [3, 4] }],
  };
  const v0Text = JSON.stringify(v0Envelope);

  it("accepts a v1 envelope unchanged", () => {
    const env = parseGraphtheText(v1Text);
    expect(env.format).toBe(GRAPHTHE_FORMAT);
    expect(env.version).toBe(1);
    expect(env.graph.directed).toBe(false);
    expect(env.graph.multigraph).toBe(false);
    expect(env.graph.graph).toEqual({});
  });

  it("normalizes a v0 .gtm.json to the v1 shape", () => {
    const env = parseGraphtheText(v0Text);
    expect(env.format).toBe(GRAPHTHE_FORMAT);
    expect(env.version).toBe(1);
    expect(env.name).toBe("v0");
    expect(env.graph.directed).toBe(false);
    expect(env.graph.multigraph).toBe(false);
    expect(env.graph.graph).toEqual({});
    expect(env.units).toBeUndefined();
    expect(env.source).toBeUndefined();
    expect(env.graph.nodes[0].link_names).toBeUndefined();
    expect(env.markers[0].name).toBeUndefined();
    expect(env.markers[0].pos).toEqual([3, 4]);
  });

  it("throws on unknown format and unsupported versions", () => {
    expect(() => parseGraphtheText('{"format": "other", "version": 1}')).toThrow(/unknown format/);
    expect(() =>
      parseGraphtheText(JSON.stringify({ format: GRAPHTHE_FORMAT, version: 2 })),
    ).toThrow(/unsupported version/);
    expect(() =>
      parseGraphtheText(JSON.stringify({ format: "simuplandes-parity-fixture", version: 7 })),
    ).toThrow(/unsupported version/);
  });

  it("throws on an edge referencing an unknown node", () => {
    const env = structuredClone(v0Envelope);
    env.graph.edges[0].target = 9;
    expect(() => parseGraphtheText(JSON.stringify(env))).toThrow(/unknown node/);
  });

  it("throws on a duplicate node pair", () => {
    const env = structuredClone(v0Envelope);
    env.graph.edges.push({ source: 1, target: 0, pos: [5, 6] });
    expect(() => parseGraphtheText(JSON.stringify(env))).toThrow(/duplicate edge/);
  });

  it("throws on a prismatic edge without a non-zero finite axis", () => {
    const env = structuredClone(v0Envelope);
    env.graph.edges[0] = { source: 0, target: 1, pos: [1, 2], type: "prismatic" };
    expect(() => parseGraphtheText(JSON.stringify(env))).toThrow(/axis/);
    env.graph.edges[0].axis = [0, 0];
    expect(() => parseGraphtheText(JSON.stringify(env))).toThrow(/axis/);
  });

  it("throws on an axis on a revolute edge", () => {
    const env = structuredClone(v0Envelope);
    env.graph.edges[0].axis = [1, 0];
    expect(() => parseGraphtheText(JSON.stringify(env))).toThrow(/must not carry an axis/);
  });

  it("throws on a marker referencing an unknown node", () => {
    const env = structuredClone(v0Envelope);
    env.markers[0].link = 42;
    expect(() => parseGraphtheText(JSON.stringify(env))).toThrow(/unknown node 42/);
  });

  it("does NOT require exactly one input edge and allows a prismatic input edge", () => {
    const env = structuredClone(v0Envelope);
    delete env.graph.edges[0].input;
    expect(() => parseGraphtheText(JSON.stringify(env))).not.toThrow();

    env.graph.edges[0] = {
      source: 0,
      target: 1,
      pos: [1, 2],
      input: true,
      type: "prismatic",
      axis: [1, 0],
    };
    expect(() => parseGraphtheText(JSON.stringify(env))).not.toThrow();
  });
});
