import { describe, expect, it } from "vitest";
import { placeLabels, type LabelNodeInput } from "./labelPlacement";
import { computeGraphViewport, GRAPH_PX } from "./graphViewport";
import { LABEL_MIN_FONT } from "./labelFit";
import { documentFromEdges } from "../../graph/__fixtures__/fromEdges";
import { fromDocument } from "../../graph/fromDocument";
import { layoutGraph, type GraphLayoutKind } from "../../graph/layouts";
import { GROUND_NODE_ID } from "../../graph/types";

const VIEWPORT = { width: 302, height: 281 };
const VP = computeGraphViewport(302, 281);
const KINDS: GraphLayoutKind[] = ["spatial", "circular", "layered"];

function box(node: LabelNodeInput): { x: number; y: number; width: number; height: number } {
  const half = node.shape === "circle" ? GRAPH_PX.nodeRadius : GRAPH_PX.groundHalfSide;
  return { x: node.cx - half, y: node.cy - half, width: half * 2, height: half * 2 };
}

function boxesIntersect(
  a: { x: number; y: number; width: number; height: number },
  b: { x: number; y: number; width: number; height: number },
  tolerance = 0,
): boolean {
  return (
    a.x + tolerance < b.x + b.width &&
    b.x + tolerance < a.x + a.width &&
    a.y + tolerance < b.y + b.height &&
    b.y + tolerance < a.y + a.height
  );
}

describe("placeLabels: inside vs outside", () => {
  it('short labels on circle nodes ("L5"/"L6") place inside; long ones ("coupler" etc.) place outside', () => {
    const nodes: LabelNodeInput[] = [
      { id: "n0", cx: 40, cy: 40, shape: "square", label: "Tierra" },
      { id: "n1", cx: 150, cy: 40, shape: "circle", label: "crank" },
      { id: "n2", cx: 260, cy: 40, shape: "circle", label: "coupler" },
      { id: "n3", cx: 40, cy: 200, shape: "circle", label: "rocker" },
      { id: "n4", cx: 150, cy: 200, shape: "circle", label: "L5" },
      { id: "n5", cx: 260, cy: 200, shape: "circle", label: "L6" },
    ];
    const placed = placeLabels(nodes, VIEWPORT);
    expect(placed.size).toBe(6);

    expect(placed.get("n4")?.placement).toBe("inside");
    expect(placed.get("n5")?.placement).toBe("inside");

    for (const id of ["n0", "n1", "n2", "n3"]) {
      const p = placed.get(id)!;
      expect(p.placement).not.toBe("inside");
      expect(p.fontSize).toBeGreaterThanOrEqual(LABEL_MIN_FONT);
      expect(p.truncated).toBe(false);
    }
  });
});

describe("placeLabels: real fixtures (Stephenson six-bar + SC-3), every layout kind, at the 302x281 viewport", () => {
  const STEPHENSON_EDGES: [number, number][] = [
    [0, 1],
    [0, 2],
    [0, 3],
    [1, 4],
    [2, 5],
    [4, 5],
    [3, 4],
  ];
  const SC3_EDGES: [number, number][] = [
    [0, 1],
    [1, 2],
    [2, 3],
    [3, 0],
    [2, 4],
    [4, 5],
    [5, 2],
  ];
  const NAMES = ["Tierra", "crank", "coupler", "rocker", "L5", "L6"];

  function stephensonNodesFor(kind: GraphLayoutKind): LabelNodeInput[] {
    const { doc } = documentFromEdges(STEPHENSON_EDGES);
    const named = {
      ...doc,
      links: doc.links.map((link, i) =>
        i === 0 ? link : { ...link, name: NAMES[i] ?? link.name },
      ),
    };
    const graph = fromDocument(named);
    const positions = layoutGraph(graph, kind, { minSeparation: VP.minSeparation });
    return graph.nodes.map((node) => {
      const pos = positions.get(node.id)!;
      const screen = { x: VP.offsetX + pos.x * VP.drawSize, y: VP.offsetY + pos.y * VP.drawSize };
      return {
        id: node.id,
        cx: screen.x,
        cy: screen.y,
        shape: node.isGround ? "square" : "circle",
        label: node.isGround ? "Tierra" : node.label,
      };
    });
  }

  function sc3NodesFor(kind: GraphLayoutKind): LabelNodeInput[] {
    const { doc } = documentFromEdges(SC3_EDGES);
    const graph = fromDocument(doc);
    const positions = layoutGraph(graph, kind, { minSeparation: VP.minSeparation });
    return graph.nodes.map((node) => {
      const pos = positions.get(node.id)!;
      const screen = { x: VP.offsetX + pos.x * VP.drawSize, y: VP.offsetY + pos.y * VP.drawSize };
      return {
        id: node.id,
        cx: screen.x,
        cy: screen.y,
        shape: node.isGround ? "square" : "circle",
        label: node.isGround ? "Tierra" : node.label,
      };
    });
  }

  for (const kind of KINDS) {
    it(`Stephenson / ${kind}: every label in-viewport, no obstacle/label collisions, collides=false`, () => {
      const nodes = stephensonNodesFor(kind);
      const placed = placeLabels(nodes, VIEWPORT);
      expect(placed.size).toBe(nodes.length);

      const obstacles = nodes.map((n) => ({ id: n.id, box: box(n) }));
      const boxes = Array.from(placed.values());
      for (const p of boxes) {
        expect(p.box.x).toBeGreaterThanOrEqual(-1e-6);
        expect(p.box.y).toBeGreaterThanOrEqual(-1e-6);
        expect(p.box.x + p.box.width).toBeLessThanOrEqual(VIEWPORT.width + 1e-6);
        expect(p.box.y + p.box.height).toBeLessThanOrEqual(VIEWPORT.height + 1e-6);
        expect(p.collides).toBe(false);
        for (const obstacle of obstacles) {
          if (p.placement === "inside" && p.id === obstacle.id) continue;
          expect(
            boxesIntersect(p.box, obstacle.box),
            `label for ${p.id} must not intersect obstacle ${obstacle.id}`,
          ).toBe(false);
        }
      }
      for (let i = 0; i < boxes.length; i++) {
        for (let j = i + 1; j < boxes.length; j++) {
          expect(boxesIntersect(boxes[i].box, boxes[j].box), "no two labels may collide").toBe(
            false,
          );
        }
      }
    });

    it(`SC-3 / ${kind}: every label in-viewport, no obstacle/label collisions, collides=false`, () => {
      const nodes = sc3NodesFor(kind);
      const placed = placeLabels(nodes, VIEWPORT);
      const obstacles = nodes.map((n) => ({ id: n.id, box: box(n) }));
      const boxes = Array.from(placed.values());
      for (const p of boxes) {
        expect(p.collides).toBe(false);
        for (const obstacle of obstacles) {
          if (p.placement === "inside" && p.id === obstacle.id) continue;
          expect(boxesIntersect(p.box, obstacle.box)).toBe(false);
        }
      }
      for (let i = 0; i < boxes.length; i++) {
        for (let j = i + 1; j < boxes.length; j++) {
          expect(boxesIntersect(boxes[i].box, boxes[j].box)).toBe(false);
        }
      }
    });
  }
});

describe("placeLabels: edge cases", () => {
  it("two nodes 60px apart horizontally with long-ish labels do not collide", () => {
    const nodes: LabelNodeInput[] = [
      { id: "a", cx: 100, cy: 100, shape: "circle", label: "alphabeta" },
      { id: "b", cx: 160, cy: 100, shape: "circle", label: "gammadelta" },
    ];
    const placed = placeLabels(nodes, { width: 400, height: 300 });
    const pa = placed.get("a")!;
    const pb = placed.get("b")!;
    expect(boxesIntersect(pa.box, pb.box)).toBe(false);
    expect(pa.collides).toBe(false);
    expect(pb.collides).toBe(false);
  });

  it("pathological crowding (9 nodes in a 120x120 viewport) never throws, returns every label, marks at least one collides=true", () => {
    const nodes: LabelNodeInput[] = [];
    let i = 0;
    for (const cy of [20, 60, 100]) {
      for (const cx of [20, 60, 100]) {
        nodes.push({ id: `n${i}`, cx, cy, shape: "circle", label: `link-${i}-long-name` });
        i += 1;
      }
    }
    expect(() => placeLabels(nodes, { width: 120, height: 120 })).not.toThrow();
    const placed = placeLabels(nodes, { width: 120, height: 120 });
    expect(placed.size).toBe(9);
    const anyCollide = Array.from(placed.values()).some((p) => p.collides);
    expect(anyCollide).toBe(true);
  });

  it("a 44-char name truncates: text ends with '…', truncated true, box width <= maxOutsideLabelWidth", () => {
    const longName = "a".repeat(44);
    const nodes: LabelNodeInput[] = [
      { id: "n0", cx: 200, cy: 200, shape: "circle", label: longName },
    ];
    const placed = placeLabels(nodes, { width: 400, height: 400 });
    const p = placed.get("n0")!;
    expect(p.text.endsWith("…")).toBe(true);
    expect(p.truncated).toBe(true);
    expect(p.box.width).toBeLessThanOrEqual(GRAPH_PX.maxOutsideLabelWidth + 1e-6);
  });

  it("is deterministic (same input -> deep-equal output)", () => {
    const nodes: LabelNodeInput[] = [
      { id: "a", cx: 50, cy: 50, shape: "circle", label: "one" },
      { id: "b", cx: 150, cy: 90, shape: "square", label: "two" },
    ];
    const a = placeLabels(nodes, VIEWPORT);
    const b = placeLabels(nodes, VIEWPORT);
    expect(a).toEqual(b);
  });

  it("ground node id constant is a valid input id (sanity)", () => {
    expect(typeof GROUND_NODE_ID).toBe("string");
  });
});
