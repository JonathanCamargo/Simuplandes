import { describe, it, expect } from "vitest";
import { findMultiJointGroups, planStarSplit, MULTI_JOINT_TOLERANCE_SCALE } from "./multiJoint";
import { buildLink, makeDoc } from "./__fixtures__/testDocs";
import { indexDocument, createId, type MechanismDocumentInput } from "../model";

/** Three links pinned at one point as a chain: joints B-C and C-D at the same world point. */
function chainDoc() {
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
    motors: [],
  } satisfies MechanismDocumentInput);
  return { doc, B, C, D, jBC, jCD };
}

/** nodeOfLink for a doc with no ground: links in document order get nodes 1..n. */
function nodeOfLinkOf(doc: Parameters<typeof findMultiJointGroups>[0]): Map<string, number> {
  const map = new Map<string, number>();
  doc.links.forEach((link, i) => map.set(link.id, i + 1));
  return map;
}

describe("findMultiJointGroups", () => {
  it("finds one group for a 3-link chain at one point", () => {
    const { doc } = chainDoc();
    const { groups } = findMultiJointGroups(doc, nodeOfLinkOf(doc));
    expect(groups).toHaveLength(1);
    expect(groups[0].nodes).toHaveLength(3);
    expect(groups[0].point).toEqual({ x: 10, y: 10 });
  });

  it("finds no group for two coincident joints that share no link (crossing bars)", () => {
    // Bar AxB crossing bar CyD at [0,0]: joint(A,B) and joint(C,D) both at
    // the crossing point but no shared link -> not adjacent -> no group.
    const A = buildLink({ name: "A", origin: [-10, 0], sites: { p: [0, 0], q: [20, 0] } });
    const B2 = buildLink({ name: "B2", origin: [-10, 0], sites: { p: [0, 0], r: [20, 0] } });
    const C2 = buildLink({ name: "C2", origin: [0, -10], sites: { s: [0, 0], t: [0, 20] } });
    const D2 = buildLink({ name: "D2", origin: [0, -10], sites: { u: [0, 0], v: [0, 20] } });
    const j1 = createId("joint");
    const j2 = createId("joint");
    const doc = makeDoc({
      schemaVersion: 1,
      name: "crossing",
      links: [A.link, B2.link, C2.link, D2.link],
      joints: [
        { id: j1, name: "j1", type: "R", siteA: A.siteIds.p, siteB: C2.siteIds.s },
        { id: j2, name: "j2", type: "R", siteA: B2.siteIds.p, siteB: D2.siteIds.u },
      ],
      motors: [],
    } satisfies MechanismDocumentInput);
    const { groups } = findMultiJointGroups(doc, nodeOfLinkOf(doc));
    expect(groups).toHaveLength(0);
  });

  it("finds no group for an ordinary two-link pin (one joint, 2 nodes)", () => {
    const A = buildLink({ name: "A", origin: [0, 0], sites: { p: [0, 0], q: [30, 0] } });
    const B2 = buildLink({ name: "B2", origin: [0, 0], sites: { p: [0, 0], r: [0, 20] } });
    const doc = makeDoc({
      schemaVersion: 1,
      name: "ordinary pin",
      links: [A.link, B2.link],
      joints: [
        { id: createId("joint"), name: "j", type: "R", siteA: A.siteIds.p, siteB: B2.siteIds.p },
      ],
      motors: [],
    } satisfies MechanismDocumentInput);
    const { groups } = findMultiJointGroups(doc, nodeOfLinkOf(doc));
    expect(groups).toHaveLength(0);
  });

  it("excludes prismatic joints entirely (slider-crank shape is NOT a multi-joint)", () => {
    const ground = buildLink({
      name: "ground",
      isGround: true,
      origin: [0, 0],
      sites: { o: [0, 0], rail: [50, 20] },
    });
    const crank = buildLink({ name: "crank", origin: [0, 0], sites: { p: [0, 0], q: [40, 0] } });
    const slider = buildLink({
      name: "slider",
      origin: [50, 20],
      sites: { s: [50, 20], t: [50, 20] },
    });
    const jR = createId("joint");
    const jP = createId("joint");
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

    const nodeMap = new Map<string, number>([
      [ground.link.id, 0],
      [crank.link.id, 1],
      [slider.link.id, 2],
    ]);
    const { groups } = findMultiJointGroups(doc, nodeMap);
    expect(groups).toHaveLength(0);
  });

  it("returns a tolerance scaled by the bounding-box diagonal", () => {
    const { doc } = chainDoc();
    const { tolerance } = findMultiJointGroups(doc, nodeOfLinkOf(doc));
    // bbox diagonal of {10,10},{30,10},{10,-20} = hypot(20,30) ~ 36.06
    expect(tolerance).toBeGreaterThanOrEqual(MULTI_JOINT_TOLERANCE_SCALE * 1);
    expect(tolerance).toBeLessThan(1e-6);
  });
});

describe("planStarSplit", () => {
  it("plans a star: hub = most-joints participant (tie -> lowest node id); reuses existing joints", () => {
    const { doc } = chainDoc();
    const nodeOfLink = nodeOfLinkOf(doc);
    const { groups } = findMultiJointGroups(doc, nodeOfLink);
    const index = indexDocument(doc);
    const plan = planStarSplit(groups[0], index, nodeOfLink);

    // B(node1) and C(node2) each have 2 joints in-doc overall; C is in both
    // group joints (BC, CD) so C has the most group incidence -> hub.
    expect(plan.hubNode).toBe(2);
    expect(plan.edges).toHaveLength(2);
    const pairs = plan.edges.map((e) => e.nodes).sort((a, b) => a[0] - b[0]);
    expect(pairs).toEqual([
      [1, 2],
      [2, 3],
    ]);
    // Both edges reuse existing joints (B-C and C-D are exactly the star).
    expect(plan.edges.every((e) => e.jointId !== null)).toBe(true);
    expect(plan.droppedJointIds).toHaveLength(0);
  });

  it("drops the redundant joint in a triangle (participants - 1 edges)", () => {
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

    const nodeOfLink = nodeOfLinkOf(doc);
    const { groups } = findMultiJointGroups(doc, nodeOfLink);
    expect(groups).toHaveLength(1);
    const plan = planStarSplit(groups[0], indexDocument(doc), nodeOfLink);

    // Hub: B and C both have 2 group joints -> tie -> lowest node id (B, node 1).
    expect(plan.hubNode).toBe(1);
    expect(plan.edges).toHaveLength(2); // 3 participants - 1
    expect(plan.droppedJointIds).toHaveLength(1);
    // The star keeps hub-B edges (BC, BD); the C-D joint closes the cycle the star does not need.
    expect(plan.droppedJointIds[0]).toBe(jCD);
    expect(plan.keptJointIds).toEqual([jBC, jBD]);
  });

  it("makes ground the hub when it participates (both ground-pivot edges stay ground edges)", () => {
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
      motors: [],
    } satisfies MechanismDocumentInput);

    const nodeOfLink = new Map<string, number>([
      [ground.link.id, 0],
      [C.link.id, 1],
      [D.link.id, 2],
    ]);
    const { groups } = findMultiJointGroups(doc, nodeOfLink);
    expect(groups).toHaveLength(1);
    const plan = planStarSplit(groups[0], indexDocument(doc), nodeOfLink);

    expect(plan.hubNode).toBe(0);
    expect(plan.edges.map((e) => e.nodes)).toEqual([
      [0, 1],
      [0, 2],
    ]);
    expect(plan.keptJointIds).toEqual([jGC, jGD]);
    expect(plan.droppedJointIds).toHaveLength(0);
  });

  it("synthesizes an edge when the hub-participant joint is absent", () => {
    // Chain B-C-D but hub would be C; add a 4th link E attached only to B
    // at the same point so the group spans B, C, D, E with no C-E joint.
    const B = buildLink({ name: "B", origin: [0, 0], sites: { p: [10, 10], q: [30, 10] } });
    const C = buildLink({ name: "C", origin: [0, 0], sites: { p: [10, 10], r: [10, -30] } });
    const D = buildLink({ name: "D", origin: [0, 0], sites: { p: [10, 10], s: [-25, 10] } });
    const E = buildLink({ name: "E", origin: [0, 0], sites: { p: [10, 10], t: [10, 40] } });
    const [jBC, jCD, jBE] = [createId("joint"), createId("joint"), createId("joint")];
    const doc = makeDoc({
      schemaVersion: 1,
      name: "synthesized",
      links: [B.link, C.link, D.link, E.link],
      joints: [
        { id: jBC, name: "BC", type: "R", siteA: B.siteIds.p, siteB: C.siteIds.p },
        { id: jCD, name: "CD", type: "R", siteA: C.siteIds.p, siteB: D.siteIds.p },
        { id: jBE, name: "BE", type: "R", siteA: B.siteIds.p, siteB: E.siteIds.p },
      ],
      motors: [],
    } satisfies MechanismDocumentInput);

    const nodeOfLink = nodeOfLinkOf(doc);
    const { groups } = findMultiJointGroups(doc, nodeOfLink);
    expect(groups).toHaveLength(1);
    const plan = planStarSplit(groups[0], indexDocument(doc), nodeOfLink);

    // Hub: C has 2 group joints (BC, CD); B has 2 too (BC, BE) -> tie -> lowest node id = B's node 1.
    expect(plan.hubNode).toBe(1);
    expect(plan.edges).toHaveLength(3); // 4 participants - 1
    const withJoint = plan.edges.filter((e) => e.jointId !== null);
    const synthesized = plan.edges.filter((e) => e.jointId === null);
    expect(withJoint).toHaveLength(2); // B-C and B-E reused
    expect(synthesized).toHaveLength(1); // B-D synthesized (D only joined C)
  });
});
