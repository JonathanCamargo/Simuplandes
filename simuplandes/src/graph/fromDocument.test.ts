import { describe, expect, it } from "vitest";
import { fourBarFixtureParsed } from "../model/__fixtures__/fourBar";
import { MechanismDocumentSchema, type MechanismDocumentInput } from "../model";
import { linkTypes } from "../canvas/linkType";
import { documentFromEdges } from "./__fixtures__/fromEdges";
import { fromDocument } from "./fromDocument";
import { GROUND_NODE_ID } from "./types";

describe("fromDocument", () => {
  it("builds the four-bar's ground-merged graph", () => {
    const g = fromDocument(fourBarFixtureParsed);

    expect(g.nodes).toHaveLength(4);
    expect(g.nodes[0].id).toBe(GROUND_NODE_ID);
    expect(g.nodes[0].linkType).toBe("ground");
    for (const node of g.nodes.slice(1)) {
      expect(node.linkType).toBe("binary");
    }

    expect(g.edges).toHaveLength(4);
    expect(g.jointCount).toBe(4);
    expect(g.warnings).toEqual([]);

    const jointIds = fourBarFixtureParsed.joints.map((j) => j.id);
    expect(g.edges.map((e) => e.id)).toEqual(jointIds);
    expect(g.edges.map((e) => e.jointId)).toEqual(jointIds);

    const groundPivotCount = g.edges.filter((e) => e.groundPivot).length;
    expect(groundPivotCount).toBe(2);
    // joint-1 (ground <-> crank) and joint-4 (rocker <-> ground) touch ground.
    expect(g.edges.find((e) => e.jointId === "joint-1")!.groundPivot).toBe(true);
    expect(g.edges.find((e) => e.jointId === "joint-4")!.groundPivot).toBe(true);
    expect(g.edges.find((e) => e.jointId === "joint-2")!.groundPivot).toBe(false);
    expect(g.edges.find((e) => e.jointId === "joint-3")!.groundPivot).toBe(false);
  });

  it("computes reference-pose world centroids", () => {
    const g = fromDocument(fourBarFixtureParsed);
    const crankNode = g.nodeById.get("link-2")!;
    expect(crankNode.centroid.x).toBeCloseTo(20, 9);
    expect(crankNode.centroid.y).toBeCloseTo(0, 9);

    const groundNode = g.nodeById.get(GROUND_NODE_ID)!;
    expect(groundNode.centroid.x).toBeCloseTo(70, 9);
    expect(groundNode.centroid.y).toBeCloseTo(0, 9);
  });

  it("maps nodeIdOfLink for every link and reuses the one link-type classifier", () => {
    const g = fromDocument(fourBarFixtureParsed);
    const types = linkTypes(fourBarFixtureParsed);
    for (const link of fourBarFixtureParsed.links) {
      const nodeId = g.nodeIdOfLink.get(link.id);
      expect(nodeId).toBeDefined();
      if (!link.isGround) {
        expect(g.nodeById.get(nodeId!)!.linkType).toBe(types.get(link.id));
      }
    }
  });

  it("classifies a Stephenson six-bar built from an abstract edge list", () => {
    const { doc } = documentFromEdges([
      [0, 1],
      [0, 2],
      [0, 3],
      [1, 4],
      [2, 5],
      [3, 4],
      [4, 5],
    ]);
    const g = fromDocument(doc);
    const types = linkTypes(doc);

    expect(g.nodes).toHaveLength(6);
    expect(g.edges).toHaveLength(7);

    const nodeForOriginalIndex = (k: number): (typeof g.nodes)[number] => {
      const link = doc.links[k];
      return g.nodeById.get(g.nodeIdOfLink.get(link.id)!)!;
    };

    expect(nodeForOriginalIndex(0).linkType).toBe("ground");
    expect(nodeForOriginalIndex(4).linkType).toBe("ternary");
    for (const k of [1, 2, 3, 5]) {
      expect(nodeForOriginalIndex(k).linkType).toBe("binary");
    }

    for (const link of doc.links) {
      if (link.isGround) continue;
      const node = nodeForOriginalIndex(doc.links.indexOf(link));
      expect(node.linkType).toBe(types.get(link.id));
    }

    // Degrees match the edge list: node k's degree = number of edges touching k.
    const expectedDegree = [3, 2, 2, 2, 3, 2];
    doc.links.forEach((_link, k) => {
      const node = nodeForOriginalIndex(k);
      expect(node.degree).toBe(expectedDegree[k]);
    });
  });

  it("merges two isGround links into one ground node, listing both linkIds and summing degree", () => {
    const { doc } = documentFromEdges(
      [
        [0, 1],
        [1, 2],
        [2, 3],
        [3, 0],
      ],
      { ground: [0, 2] },
    );
    const g = fromDocument(doc);

    const groundNodes = g.nodes.filter((n) => n.isGround);
    expect(groundNodes).toHaveLength(1);
    const groundNode = groundNodes[0];
    expect(groundNode.id).toBe(GROUND_NODE_ID);
    expect(groundNode.linkType).toBe("ground");

    const groundLinkIds = doc.links.filter((l) => l.isGround).map((l) => l.id);
    expect(groundLinkIds).toHaveLength(2);
    expect([...groundNode.linkIds]).toEqual(groundLinkIds);

    // Node 0 (degree 2: edges 0,3) and node 2 (degree 2: edges 1,2) merge -> degree 4.
    expect(groundNode.degree).toBe(4);
  });

  it("reports a groundLoop warning (no edge) for a joint between two different ground links", () => {
    const { doc } = documentFromEdges(
      [
        [0, 1],
        [1, 2],
        [0, 2],
      ],
      { ground: [0, 2] },
    );
    const g = fromDocument(doc);

    expect(g.jointCount).toBe(3);
    expect(g.edges).toHaveLength(2);
    expect(g.warnings).toHaveLength(1);
    expect(g.warnings[0].kind).toBe("groundLoop");

    const groundLoopJointId = doc.joints[2].id;
    expect((g.warnings[0] as { jointId: string }).jointId).toBe(groundLoopJointId);
  });

  it("reports a danglingJoint warning for a site id that does not resolve", () => {
    const input: MechanismDocumentInput = {
      schemaVersion: 1,
      name: "dangling",
      units: { length: "mm" },
      links: [
        {
          id: "link-a",
          name: "a",
          isGround: false,
          pose: { position: [0, 0], angle: 0 },
          shape: { kind: "bar" },
          sites: [{ id: "site-a", name: "", local: [0, 0] }],
        },
        {
          id: "link-b",
          name: "b",
          isGround: false,
          pose: { position: [10, 0], angle: 0 },
          shape: { kind: "bar" },
          sites: [{ id: "site-b", name: "", local: [0, 0] }],
        },
      ],
      joints: [],
    };
    // Build a document with a dangling joint by constructing the graph
    // directly against a hand-shaped object (bypassing schema integrity,
    // which would otherwise itself reject an unknown site id).
    const doc = MechanismDocumentSchema.parse(input);
    const docWithDanglingJoint = {
      ...doc,
      joints: [
        { id: "joint-x", name: "", type: "R" as const, siteA: "site-a", siteB: "unknown-site" },
      ],
    };

    const g = fromDocument(docWithDanglingJoint);
    expect(g.jointCount).toBe(1);
    expect(g.edges).toHaveLength(0);
    expect(g.warnings).toEqual([{ kind: "danglingJoint", jointId: "joint-x" }]);
  });

  it("marks the correct joint type P for a prismatic edge", () => {
    const { doc } = documentFromEdges(
      [
        [0, 1],
        [1, 2],
        [2, 3],
        [3, 0],
      ],
      { prismatic: [3] },
    );
    const g = fromDocument(doc);
    const prismaticJointId = doc.joints[3].id;
    expect(g.edges.find((e) => e.jointId === prismaticJointId)!.type).toBe("P");
    expect(g.edges.filter((e) => e.type === "R")).toHaveLength(3);
  });

  it("gives a link with no sites/joints degree 0 and centroid = its pose position", () => {
    const { doc } = documentFromEdges([[0, 2]]);
    const g = fromDocument(doc);
    const isolatedLink = doc.links[1]; // node 1 never appears in the single edge
    expect(isolatedLink.sites).toHaveLength(0);

    const node = g.nodeById.get(g.nodeIdOfLink.get(isolatedLink.id)!)!;
    expect(node.degree).toBe(0);
    expect(node.centroid.x).toBeCloseTo(isolatedLink.pose.position[0], 9);
    expect(node.centroid.y).toBeCloseTo(isolatedLink.pose.position[1], 9);
  });

  it("returns an empty graph for an empty document", () => {
    const doc = MechanismDocumentSchema.parse({ schemaVersion: 1 });
    const g = fromDocument(doc);
    expect(g.nodes).toEqual([]);
    expect(g.edges).toEqual([]);
    expect(g.jointCount).toBe(0);
    expect(g.warnings).toEqual([]);
  });

  it("does not mutate the input document", () => {
    const before = structuredClone(fourBarFixtureParsed);
    fromDocument(fourBarFixtureParsed);
    expect(fourBarFixtureParsed).toEqual(before);
  });
});
