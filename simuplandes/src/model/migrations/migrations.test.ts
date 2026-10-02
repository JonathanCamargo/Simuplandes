import { describe, it, expect } from "vitest";
import { z } from "zod";
import { migrateDocument, parseDocumentJson, DocumentLoadError } from "./index";
import { createMigrator, type MigrationStep } from "./migrator";
import { MechanismDocumentSchema } from "../schema";
import { serializeDocument } from "../document";
import { fourBarFixtureParsed } from "../__fixtures__/fourBar";
import type { DocumentLoadErrorReason } from "./errors";

/** Runs `fn`, asserts it throws a `DocumentLoadError` with `reason`, and returns the caught error. */
function expectLoadError(fn: () => unknown, reason: DocumentLoadErrorReason): DocumentLoadError {
  expect(fn).toThrow(DocumentLoadError);
  try {
    fn();
  } catch (e) {
    const err = e as DocumentLoadError;
    expect(err.reason).toBe(reason);
    return err;
  }
  throw new Error("unreachable: fn did not throw on the second call");
}

/** Deterministic mulberry32 PRNG so the fuzz test below is reproducible. */
function mulberry32(seed: number): () => number {
  let a = seed;
  return function next(): number {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randomJsonValue(rand: () => number, depth = 0): unknown {
  const kinds =
    depth > 2
      ? (["number", "string", "null"] as const)
      : (["number", "string", "null", "array", "object", "boolean"] as const);
  const kind = kinds[Math.floor(rand() * kinds.length)] ?? "null";
  switch (kind) {
    case "number":
      return rand() * 1000 - 500;
    case "string":
      return rand().toString(36);
    case "boolean":
      return rand() > 0.5;
    case "array":
      return Array.from({ length: Math.floor(rand() * 4) }, () => randomJsonValue(rand, depth + 1));
    case "object": {
      const obj: Record<string, unknown> = {};
      const n = Math.floor(rand() * 4);
      for (let i = 0; i < n; i++) obj[`k${i}`] = randomJsonValue(rand, depth + 1);
      return obj;
    }
    default:
      return null;
  }
}

/** A valid document with a random subset of its top-level fields deleted. */
function fourBarWithRandomDeletions(rand: () => number): unknown {
  const doc = structuredClone(fourBarFixtureParsed) as Record<string, unknown>;
  const keys = Object.keys(doc);
  const deletions = Math.floor(rand() * keys.length);
  for (let i = 0; i < deletions; i++) {
    const key = keys[Math.floor(rand() * keys.length)];
    if (key !== undefined) delete doc[key];
  }
  return doc;
}

describe("parseDocumentJson", () => {
  it("round-trips the four-bar fixture through serializeDocument", () => {
    const text = serializeDocument(fourBarFixtureParsed);
    expect(parseDocumentJson(text)).toEqual(fourBarFixtureParsed);
  });

  it("rejects malformed JSON with reason invalid-json", () => {
    expectLoadError(() => parseDocumentJson("{not json"), "invalid-json");
  });
});

describe("migrateDocument: not-a-document", () => {
  const cases: unknown[] = [
    null,
    [],
    "x",
    { links: [] },
    { schemaVersion: "1" },
    { schemaVersion: 1.5 },
  ];

  it.each(cases)("rejects %j as not-a-document, mentioning schemaVersion", (raw) => {
    const err = expectLoadError(() => migrateDocument(raw), "not-a-document");
    expect(err.message).toMatch(/schemaVersion/);
  });
});

describe("migrateDocument: version bounds", () => {
  it("rejects a newer version, naming v2 and the supported v1", () => {
    const err = expectLoadError(
      () => migrateDocument({ ...fourBarFixtureParsed, schemaVersion: 2 }),
      "newer-version",
    );
    expect(err.message).toContain("v2");
    expect(err.message).toContain("v1");
  });

  it("rejects schemaVersion 0 as no-migration", () => {
    expectLoadError(() => migrateDocument({ schemaVersion: 0 }), "no-migration");
  });
});

describe("migrateDocument: schema validation", () => {
  it("reports an unknown site reference with a precise path and message", () => {
    const firstJoint = fourBarFixtureParsed.joints[0];
    if (!firstJoint) throw new Error("fixture has no joints");
    const bad = {
      ...fourBarFixtureParsed,
      joints: [{ ...firstJoint, siteA: "nope" }, ...fourBarFixtureParsed.joints.slice(1)],
    };
    const err = expectLoadError(() => migrateDocument(bad), "invalid");
    const siteAIssue = err.issues.find((issue) => issue.path === "joints.0.siteA");
    expect(siteAIssue).toBeDefined();
    expect(siteAIssue?.message).toContain("unknown site");
    expect(err.message).toContain("joints.0.siteA");
    expect(err.message).toContain("unknown site");
  });

  it("migrates a v1 document missing units, defaulting units.length to mm", () => {
    const raw = structuredClone(fourBarFixtureParsed) as Record<string, unknown>;
    delete raw["units"];
    const doc = migrateDocument(raw);
    expect(doc.units.length).toBe("mm");
  });
});

describe("createMigrator: generic fake multi-version chain", () => {
  const addFieldB: MigrationStep = (d) => ({
    ...d,
    schemaVersion: 2,
    b: (d["a"] as number) + 1,
  });
  const renameBtoC: MigrationStep = (d) => {
    const rest = { ...d } as Record<string, unknown>;
    const b = rest["b"];
    delete rest["b"];
    return { ...rest, schemaVersion: 3, c: b };
  };

  it("turns {schemaVersion:1, a:1} into {schemaVersion:3, c:...}", () => {
    const migrate = createMigrator({
      currentVersion: 3,
      steps: { 1: addFieldB, 2: renameBtoC },
      schema: z.object({ schemaVersion: z.literal(3), c: z.number() }),
    });
    expect(migrate({ schemaVersion: 1, a: 1 })).toEqual({ schemaVersion: 3, c: 2 });
  });

  it("rejects a step that forgets to bump schemaVersion by exactly 1 (infinite-loop guard)", () => {
    const forgetsToBump: MigrationStep = (d) => ({ ...d, a: 1 });
    const migrate = createMigrator({
      currentVersion: 2,
      steps: { 1: forgetsToBump },
      schema: z.object({ schemaVersion: z.literal(2) }),
    });
    expectLoadError(() => migrate({ schemaVersion: 1 }), "no-migration");
  });

  it("rejects a gap in the migration chain", () => {
    const migrate = createMigrator({
      currentVersion: 3,
      steps: { 1: addFieldB },
      schema: z.object({ schemaVersion: z.literal(3) }),
    });
    expectLoadError(() => migrate({ schemaVersion: 1, a: 1 }), "no-migration");
  });
});

describe("migrateDocument: fuzz", () => {
  it("throws nothing but DocumentLoadError over 200 random inputs", () => {
    const rand = mulberry32(42);
    for (let i = 0; i < 200; i++) {
      const raw = i % 4 === 3 ? fourBarWithRandomDeletions(rand) : randomJsonValue(rand);
      try {
        const doc = migrateDocument(raw);
        expect(MechanismDocumentSchema.safeParse(doc).success).toBe(true);
      } catch (e) {
        expect(e).toBeInstanceOf(DocumentLoadError);
      }
    }
  });
});
