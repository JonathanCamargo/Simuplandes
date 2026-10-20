import { describe, it, expect } from "vitest";
import { compileSystem } from "../kinematics";
import { build as buildFourBar } from "../kinematics/__fixtures__/fourBar";
import { posesFromState, sampleSweepPoses } from "./poses";

describe("posesFromState", () => {
  it("returns one entry per link, ground included, matching the document's reference poses at q0", () => {
    const doc = buildFourBar();
    const system = compileSystem(doc);

    const poses = posesFromState(system, system.q0);

    expect(poses.size).toBe(doc.links.length);
    for (const link of doc.links) {
      const pose = poses.get(link.id);
      expect(pose, `pose for link "${link.name}"`).toBeDefined();
      expect(pose!.position[0]).toBeCloseTo(link.pose.position[0], 12);
      expect(pose!.position[1]).toBeCloseTo(link.pose.position[1], 12);
      expect(pose!.angle).toBeCloseTo(link.pose.angle, 12);
    }
  });

  it("keeps the ground link's pose fixed regardless of q", () => {
    const doc = buildFourBar();
    const system = compileSystem(doc);
    const groundLink = doc.links.find((l) => l.isGround)!;

    // An arbitrary, non-q0 vector -- ground has offset -1, so it never reads q.
    const q = system.q0.map((v) => v + 1);

    const poses = posesFromState(system, q);
    const groundPose = poses.get(groundLink.id)!;
    expect(groundPose.position[0]).toBeCloseTo(groundLink.pose.position[0], 12);
    expect(groundPose.position[1]).toBeCloseTo(groundLink.pose.position[1], 12);
    expect(groundPose.angle).toBeCloseTo(groundLink.pose.angle, 12);
  });

  it("returns a Pose shape ({ position: [x, y], angle }) for every link", () => {
    const doc = buildFourBar();
    const system = compileSystem(doc);
    const poses = posesFromState(system, system.q0);
    for (const pose of poses.values()) {
      expect(pose.position).toHaveLength(2);
      expect(typeof pose.angle).toBe("number");
    }
  });
});

describe("sampleSweepPoses", () => {
  const doc = buildFourBar();
  const system = compileSystem(doc);
  const samples = Array.from({ length: 101 }, () => ({ q: system.q0 }));

  it("keeps at most maxSamples entries, one pose map per kept sample", () => {
    const picked = sampleSweepPoses(system, samples, 10);
    expect(picked).toHaveLength(10);
    for (const poses of picked) expect(poses.size).toBe(doc.links.length);
  });

  it("keeps every sample when there are fewer than maxSamples", () => {
    expect(sampleSweepPoses(system, samples.slice(0, 5), 48)).toHaveLength(5);
  });

  it("always includes the first and last samples", () => {
    const marked = samples.map((s, i) => ({
      q: i === 100 ? Float64Array.from(s.q, (v) => v + 1) : s.q,
    }));
    const picked = sampleSweepPoses(system, marked, 7);
    expect(picked[picked.length - 1]).toEqual(posesFromState(system, marked[100].q));
    expect(picked[0]).toEqual(posesFromState(system, marked[0].q));
  });

  it("returns [] with no samples", () => {
    expect(sampleSweepPoses(system, [])).toEqual([]);
  });
});
