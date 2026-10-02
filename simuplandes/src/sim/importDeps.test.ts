// @vitest-environment node
/// <reference types="node" />
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { importGraphthe } from "../interchange/importGraphthe";
import { parseGraphtheText } from "../interchange/graphtheSchema";
import { createId, type MechanismDocument } from "../model";
import { autoLayout } from "./autoLayout";
import { finiteOrZero, studioImportDeps, verifyImportedDocument } from "./importDeps";

const FIXTURES_DIR = join(import.meta.dirname, "..", "..", "fixtures");

function golden(name: string): MechanismDocument {
  const env = parseGraphtheText(readFileSync(join(FIXTURES_DIR, `${name}.graphthe.json`), "utf8"));
  return importGraphthe(env, { anchoredPoses: true });
}

describe("verifyImportedDocument", () => {
  it("measures a full-rotation four-bar", () => {
    const v = verifyImportedDocument(golden("fourbar-crank-rocker"));
    expect(v).toMatchObject({
      status: "ready",
      rankDof: 1,
      gruebler: 1,
      inputKind: "rotary",
      fullRotation: true,
      rangeDeg: 360,
      linearTravel: null,
    });
  });

  it("measures a bounded, low-mobility stephenson-ii", () => {
    const v = verifyImportedDocument(golden("stephenson-ii"));
    expect(v.status).toBe("ready");
    expect(v.fullRotation).toBe(false);
    expect(v.rangeDeg).toBeGreaterThan(0);
    expect(v.rangeDeg).toBeLessThan(60);
  });

  it("reports linear travel for a slider-driven mechanism", () => {
    const doc = golden("slider-crank");
    const prismatic = doc.joints.find((j) => j.type === "P")!;
    const driven: MechanismDocument = {
      ...doc,
      motors: [
        {
          id: createId("motor"),
          name: "slider",
          jointId: prismatic.id,
          kind: "linear",
          drive: { mode: "constant", speed: 1 },
        },
      ],
    };
    const v = verifyImportedDocument(driven);
    expect(v.status).toBe("ready");
    expect(v.inputKind).toBe("linear");
    expect(v.rangeDeg).toBe(0);
    expect(v.fullRotation).toBe(false);
    expect(v.linearTravel).not.toBeNull();
    expect(v.linearTravel!).toBeGreaterThan(0);
    expect(Number.isFinite(v.linearTravel!)).toBe(true);
  });

  it("classifies an empty document", () => {
    const empty = golden("fourbar-crank-rocker");
    const v = verifyImportedDocument({
      ...empty,
      links: empty.links.filter((l) => l.isGround),
      joints: [],
      motors: [],
      markers: [],
    });
    expect(v).toMatchObject({ status: "empty", rangeDeg: 0, inputKind: null, linearTravel: null });
  });

  it("classifies a multi-DOF document as not-drivable with its rank", () => {
    const doc = golden("fourbar-crank-rocker");
    const v = verifyImportedDocument({ ...doc, joints: doc.joints.slice(0, 3) });
    expect(v.status).toBe("not-drivable");
    expect(v.rankDof).toBeGreaterThan(1);
    expect(v.rangeDeg).toBe(0);
  });

  it("classifies an unassemblable document", () => {
    const doc = golden("fourbar-crank-rocker");
    const ground = doc.links.find((l) => l.isGround)!;
    // Drag the rocker pivot out of reach of the 40/100/80 chain.
    const moved: MechanismDocument = {
      ...doc,
      links: doc.links.map((l) =>
        l.id === ground.id
          ? {
              ...l,
              sites: l.sites.map((s) => (s.name === "n3" ? { ...s, local: [1000, 0] } : s)),
            }
          : l,
      ),
    };
    const v = verifyImportedDocument(moved);
    expect(v.status).toBe("assembly-failed");
    expect(v.rangeDeg).toBe(0);
  });

  it("classifies an invalid document (dangling motor joint)", () => {
    const doc = golden("fourbar-crank-rocker");
    const v = verifyImportedDocument({
      ...doc,
      motors: [{ ...doc.motors[0], jointId: "joint-missing" }],
    });
    expect(v.status).toBe("invalid");
    expect(v.rangeDeg).toBe(0);
  });

  it("keeps every number finite", () => {
    for (const name of ["fourbar-crank-rocker", "stephenson-ii", "slider-crank"]) {
      const v = verifyImportedDocument(golden(name));
      expect(Number.isFinite(v.rangeDeg)).toBe(true);
      if (v.linearTravel !== null) expect(Number.isFinite(v.linearTravel)).toBe(true);
    }
    expect(finiteOrZero(Infinity)).toBe(0);
    expect(finiteOrZero(NaN)).toBe(0);
    expect(finiteOrZero(2)).toBe(2);
  }, 30_000);
});

describe("studioImportDeps", () => {
  it("wires verify and the auto-layout", () => {
    expect(studioImportDeps.verify).toBe(verifyImportedDocument);
    expect(studioImportDeps.layout).toBe(autoLayout);
  });
});
