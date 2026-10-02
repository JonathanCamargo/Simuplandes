import { describe, it, expect } from "vitest";
import type { ImportCode } from "../interchange/importReport";
import { createI18n, loadLocaleResources, collectKeys, assertLocaleTree } from "./i18n";

describe("loadLocaleResources", () => {
  it("loads the atlas, canvas, common, export, gallery, graph, import, inspector, palette, shell, sim and tools namespaces for both languages", () => {
    const resources = loadLocaleResources();
    expect(Object.keys(resources.es.translation).sort()).toEqual([
      "atlas",
      "canvas",
      "common",
      "export",
      "gallery",
      "graph",
      "import",
      "inspector",
      "palette",
      "shell",
      "sim",
      "tools",
    ]);
    expect(Object.keys(resources.en.translation).sort()).toEqual([
      "atlas",
      "canvas",
      "common",
      "export",
      "gallery",
      "graph",
      "import",
      "inspector",
      "palette",
      "shell",
      "sim",
      "tools",
    ]);
  });

  it("has identical recursive key sets in es and en for every namespace", () => {
    const resources = loadLocaleResources();
    for (const ns of Object.keys(resources.en.translation)) {
      const esKeys = collectKeys(resources.es.translation[ns]).sort();
      const enKeys = collectKeys(resources.en.translation[ns]).sort();
      expect(esKeys, `namespace "${ns}"`).toEqual(enKeys);
    }
  });

  it("has no empty strings anywhere", () => {
    const resources = loadLocaleResources();
    for (const lang of ["es", "en"] as const) {
      for (const [ns, tree] of Object.entries(resources[lang].translation)) {
        for (const key of collectKeys(tree)) {
          const value = key.split(".").reduce<unknown>((cursor, part) => {
            return typeof cursor === "object" && cursor !== null
              ? (cursor as Record<string, unknown>)[part]
              : undefined;
          }, tree);
          expect(value, `${lang}.${ns}.${key}`).not.toBe("");
        }
      }
    }
  });
});

describe("assertLocaleTree", () => {
  it("accepts a valid string-leaves-only tree", () => {
    expect(() =>
      assertLocaleTree("./locales/es/common.json", { a: "x", b: { c: "y" } }),
    ).not.toThrow();
  });

  it("throws for a non-string leaf", () => {
    expect(() => assertLocaleTree("./locales/es/bad.json", { a: 1 })).toThrow(
      /Invalid locale data/,
    );
  });

  it("throws for an array value", () => {
    expect(() => assertLocaleTree("./locales/es/bad.json", ["x"])).toThrow(/Invalid locale data/);
  });

  it("throws for a null value", () => {
    expect(() => assertLocaleTree("./locales/es/bad.json", null)).toThrow(/Invalid locale data/);
  });
});

describe("collectKeys", () => {
  it("collects dotted paths from a nested object", () => {
    expect(collectKeys({ a: "x", b: { c: "y", d: { e: "z" } } }).sort()).toEqual([
      "a",
      "b.c",
      "b.d.e",
    ]);
  });
});

describe("createI18n", () => {
  it("returns the Spanish string for shell.appName", () => {
    const i18n = createI18n("es");
    expect(i18n.t("shell.appName")).toBe("Simuplandes Studio");
    expect(i18n.t("shell.menu.new")).toBe("Nuevo");
  });

  it("changeLanguage on the same instance switches to English", async () => {
    const i18n = createI18n("es");
    expect(i18n.t("shell.menu.new")).toBe("Nuevo");
    await i18n.changeLanguage("en");
    expect(i18n.t("shell.menu.new")).toBe("New");
  });

  it("falls back to en for a key missing in es", () => {
    const i18n = createI18n("es");
    i18n.addResourceBundle(
      "en",
      "translation",
      { test: { onlyEn: "only in english" } },
      true,
      true,
    );
    expect(i18n.t("test.onlyEn")).toBe("only in english");
  });

  it("two instances created independently do not share language state", async () => {
    const a = createI18n("es");
    const b = createI18n("es");
    await a.changeLanguage("en");
    expect(a.language).toBe("en");
    expect(b.language).toBe("es");
  });

  it("resolves the sim.dof.explain.redundantMobile plural keys in es and en", () => {
    const es = createI18n("es");
    const en = createI18n("en");

    expect(es.t("sim.dof.explain.redundantMobile", { f: 0, rank: 1, count: 1 })).toContain(
      "se mueve con 1 GDL",
    );
    expect(en.t("sim.dof.explain.redundantMobile", { f: 0, rank: 1, count: 1 })).toContain(
      "moves with 1 DOF",
    );

    expect(es.t("sim.dof.explain.redundantMobile", { f: 0, rank: 1, count: 2 })).toContain(
      "restricciones redundantes",
    );
  });
});

describe("import namespace", () => {
  const ALL_CODES: Record<ImportCode, true> = {
    unparseable: true,
    "unknown-format": true,
    "too-large": true,
    "empty-graph": true,
    "no-ground": true,
    "self-loop": true,
    "duplicate-edge": true,
    disconnected: true,
    "partial-positions": true,
    "missing-input": true,
    "several-inputs": true,
    "input-not-on-ground": true,
    "unsupported-joint": true,
    "prismatic-no-axis": true,
    "multi-joint": true,
    "units-unknown": true,
    "layout-applied": true,
    "layout-unavailable": true,
    "lengths-infeasible": true,
    "not-one-dof-topology": true,
    "dof-not-one": true,
    "not-drivable": true,
    "assembly-failed": true,
    "low-mobility": true,
  };
  const FIX_IDS = [
    "default-axis",
    "revolute",
    "skip",
    "drop",
    "keep",
    "none",
    "input",
    "ground",
    "layout",
    "centroid",
    "retry-layout",
    "keep-star",
  ];

  it("has a report string for every ImportCode and a fix string for every fix id, in es and en", () => {
    for (const lang of ["es", "en"] as const) {
      const i18n = createI18n(lang);
      for (const code of Object.keys(ALL_CODES)) {
        expect(i18n.exists(`import.report.${code}`), `${lang} report ${code}`).toBe(true);
      }
      for (const id of FIX_IDS) {
        expect(i18n.exists(`import.fix.${id}`), `${lang} fix ${id}`).toBe(true);
      }
    }
  });

  it("interpolates report params", () => {
    const en = createI18n("en");
    expect(en.t("import.report.low-mobility", { rangeDeg: 12, threshold: 60 })).toBe(
      "The input only moves 12° (below 60°).",
    );
  });
});
