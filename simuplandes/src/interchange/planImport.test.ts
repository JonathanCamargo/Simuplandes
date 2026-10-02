import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { indexDocument, siteWorldPosition, type MechanismDocument } from "../model";
import { studioImportDeps } from "../sim/importDeps";
import {
  disconnected,
  duplicateAndSelfLoop,
  inputNotOnGround,
  lengthsOnly,
  missingInput,
  multiJointStar,
  nodeLinkText,
  noGround,
  partialPositions,
  positionedFourBar,
  prismaticNoAxis,
  severalInputs,
  topologyOnlyEightBar,
  unknownJointType,
  FOURBAR_EDGES,
} from "./__fixtures__/importCases";
import {
  MOBILITY_TARGET_DEG,
  type ImportDeps,
  type ImportReportItem,
  type LayoutRequest,
  type LayoutResult,
  type MobilityVerdict,
} from "./importReport";
import { planImport, type ImportPlan } from "./planImport";

const FIXTURES_DIR = join(import.meta.dirname, "..", "..", "fixtures");

function circleLayout(
  req: LayoutRequest,
  overrides: Partial<LayoutResult> = {},
): Promise<LayoutResult> {
  const anchors = Array.from({ length: req.nodeCount }, (_, k) => {
    const t = (2 * Math.PI * k) / req.nodeCount;
    return [100 * Math.cos(t), 100 * Math.sin(t)] as const;
  });
  const positions = req.edges.map((e) => {
    const a = anchors[e.u];
    const b = anchors[e.v];
    return [(a[0] + b[0]) / 2 + e.u, (a[1] + b[1]) / 2 - e.v] as const;
  });
  return Promise.resolve({
    status: "ok",
    positions,
    rangeDeg: 90,
    tries: 3,
    lengthResidual: null,
    ...overrides,
  });
}

const layoutDeps = (overrides: Partial<LayoutResult> = {}): ImportDeps => ({
  layout: (req) => circleLayout(req, overrides),
});

const verdict = (over: Partial<MobilityVerdict> = {}): MobilityVerdict => ({
  status: "ready",
  gruebler: 1,
  rankDof: 1,
  inputKind: "rotary",
  rangeDeg: 360,
  linearTravel: null,
  fullRotation: true,
  ...over,
});

const codes = (plan: ImportPlan): string[] => plan.items.map((i) => i.code);
const item = (plan: ImportPlan, code: string): ImportReportItem => {
  const found = plan.items.find((i) => i.code === code);
  if (!found) throw new Error(`no ${code} item in [${codes(plan).join(", ")}]`);
  return found;
};
const fixIds = (it: ImportReportItem): string[] => it.fixes.map((f) => f.id);
const motorJoint = (doc: MechanismDocument): string =>
  doc.joints.find((j) => j.id === doc.motors[0].jointId)!.name;
const jointNames = (doc: MechanismDocument): string[] => doc.joints.map((j) => j.name);

/** Applies a fix by re-running with its option merged in. */
async function applyFix(
  text: string,
  it: ImportReportItem,
  fixId: string,
  deps: ImportDeps = {},
): Promise<ImportPlan> {
  const fix = it.fixes.find((f) => f.id === fixId);
  if (!fix) throw new Error(`no fix ${fixId}`);
  return planImport(text, fix.option, deps);
}

describe("planImport: positioned graphs", () => {
  it("builds a positioned four-bar with one motor and no warnings", async () => {
    const plan = await planImport(positionedFourBar(), {}, studioImportDeps);
    expect(plan.fatal).toBe(false);
    expect(plan.mode).toBe("positions");
    expect(plan.items).toEqual([]);
    expect(plan.counts).toEqual({ error: 0, warning: 0, info: 0 });
    expect(plan.doc!.motors).toHaveLength(1);
    expect(motorJoint(plan.doc!)).toBe("0-1");
    expect(plan.verdict).toMatchObject({ status: "ready", rankDof: 1, rangeDeg: 360 });
  });

  it("maps every link to its node, ground links to 0", async () => {
    const plan = await planImport(positionedFourBar());
    const doc = plan.doc!;
    expect(plan.verdict).toBeNull();
    for (const link of doc.links) {
      const node = plan.nodeOfLink.get(link.id);
      expect(node).toBe(link.isGround ? 0 : Number(link.name.replace("link-", "")));
    }
  });

  it("keeps markers and units in positions mode", async () => {
    const text = JSON.stringify({
      units: "m",
      name: "mk",
      nodes: [{ id: 0 }, { id: 1 }, { id: 2 }, { id: 3 }],
      edges: FOURBAR_EDGES,
      markers: [{ link: 2, pos: [50, 60], name: "tip" }],
    });
    const plan = await planImport(text);
    expect(plan.doc!.markers.map((m) => m.name)).toEqual(["tip"]);
    expect(plan.doc!.units.length).toBe("m");
    expect(plan.doc!.name).toBe("mk");
  });

  it("lets the real verifier flag a low-mobility golden, and a layout fix re-runs", async () => {
    const text = readFileSync(join(FIXTURES_DIR, "stephenson-ii.graphthe.json"), "utf8");
    const plan = await planImport(text, {}, studioImportDeps);
    const low = item(plan, "low-mobility");
    expect(low.params.threshold).toBe(MOBILITY_TARGET_DEG);
    expect(low.params.rangeDeg as number).toBeLessThan(MOBILITY_TARGET_DEG);
    expect(fixIds(low)).toEqual(["layout"]);
    const relaid = await applyFix(text, low, "layout", { ...studioImportDeps, ...layoutDeps() });
    expect(relaid.mode).toBe("layout");
    expect(codes(relaid)).toContain("layout-applied");
  }, 60_000);

  it("has no warnings for the v1 golden through the real verifier", async () => {
    const text = readFileSync(join(FIXTURES_DIR, "eightbar-T15.graphthe.json"), "utf8");
    const plan = await planImport(text, {}, studioImportDeps);
    expect(plan.items).toEqual([]);
    expect(plan.verdict!.rangeDeg).toBeGreaterThan(MOBILITY_TARGET_DEG);
  }, 60_000);
});

describe("planImport: input selection", () => {
  it("missing-input: convention edge first and active, plus none", async () => {
    const text = missingInput();
    const plan = await planImport(text);
    const it1 = item(plan, "missing-input");
    expect(fixIds(it1)).toEqual(["input-0-1", "input-0-3", "none"]);
    expect(it1.activeFixId).toBe("input-0-1");
    expect(it1.severity).toBe("warning");
    expect(motorJoint(plan.doc!)).toBe("0-1");

    const moved = await applyFix(text, it1, "input-0-3");
    expect(motorJoint(moved.doc!)).toBe("0-3");
    expect(item(moved, "missing-input").activeFixId).toBe("input-0-3");

    const none = await applyFix(text, it1, "none");
    expect(none.doc!.motors).toEqual([]);
    expect(item(none, "missing-input").activeFixId).toBe("none");
  });

  it("uses the first neighbour when none has degree 2", async () => {
    const text = nodeLinkText(
      [0, 1, 2, 3],
      [
        { source: 0, target: 1, pos: [0, 0] },
        { source: 0, target: 2, pos: [1, 0] },
        { source: 0, target: 3, pos: [2, 0] },
        { source: 1, target: 2, pos: [0, 5] },
        { source: 1, target: 3, pos: [1, 5] },
        { source: 2, target: 3, pos: [2, 5] },
      ],
    );
    const plan = await planImport(text);
    expect(item(plan, "missing-input").fixes[0].id).toBe("input-0-1");
  });

  it("several-inputs: each marked ground input, first active", async () => {
    const text = severalInputs();
    const plan = await planImport(text);
    const it1 = item(plan, "several-inputs");
    expect(fixIds(it1)).toEqual(["input-0-1", "input-0-3"]);
    expect(it1.activeFixId).toBe("input-0-1");
    expect(it1.params.count).toBe(2);
    expect(plan.doc!.motors).toHaveLength(1);
    const moved = await applyFix(text, it1, "input-0-3");
    expect(motorJoint(moved.doc!)).toBe("0-3");
  });

  it("several-inputs with none on ground falls back to the ground candidates plus none", async () => {
    const edges = FOURBAR_EDGES.map((e) => ({
      ...e,
      input: e.source === 1 || e.source === 2 ? true : undefined,
    }));
    const plan = await planImport(nodeLinkText([0, 1, 2, 3], edges));
    const it1 = item(plan, "several-inputs");
    expect(fixIds(it1)).toEqual(["input-0-1", "input-0-3", "none"]);
    expect(it1.activeFixId).toBe("input-0-1");
  });

  it("input-not-on-ground: convention fix active", async () => {
    const text = inputNotOnGround();
    const plan = await planImport(text);
    const it1 = item(plan, "input-not-on-ground");
    expect(fixIds(it1)).toEqual(["input-0-1", "input-0-3", "none"]);
    expect(it1.activeFixId).toBe("input-0-1");
    expect(it1.edgeKeys).toEqual(["1-2"]);
    expect(motorJoint(plan.doc!)).toBe("0-1");
    const moved = await applyFix(text, it1, "input-0-3");
    expect(motorJoint(moved.doc!)).toBe("0-3");
  });

  it("falls back to auto for an explicit input that does not exist", async () => {
    const plan = await planImport(missingInput(), { input: { u: 5, v: 6 } });
    expect(motorJoint(plan.doc!)).toBe("0-1");
    expect(item(plan, "missing-input").activeFixId).toBe("input-0-1");
  });

  it("accepts an explicit input given in either order", async () => {
    const plan = await planImport(positionedFourBar(), { input: { u: 3, v: 0 } });
    expect(motorJoint(plan.doc!)).toBe("0-3");
    expect(plan.items).toEqual([]);
  });

  it("drives a prismatic input edge with a linear motor", async () => {
    const plan = await planImport(prismaticNoAxis(), { input: { u: 0, v: 3 } });
    expect(plan.doc!.motors[0].kind).toBe("linear");
  });
});

describe("planImport: ground", () => {
  it("no-ground: one fix per node, lowest active; applying relabels the ground", async () => {
    const text = noGround();
    const plan = await planImport(text);
    const it1 = item(plan, "no-ground");
    expect(fixIds(it1)).toEqual(["ground-0", "ground-1", "ground-2", "ground-3"]);
    expect(it1.activeFixId).toBe("ground-0");
    expect(plan.doc!.links.filter((l) => l.isGround)).toHaveLength(1);

    const chosen = await applyFix(text, it1, "ground-2");
    expect(item(chosen, "no-ground").activeFixId).toBe("ground-2");
    const doc = chosen.doc!;
    const index = indexDocument(doc);
    const ground = doc.links.find((l) => l.isGround)!;
    const expected = chosen
      .graph!.edges.filter((e) => e.u === 2 || e.v === 2)
      .map((e) => e.pos!.join(","))
      .sort();
    const got = ground.sites
      .map((s) => {
        const p = siteWorldPosition(index.sites.get(s.id)!.link, s.local);
        return `${p.x},${p.y}`;
      })
      .sort();
    expect(got).toHaveLength(expected.length);
    expect(chosen.nodeOfLink.get(ground.id)).toBe(0);
  });

  it("an explicit ground swaps it with node 0 without a no-ground item", async () => {
    const plan = await planImport(positionedFourBar(), { ground: 2 });
    expect(codes(plan)).not.toContain("no-ground");
    const ground = plan.doc!.links.find((l) => l.isGround)!;
    const index = indexDocument(plan.doc!);
    const worlds = ground.sites.map((s) => {
      const p = siteWorldPosition(index.sites.get(s.id)!.link, s.local);
      return [p.x, p.y];
    });
    expect(worlds).toContainEqual([110, 80]);
  });

  it("falls back to auto for an out-of-range ground", async () => {
    const plan = await planImport(noGround(), { ground: 99 });
    expect(item(plan, "no-ground").activeFixId).toBe("ground-0");
  });

  it("keeps a graph whose ground is named by its string id '0'", async () => {
    const text = nodeLinkText(
      ["0", "1", "2", "3"],
      FOURBAR_EDGES.map((e) => ({ ...e, source: String(e.source), target: String(e.target) })),
    );
    const plan = await planImport(text);
    expect(codes(plan)).not.toContain("no-ground");
    expect(plan.doc).not.toBeNull();
  });
});

describe("planImport: joints", () => {
  it("unsupported-joint: revolute active, skip removes the joint", async () => {
    const text = unknownJointType();
    const plan = await planImport(text);
    const it1 = item(plan, "unsupported-joint");
    expect(fixIds(it1)).toEqual(["revolute", "skip"]);
    expect(it1.activeFixId).toBe("revolute");
    expect(it1.params.type).toBe("spherical");
    expect(it1.edgeKeys).toEqual(["1-2"]);
    expect(jointNames(plan.doc!)).toContain("1-2");

    const skipped = await applyFix(text, it1, "skip");
    expect(jointNames(skipped.doc!)).not.toContain("1-2");
    expect(item(skipped, "unsupported-joint").activeFixId).toBe("skip");
  });

  it("prismatic-no-axis: default axis active, revolute alternative", async () => {
    const text = prismaticNoAxis();
    const plan = await planImport(text);
    const it1 = item(plan, "prismatic-no-axis");
    expect(fixIds(it1)).toEqual(["default-axis", "revolute"]);
    expect(it1.activeFixId).toBe("default-axis");
    const p = plan.doc!.joints.find((j) => j.type === "P")!;
    expect(p.type === "P" && p.axis).toEqual([1, 0]);

    const asR = await applyFix(text, it1, "revolute");
    expect(asR.doc!.joints.some((j) => j.type === "P")).toBe(false);
  });

  it("treats a zero-length axis as missing", async () => {
    const text = nodeLinkText(
      [0, 1],
      [{ source: 0, target: 1, pos: [0, 0], type: "prismatic", axis: [0, 0] }],
    );
    expect(codes(await planImport(text))).toContain("prismatic-no-axis");
  });

  it("keeps a real prismatic joint with its axis", async () => {
    const text = readFileSync(join(FIXTURES_DIR, "slider-crank.graphthe.json"), "utf8");
    const plan = await planImport(text, {}, studioImportDeps);
    expect(plan.items).toEqual([]);
    expect(plan.doc!.joints.some((j) => j.type === "P")).toBe(true);
  });

  it("drops self-loops and duplicate edges from the built document", async () => {
    const plan = await planImport(duplicateAndSelfLoop());
    expect(codes(plan)).toEqual(expect.arrayContaining(["self-loop", "duplicate-edge"]));
    expect(plan.doc!.joints).toHaveLength(4);
  });

  it("reports multi-joint stars as an info item with a keep fix", async () => {
    const plan = await planImport(multiJointStar());
    const info = item(plan, "multi-joint");
    expect(info.severity).toBe("info");
    expect(info.nodeIds).toEqual([0, 1, 2]);
    expect(info.params.links).toBe(3);
    expect(fixIds(info)).toEqual(["keep-star"]);
    expect(info.activeFixId).toBe("keep-star");
  });
});

describe("planImport: components", () => {
  it("disconnected: drop active, keep retains the extra nodes", async () => {
    const text = disconnected();
    const plan = await planImport(text);
    const it1 = item(plan, "disconnected");
    expect(fixIds(it1)).toEqual(["drop", "keep"]);
    expect(it1.activeFixId).toBe("drop");
    expect(it1.nodeIds).toEqual([4, 5, 6]);
    expect(it1.params).toMatchObject({ nodes: 3, components: 2 });
    expect(plan.doc!.links).toHaveLength(4);

    const kept = await applyFix(text, it1, "keep");
    expect(kept.doc!.links).toHaveLength(7);
    expect(item(kept, "disconnected").activeFixId).toBe("keep");
  });

  it("drops markers on dropped nodes and renumbers", async () => {
    const text = JSON.stringify({
      nodes: [{ id: 0 }, { id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }, { id: 5 }],
      edges: [
        { source: 0, target: 2, pos: [0, 0] },
        { source: 2, target: 3, pos: [5, 0] },
        { source: 0, target: 3, pos: [9, 4] },
        { source: 1, target: 4, pos: [50, 0] },
      ],
      markers: [
        { link: 3, pos: [1, 1] },
        { link: 4, pos: [2, 2] },
      ],
    });
    const plan = await planImport(text);
    expect(plan.doc!.links).toHaveLength(3);
    expect(plan.doc!.markers).toHaveLength(1);
    expect(plan.nodeOfLink.size).toBe(3);
  });

  it("is an empty graph when dropping leaves no edge", async () => {
    const text = nodeLinkText([0, 1, 2], [{ source: 1, target: 2, pos: [0, 0] }]);
    const plan = await planImport(text);
    expect(plan.fatal).toBe(true);
    expect(plan.doc).toBeNull();
    expect(codes(plan)).toContain("empty-graph");
    const kept = await planImport(text, { disconnected: "keep" });
    expect(kept.doc).not.toBeNull();
  });

  it("is an empty graph when skipping joints leaves none", async () => {
    const text = nodeLinkText([0, 1], [{ source: 0, target: 1, pos: [0, 0], type: "weird" }]);
    const plan = await planImport(text, { unsupportedJoints: "skip" });
    expect(plan.fatal).toBe(true);
    expect(codes(plan)).toEqual(["unsupported-joint", "empty-graph"]);
  });
});

describe("planImport: positions and layout", () => {
  it("partial-positions: layout active, centroid fills the gap", async () => {
    const text = partialPositions();
    const layout = vi.fn<NonNullable<ImportDeps["layout"]>>((req) => circleLayout(req));
    const plan = await planImport(text, {}, { layout });
    const it1 = item(plan, "partial-positions");
    expect(fixIds(it1)).toEqual(["layout", "centroid"]);
    expect(it1.activeFixId).toBe("layout");
    expect(plan.mode).toBe("layout");
    expect(layout).toHaveBeenCalledTimes(1);

    layout.mockClear();
    const filled = await applyFix(text, it1, "centroid", { layout });
    expect(layout).not.toHaveBeenCalled();
    expect(filled.mode).toBe("positions");
    expect(item(filled, "partial-positions").activeFixId).toBe("centroid");
    const doc = filled.doc!;
    const joint = doc.joints.find((j) => j.name === "1-2")!;
    const info = indexDocument(doc).sites.get(joint.siteA)!;
    const p = siteWorldPosition(info.link, info.site.local);
    expect(p.x).toBeCloseTo(55, 9);
    expect(p.y).toBeCloseTo(40, 9);
  });

  it("falls back to layout when the centroid cannot fill a gap", async () => {
    const text = nodeLinkText(
      [0, 1, 2, 3],
      [
        { source: 0, target: 1, pos: [0, 0] },
        { source: 1, target: 2 },
        { source: 2, target: 3 },
        { source: 0, target: 3 },
      ],
    );
    const plan = await planImport(text, { positions: "centroid" }, layoutDeps());
    expect(plan.mode).toBe("layout");
    expect(item(plan, "partial-positions").activeFixId).toBe("layout");
  });

  it("does not warn when layout is forced on a topology-only graph", async () => {
    const plan = await planImport(topologyOnlyEightBar(), { positions: "centroid" }, layoutDeps());
    expect(plan.mode).toBe("layout");
    expect(codes(plan)).not.toContain("partial-positions");
    const forced = await planImport(topologyOnlyEightBar(), { positions: "layout" }, layoutDeps());
    expect(codes(forced)).not.toContain("partial-positions");
  });

  it("forces layout on a partial graph with an active layout fix", async () => {
    const plan = await planImport(partialPositions(), { positions: "layout" }, layoutDeps());
    expect(item(plan, "partial-positions").activeFixId).toBe("layout");
  });

  it("forcing layout on a positioned graph discards its positions and markers", async () => {
    const text = JSON.stringify({
      nodes: [{ id: 0 }, { id: 1 }, { id: 2 }, { id: 3 }],
      edges: FOURBAR_EDGES,
      markers: [{ link: 2, pos: [50, 60] }],
    });
    const plan = await planImport(text, { positions: "layout" }, layoutDeps());
    expect(plan.mode).toBe("layout");
    expect(plan.doc!.markers).toEqual([]);
    expect(codes(plan)).toContain("layout-applied");
  });

  it("passes a normalized request to deps.layout", async () => {
    let seen: LayoutRequest | null = null;
    const deps: ImportDeps = {
      layout: (req) => {
        seen = req;
        return circleLayout(req);
      },
    };
    await planImport(lengthsOnly(), { layoutVariant: 3 }, deps);
    const req = seen as LayoutRequest | null;
    expect(req).not.toBeNull();
    expect(req!.nodeCount).toBe(4);
    expect(req!.edges).toHaveLength(4);
    expect(req!.edges.every((e) => e.kind === "R" && e.axis === null && e.u < e.v)).toBe(true);
    expect(req!.inputEdge).toBe(0);
    expect(req!.lengths).toEqual([100, 40, 100.78, 80.6]);
    expect(req!.variant).toBe(3);
  });

  it("sends null lengths and a P edge's axis for a topology-only request", async () => {
    let seen: LayoutRequest | null = null;
    const text = nodeLinkText(
      [0, 1, 2],
      [
        { source: 0, target: 1, type: "prismatic" },
        { source: 1, target: 2 },
        { source: 0, target: 2 },
      ],
    );
    await planImport(
      text,
      {},
      {
        layout: (req) => {
          seen = req;
          return circleLayout(req);
        },
      },
    );
    const req = seen as LayoutRequest | null;
    expect(req!.lengths).toBeNull();
    expect(req!.edges[0]).toMatchObject({ kind: "P", axis: [1, 0] });
  });

  it("adds layout-applied info and builds the document (topology-only 8-bar)", async () => {
    const plan = await planImport(topologyOnlyEightBar(), {}, layoutDeps());
    const info = item(plan, "layout-applied");
    expect(info.severity).toBe("info");
    expect(info.params).toMatchObject({ tries: 3, rangeDeg: 90 });
    expect(plan.doc!.links).toHaveLength(8);
    expect(plan.doc!.motors).toHaveLength(1);
    expect(plan.mode).toBe("layout");
  });

  it("reports layout-unavailable without deps.layout", async () => {
    const plan = await planImport(topologyOnlyEightBar());
    expect(plan.doc).toBeNull();
    expect(item(plan, "layout-unavailable").severity).toBe("error");
    expect(plan.fatal).toBe(false);
    expect(plan.mode).toBe("layout");
  });

  it("a cancelled layout yields no document and no layout items", async () => {
    const plan = await planImport(
      topologyOnlyEightBar(),
      {},
      layoutDeps({ status: "cancelled", positions: null }),
    );
    expect(plan.doc).toBeNull();
    // Only the mapping item (a topology-only graph has no marked input).
    expect(codes(plan)).toEqual(["missing-input"]);
  });

  it("lengths-infeasible is a non-fatal error with no document", async () => {
    const plan = await planImport(
      lengthsOnly(),
      {},
      layoutDeps({ status: "lengths-infeasible", positions: null, lengthResidual: 2.5 }),
    );
    const err = item(plan, "lengths-infeasible");
    expect(err.severity).toBe("error");
    expect(err.fatal).toBe(false);
    expect(err.params.residual).toBe(2.5);
    expect(plan.doc).toBeNull();
    const zero = await planImport(
      lengthsOnly(),
      {},
      layoutDeps({ status: "lengths-infeasible", positions: null }),
    );
    expect(item(zero, "lengths-infeasible").params.residual).toBe(0);
  });

  it("not-one-dof-topology warns with the Gruebler count and still builds", async () => {
    const plan = await planImport(
      topologyOnlyEightBar(),
      {},
      layoutDeps({ status: "not-one-dof" }),
    );
    const warn = item(plan, "not-one-dof-topology");
    expect(warn.severity).toBe("warning");
    expect(warn.params.gruebler).toBe(3 * 7 - 2 * 10);
    expect(fixIds(warn)).toEqual(["retry-layout"]);
    expect(plan.doc).not.toBeNull();
    const retry = await applyFix(topologyOnlyEightBar(), warn, "retry-layout", layoutDeps());
    expect(codes(retry)).toContain("layout-applied");
  });

  it("not-one-dof without positions leaves the document null", async () => {
    const plan = await planImport(
      topologyOnlyEightBar(),
      {},
      layoutDeps({ status: "not-one-dof", positions: null }),
    );
    expect(plan.doc).toBeNull();
    expect(codes(plan)).toEqual(["missing-input", "not-one-dof-topology"]);
  });

  it("builds from a low-mobility layout and an ok result without positions is a null doc", async () => {
    const low = await planImport(
      topologyOnlyEightBar(),
      {},
      layoutDeps({ status: "low-mobility" }),
    );
    expect(low.doc).not.toBeNull();
    const none = await planImport(topologyOnlyEightBar(), {}, layoutDeps({ positions: null }));
    expect(none.doc).toBeNull();
  });

  it("rejects a layout result with the wrong number of positions", async () => {
    const plan = await planImport(topologyOnlyEightBar(), {}, layoutDeps({ positions: [[0, 0]] }));
    expect(plan.doc).toBeNull();
  });

  it("forwards the control object to deps.layout", async () => {
    const ctl = { signal: new AbortController().signal };
    const layout = vi.fn<NonNullable<ImportDeps["layout"]>>((req) => circleLayout(req));
    await planImport(topologyOnlyEightBar(), {}, { layout }, ctl);
    expect(layout.mock.calls[0][1]).toBe(ctl);
  });
});

describe("planImport: mobility verdict items", () => {
  const run = (v: MobilityVerdict, options = {}, text = positionedFourBar(), extra = {}) =>
    planImport(text, options, { verify: () => v, ...extra });

  it("maps assembly-failed", async () => {
    const plan = await run(verdict({ status: "assembly-failed", rankDof: null, gruebler: null }));
    expect(item(plan, "assembly-failed").fixes.length).toBeGreaterThan(0);
  });

  it("maps a rank that is not 1 to dof-not-one", async () => {
    const plan = await run(verdict({ status: "not-drivable", rankDof: 2, gruebler: 2 }));
    expect(item(plan, "dof-not-one").params).toEqual({ rankDof: 2, gruebler: 2 });
    const noGr = await run(verdict({ status: "not-drivable", rankDof: 3, gruebler: null }));
    expect(item(noGr, "dof-not-one").params).toEqual({ rankDof: 3 });
    const ready = await run(verdict({ rankDof: 2 }));
    expect(codes(ready)).toEqual(["dof-not-one"]);
  });

  it("maps everything else that is not ready to not-drivable", async () => {
    const plan = await run(verdict({ status: "invalid", rankDof: null, gruebler: null }));
    expect(codes(plan)).toEqual(["not-drivable"]);
    const ranked = await run(verdict({ status: "not-drivable", rankDof: 1 }));
    expect(codes(ranked)).toEqual(["not-drivable"]);
  });

  it("warns low-mobility below the target for a rotary input, with a layout fix", async () => {
    const plan = await run(verdict({ rangeDeg: 30, fullRotation: false }));
    const low = item(plan, "low-mobility");
    expect(low.params).toEqual({ rangeDeg: 30, threshold: MOBILITY_TARGET_DEG });
    expect(fixIds(low)).toEqual(["layout"]);
    expect(low.fixes[0].option).toEqual({ positions: "layout" });
    expect(low.activeFixId).toBeNull();
  });

  it("does not warn at exactly the target or a full rotation", async () => {
    expect(codes(await run(verdict({ rangeDeg: MOBILITY_TARGET_DEG })))).toEqual([]);
    expect(codes(await run(verdict()))).toEqual([]);
  });

  it("offers layoutVariant+1 as well when already in layout mode", async () => {
    const plan = await run(
      verdict({ rangeDeg: 10, fullRotation: false }),
      { layoutVariant: 2 },
      topologyOnlyEightBar(),
      layoutDeps(),
    );
    const low = item(plan, "low-mobility");
    expect(fixIds(low)).toEqual(["layout", "retry-layout"]);
    expect(low.fixes[1].option).toEqual({ layoutVariant: 3 });
  });

  it("uses linear travel for a linear input", async () => {
    const linear = (travel: number | null) =>
      run(verdict({ inputKind: "linear", rangeDeg: 0, linearTravel: travel, fullRotation: false }));
    expect(codes(await linear(0))).toEqual(["low-mobility"]);
    expect(codes(await linear(null))).toEqual(["low-mobility"]);
    expect(codes(await linear(12))).toEqual([]);
  });

  it("makes no verdict items without deps.verify", async () => {
    const plan = await planImport(positionedFourBar());
    expect(plan.verdict).toBeNull();
    expect(plan.items).toEqual([]);
  });
});

describe("planImport: fatal input", () => {
  it("short-circuits fatal read items without calling verify or layout", async () => {
    const verify = vi.fn(() => verdict());
    const layout = vi.fn<NonNullable<ImportDeps["layout"]>>((req) => circleLayout(req));
    for (const text of ["garbage {", "[]", '{"nodes":[],"edges":[]}']) {
      const plan = await planImport(text, {}, { verify, layout });
      expect(plan.fatal).toBe(true);
      expect(plan.doc).toBeNull();
      expect(plan.mode).toBeNull();
      expect(plan.nodeOfLink.size).toBe(0);
      expect(plan.counts.error).toBe(1);
    }
    expect(verify).not.toHaveBeenCalled();
    expect(layout).not.toHaveBeenCalled();
  });

  it("carries read items (units-unknown) alongside the mapping items", async () => {
    const text = JSON.stringify({
      units: "furlong",
      nodes: [{ id: 0 }, { id: 1 }, { id: 2 }, { id: 3 }],
      edges: FOURBAR_EDGES,
    });
    const plan = await planImport(text);
    expect(codes(plan)).toEqual(["units-unknown"]);
    expect(plan.counts).toEqual({ error: 0, warning: 0, info: 1 });
    expect(plan.doc!.units.length).toBe("mm");
  });
});
