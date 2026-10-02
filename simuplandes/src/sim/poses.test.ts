import { describe, it, expect } from "vitest";
import { compileSystem } from "../kinematics";
import { build as buildFourBar } from "../kinematics/__fixtures__/fourBar";
import { posesFromState } from "./poses";

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
