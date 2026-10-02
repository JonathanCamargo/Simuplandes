// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ATLAS_TOPOLOGIES } from "../graph/atlasData";
import { buildStudioDocument } from "../interchange/buildDocument";
import type { LayoutRequest } from "../interchange/importReport";
import {
  FOURBAR_EDGES,
  lengthsOnly,
  nodeLinkText,
  topologyOnlyEightBar,
} from "../interchange/__fixtures__/importCases";
import { planImport } from "../interchange/planImport";
import { AUTO_LAYOUT_DEFAULTS, autoLayout, clearAutoLayoutCache } from "./autoLayout";
import { studioImportDeps, verifyImportedDocument } from "./importDeps";
import { conventionInputEdge } from "./mobilityRange";

// Test-only switches: force the gate's measured range / the degeneracy filter.
const force = vi.hoisted(() => ({ range: null as number | null, degenerate: false }));
vi.mock("./mobilityRange", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./mobilityRange")>();
  return {
    ...actual,
    measureCandidate: (...args: Parameters<typeof actual.measureCandidate>) =>
      force.range === null
        ? actual.measureCandidate(...args)
        : { gruebler: 1, rankDof: 1, rangeDeg: force.range },
  };
});
vi.mock("../interchange/layoutSeed", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../interchange/layoutSeed")>();
  return {
    ...actual,
    isDegenerateSeed: (...args: Parameters<typeof actual.isDegenerateSeed>) =>
      force.degenerate || actual.isDegenerateSeed(...args),
  };
});

function atlasRequest(edges: ReadonlyArray<readonly [number, number]>, n: number, variant = 0) {
  const req: LayoutRequest = {
    nodeCount: n,
    edges: edges.map(([u, v]) => ({ u, v, kind: "R" as const, axis: null })),
    inputEdge: null,
    lengths: null,
    variant,
  };
  return { ...req, inputEdge: conventionInputEdge(req) };
}

function buildDoc(req: LayoutRequest, positions: readonly (readonly [number, number])[]) {
  return buildStudioDocument({
    name: "t",
    units: null,
    nodeCount: req.nodeCount,
    linkNames: new Array<null>(req.nodeCount).fill(null),
    edges: req.edges.map((e, i) => ({ ...e, pos: positions[i] })),
    inputEdge: req.inputEdge,
    markers: [],
  });
}

beforeEach(() => {
  force.range = null;
  force.degenerate = false;
  clearAutoLayoutCache();
});

// One case per topology (not one loop): each gets its own budget, so a slow
// full-suite coverage run cannot push a single 18-topology test past its
// timeout, and a failure names the topology. Benchmark numbers: 09-02-SUMMARY.
describe("autoLayout: all atlas topologies", () => {
  it.each(ATLAS_TOPOLOGIES.map((topo) => [topo.id, topo] as const))(
    "%s lays out deterministically with rank DOF 1 and >= 60 degrees",
    async (_id, topo) => {
      const req = atlasRequest(topo.graph.edges, topo.graph.n);
      const first = await autoLayout(req);
      expect(first.status, topo.id).toBe("ok");
      expect(first.positions).not.toBeNull();
      const positions = first.positions ?? [];
      const verdict = verifyImportedDocument(buildDoc(req, positions));
      expect(verdict.status, topo.id).toBe("ready");
      expect(verdict.rankDof, topo.id).toBe(1);
      expect(verdict.rangeDeg, topo.id).toBeGreaterThanOrEqual(60);

      clearAutoLayoutCache();
      const second = await autoLayout(req);
      expect(second.positions, topo.id).toEqual(first.positions);
    },
    60_000,
  );
});

describe("autoLayout: behaviour", () => {
  const eight = ATLAS_TOPOLOGIES.find((t) => t.nLinks === 8);
  if (!eight) throw new Error("no 8-bar");
  const req = atlasRequest(eight.graph.edges, eight.graph.n);

  it("returns the cached result for the same graph and variant", async () => {
    const a = await autoLayout(req);
    const b = await autoLayout(req);
    expect(b).toBe(a);
  });

  it("a different variant yields different positions that also pass", async () => {
    const a = await autoLayout(req);
    const b = await autoLayout({ ...req, variant: 1 });
    expect(b.status).toBe("ok");
    expect(b.positions).not.toEqual(a.positions);
  }, 30_000);

  it("reports a non-1-DOF topology immediately", async () => {
    const five = atlasRequest(
      [
        [0, 1],
        [1, 2],
        [2, 3],
        [3, 4],
        [4, 0],
      ],
      5,
    );
    const r = await autoLayout(five);
    expect(r.status).toBe("not-one-dof");
    expect(r.positions).toHaveLength(5);
    expect(r.tries).toBe(0);
  });

  it("reports progress once per try and yields between tries", async () => {
    const calls: [number, number][] = [];
    const r = await autoLayout(req, { onProgress: (t, m) => calls.push([t, m]) });
    expect(calls.length).toBeGreaterThanOrEqual(1);
    expect(calls.length).toBe(r.tries);
    expect(calls[0][1]).toBe(AUTO_LAYOUT_DEFAULTS.maxTries);
  });

  it("returns cancelled for an already-aborted signal", async () => {
    const ac = new AbortController();
    ac.abort();
    const r = await autoLayout(req, { signal: ac.signal });
    expect(r.status).toBe("cancelled");
    expect(r.positions).toBeNull();
    expect(r.tries).toBe(0);
  });

  it("returns cancelled when aborted mid-run and does not cache it", async () => {
    force.range = 10; // never reaches the goal, so the run continues until aborted
    const ac = new AbortController();
    const r = await autoLayout(req, {
      signal: ac.signal,
      onProgress: (t) => {
        if (t === 3) ac.abort();
      },
    });
    expect(r.status).toBe("cancelled");
    expect(r.tries).toBe(3);
    expect(r.rangeDeg).toBe(10);
    force.range = null;
    const again = await autoLayout(req);
    expect(again.status).toBe("ok");
  });

  it("returns low-mobility with the best candidate when no try reaches the goal", async () => {
    force.range = 40;
    const r = await autoLayout(req);
    expect(r.status).toBe("low-mobility");
    expect(r.tries).toBe(AUTO_LAYOUT_DEFAULTS.maxTries);
    expect(r.rangeDeg).toBe(40);
    expect(r.positions).toHaveLength(req.edges.length);
  });

  it("falls back to the plain seed when every try is degenerate", async () => {
    force.degenerate = true;
    const r = await autoLayout(req);
    expect(r.status).toBe("low-mobility");
    expect(r.rangeDeg).toBe(0);
    expect(r.positions).toHaveLength(req.edges.length);
  });

  it("evicts the oldest entry beyond the cache cap", async () => {
    const four = atlasRequest(
      [
        [0, 1],
        [0, 3],
        [1, 2],
        [2, 3],
      ],
      4,
    );
    for (let v = 0; v < 66; v++) await autoLayout({ ...four, variant: v });
    const first = await autoLayout({ ...four, variant: 0 });
    expect(first.positions).not.toBeNull();
  }, 120_000);
});

describe("planImport with studioImportDeps: layout mode", () => {
  it("lays out a topology-only T15 to a ready document", async () => {
    const plan = await planImport(topologyOnlyEightBar(), {}, studioImportDeps);
    expect(plan.mode).toBe("layout");
    expect(plan.verdict?.status).toBe("ready");
    expect(plan.items.some((i) => i.code === "layout-applied")).toBe(true);
    expect(plan.items.some((i) => i.code === "low-mobility")).toBe(false);
    expect(plan.verdict?.rangeDeg ?? 0).toBeGreaterThanOrEqual(60);
  }, 60_000);

  it("layoutVariant 1 gives different positions that also pass", async () => {
    const a = await planImport(topologyOnlyEightBar(), {}, studioImportDeps);
    const b = await planImport(topologyOnlyEightBar(), { layoutVariant: 1 }, studioImportDeps);
    expect(b.items.some((i) => i.code === "low-mobility")).toBe(false);
    expect(b.verdict?.status).toBe("ready");
    const sites = (p: typeof a) => p.doc?.links.map((l) => l.pose.position) ?? [];
    expect(sites(b)).not.toEqual(sites(a));
  }, 60_000);

  it("wiring: studioImportDeps.layout is autoLayout", () => {
    expect(studioImportDeps.layout).toBe(autoLayout);
    expect(vi.isMockFunction(autoLayout)).toBe(false);
  });
});

describe("autoLayout: lengths-only graphs", () => {
  const fourbar = (lengths: Record<string, number>) =>
    nodeLinkText(
      [0, 1, 2, 3],
      FOURBAR_EDGES.map((e) => ({ source: e.source, target: e.target })),
      { extra: { link_lengths: lengths } },
    );

  it("lays a lengths-only four-bar out to its lengths and moves it", async () => {
    const plan = await planImport(lengthsOnly(), {}, studioImportDeps);
    expect(plan.mode).toBe("layout");
    expect(plan.verdict?.status).toBe("ready");
    expect(plan.items.some((i) => i.code === "layout-applied")).toBe(true);
    expect(plan.items.some((i) => i.code === "lengths-infeasible")).toBe(false);
    const warn = plan.items.some((i) => i.code === "low-mobility");
    expect(warn || (plan.verdict?.rangeDeg ?? 0) >= 60).toBe(true);
  }, 60_000);

  it("reports lengths-infeasible for a four-bar that cannot close", async () => {
    const plan = await planImport(
      fourbar({ "0": 100, "1": 10, "2": 10, "3": 10 }),
      {},
      studioImportDeps,
    );
    expect(plan.doc).toBeNull();
    const item = plan.items.find((i) => i.code === "lengths-infeasible");
    expect(item?.severity).toBe("error");
  }, 60_000);

  it("autoLayout returns lengths-infeasible with the smallest residual", async () => {
    const req: LayoutRequest = {
      nodeCount: 4,
      edges: FOURBAR_EDGES.map((e) => ({
        u: Number(e.source),
        v: Number(e.target),
        kind: "R" as const,
        axis: null,
      })),
      inputEdge: 0,
      lengths: [100, 10, 10, 10],
      variant: 0,
    };
    const r = await autoLayout(req);
    expect(r.status).toBe("lengths-infeasible");
    expect(r.positions).toBeNull();
    expect(r.lengthResidual ?? 0).toBeGreaterThan(1e-3);
  }, 60_000);
});
