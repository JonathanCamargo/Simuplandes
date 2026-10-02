import { describe, it, expect } from "vitest";
import {
  createEmptyDocument,
  indexDocument,
  collectIds,
  siteWorldPosition,
  poseFromWorldPoints,
  worldToLinkLocal,
  jointClusterSiteIds,
  serializeDocument,
} from "./document";
import { MechanismDocumentSchema } from "./schema";
import { fourBarFixtureParsed } from "./__fixtures__/fourBar";

describe("createEmptyDocument", () => {
  it("deep-equals the expected default document", () => {
    expect(createEmptyDocument()).toEqual({
      schemaVersion: 1,
      name: "Untitled mechanism",
      units: { length: "mm" },
      links: [],
      joints: [],
      motors: [],
      markers: [],
      loads: [],
    });
  });

  it("applies lengthUnit and name options", () => {
    const doc = createEmptyDocument({ lengthUnit: "m", name: "X" });
    expect(doc.units.length).toBe("m");
    expect(doc.name).toBe("X");
  });

  it("returns distinct, non-shared arrays across calls", () => {
    const a = createEmptyDocument();
    const b = createEmptyDocument();
    expect(a.links).not.toBe(b.links);
    a.links.push({
      id: "link-x",
      name: "x",
      isGround: false,
      pose: { position: [0, 0], angle: 0 },
      shape: { kind: "bar" },
      sites: [],
    });
    expect(b.links).toHaveLength(0);
  });
});

describe("indexDocument", () => {
  const index = indexDocument(fourBarFixtureParsed);

  it("indexes sites with their owning link", () => {
    const entry = index.sites.get("site-5");
    expect(entry?.site.id).toBe("site-5");
    expect(entry?.link.id).toBe("link-3");
  });

  it("indexes links, joints, motors, markers, loads by id", () => {
    expect(index.links.get("link-1")?.id).toBe("link-1");
    expect(index.joints.get("joint-1")?.id).toBe("joint-1");
    expect(index.motors.get("motor-1")?.id).toBe("motor-1");
    expect(index.markers.get("marker-1")?.id).toBe("marker-1");
    expect(index.loads.get("load-1")?.id).toBe("load-1");
  });

  it("groups joints by the sites they touch", () => {
    const joints = index.jointsBySite.get("site-1");
    expect(joints).toBeDefined();
    expect(joints?.map((j) => j.id)).toContain("joint-1");
  });
});

describe("collectIds", () => {
  it("has size equal to the total entity count", () => {
    const ids = collectIds(fourBarFixtureParsed);
    // 4 links + 8 sites + 4 joints + 1 motor + 1 marker + 1 load = 19
    expect(ids.size).toBe(19);
  });
});

describe("siteWorldPosition", () => {
  it("rotates a local site by the link's pose (y-up, +90deg rotates +x to +y)", () => {
    const link = { pose: { position: [10, 5] as [number, number], angle: Math.PI / 2 } };
    const result = siteWorldPosition(link, [2, 0]);
    expect(result.x).toBeCloseTo(10, 10);
    expect(result.y).toBeCloseTo(7, 10);
  });
});

describe("poseFromWorldPoints and worldToLinkLocal", () => {
  it("builds a pose from two world points and inverts with worldToLinkLocal", () => {
    const pose = poseFromWorldPoints({ x: 0, y: 0 }, { x: 0, y: 40 });
    expect(pose.position).toEqual([0, 0]);
    expect(pose.angle).toBeCloseTo(Math.PI / 2, 10);

    const local = worldToLinkLocal(pose, { x: 0, y: 40 });
    expect(local[0]).toBeCloseTo(40, 10);
    expect(local[1]).toBeCloseTo(0, 10);
    expect(Object.is(local[1], -0)).toBe(false);
  });

  it("never produces -0 in either result", () => {
    const pose = poseFromWorldPoints({ x: 0, y: 0 }, { x: 40, y: 0 });
    expect(Object.is(pose.position[0], -0)).toBe(false);
    expect(Object.is(pose.position[1], -0)).toBe(false);
    expect(Object.is(pose.angle, -0)).toBe(false);
  });
});

describe("jointClusterSiteIds", () => {
  it("collects the sites transitively connected by R joints (crank's outer site to coupler's inner site)", () => {
    expect(jointClusterSiteIds(fourBarFixtureParsed, "site-4")).toEqual(
      new Set(["site-4", "site-5"]),
    );
  });

  it("also works for a ground site (ground.O2 to crank.O2)", () => {
    expect(jointClusterSiteIds(fourBarFixtureParsed, "site-1")).toEqual(
      new Set(["site-1", "site-3"]),
    );
  });

  it("a site id with no joints maps to its own singleton set", () => {
    expect(jointClusterSiteIds(fourBarFixtureParsed, "site-nope")).toEqual(new Set(["site-nope"]));
  });

  it("P joints do not join a cluster: sites slide apart, so they stay separate", () => {
    const pJointDoc = MechanismDocumentSchema.parse({
      schemaVersion: 1,
      links: [
        {
          id: "link-a",
          name: "a",
          isGround: false,
          pose: { position: [0, 0], angle: 0 },
          shape: { kind: "bar" },
          sites: [
            { id: "site-a1", local: [0, 0] },
            { id: "site-a2", local: [1, 0] },
          ],
        },
        {
          id: "link-b",
          name: "b",
          isGround: false,
          pose: { position: [5, 0], angle: 0 },
          shape: { kind: "bar" },
          sites: [{ id: "site-b1", local: [0, 0] }],
        },
      ],
      joints: [{ id: "joint-p", type: "P", siteA: "site-a2", siteB: "site-b1", axis: [1, 0] }],
    });
    expect(jointClusterSiteIds(pJointDoc, "site-a2")).toEqual(new Set(["site-a2"]));
    expect(jointClusterSiteIds(pJointDoc, "site-b1")).toEqual(new Set(["site-b1"]));
  });
});

describe("serializeDocument", () => {
  it("produces pretty JSON with 2-space indent and trailing newline", () => {
    const doc = createEmptyDocument();
    const json = serializeDocument(doc);
    expect(json.endsWith("\n")).toBe(true);
    expect(json).toContain('\n  "schemaVersion"');
  });

  it("round-trips the four-bar fixture through schema.parse deep-equal", () => {
    const json = serializeDocument(fourBarFixtureParsed);
    const parsed: unknown = JSON.parse(json);
    const reparsed = MechanismDocumentSchema.parse(parsed);
    expect(reparsed).toEqual(fourBarFixtureParsed);
  });

  it("emits only plain JSON data (MDL-01)", () => {
    const doc = fourBarFixtureParsed;
    const viaJson: unknown = JSON.parse(serializeDocument(doc));
    expect(viaJson).toEqual(structuredClone(doc));
  });
});
