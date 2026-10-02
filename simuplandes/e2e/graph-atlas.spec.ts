/**
 * Real-browser E2E for SC-4 (GRF-04): a drawn Stephenson six-bar is
 * identified as "Cadena de Stephenson" (es) / "Stephenson chain" (en); a
 * Watt six-bar is not confused with it; an 8-bar built from a permuted
 * atlas topology is identified by its atlas id regardless of node
 * labeling. Collects `pageerror` events and asserts there are none.
 *
 * Reads `src/graph/atlas/eightbar.json` directly via `fs.readFileSync` (not
 * `atlasData.ts`, which uses `import.meta.glob` and cannot be imported from
 * Node-run E2E code).
 */
import { test, expect, type Page } from "@playwright/test";
import * as fs from "node:fs";
import { documentFromEdges } from "../src/graph/__fixtures__/fromEdges";
import { buildStephensonIII, buildWattII } from "../src/kinematics/__fixtures__/sixBars";
import { seedDocument } from "./helpers";

function trackPageErrors(page: Page): Error[] {
  const errors: Error[] = [];
  page.on("pageerror", (err) => errors.push(err));
  return errors;
}

interface AtlasTopologyEntry {
  id: string;
  name: "watt" | "stephenson" | null;
  assortment: [number, number, number, number];
  edges: [number, number][];
}

interface AtlasFile {
  nLinks: number;
  topologies: AtlasTopologyEntry[];
}

const eightBarAtlas: AtlasFile = JSON.parse(
  fs.readFileSync("src/graph/atlas/eightbar.json", "utf8"),
) as AtlasFile;

// A fixed derangement of 0..7 (no fixed points): permutes atlas node
// indices before drawing, so identification is proven independent of the
// atlas's own numbering, not just a literal replay of it.
const PERMUTATION = [3, 0, 6, 1, 7, 2, 5, 4];

function permuteEdges(edges: readonly (readonly [number, number])[]): [number, number][] {
  return edges.map(([a, b]) => [PERMUTATION[a], PERMUTATION[b]]);
}

test("A drawn Stephenson six-bar is identified as Stephenson chain", async ({ page }) => {
  const pageErrors = trackPageErrors(page);
  await seedDocument(page, buildStephensonIII().doc);
  await page.goto("/");
  await page.getByRole("tab", { name: "Grafo" }).click();

  const topologyChip = page.getByTestId("graph-check-topology");
  await expect(topologyChip).toHaveAttribute("data-topology-id", "T6B_S");
  await expect(topologyChip).toContainText("Cadena de Stephenson");

  await page.getByRole("button", { name: "EN", exact: true }).click();
  await expect(topologyChip).toContainText("Stephenson chain");

  expect(pageErrors).toEqual([]);
});

test("Watt is not confused with Stephenson", async ({ page }) => {
  const pageErrors = trackPageErrors(page);
  await seedDocument(page, buildWattII().doc);
  await page.goto("/");
  await page.getByRole("tab", { name: "Grafo" }).click();

  const topologyChip = page.getByTestId("graph-check-topology");
  await expect(topologyChip).toHaveAttribute("data-topology-id", "T6B_W");
  await expect(topologyChip).toContainText("Cadena de Watt");

  expect(pageErrors).toEqual([]);
});

test.describe("An 8-bar from the atlas is identified by its topology ID", () => {
  const first = eightBarAtlas.topologies[0];
  const middle = eightBarAtlas.topologies.find(
    (t) => JSON.stringify(t.assortment) === JSON.stringify([5, 2, 1, 0]),
  );
  const last = eightBarAtlas.topologies[eightBarAtlas.topologies.length - 1];
  if (!first || !middle || !last) {
    throw new Error("eightbar.json fixture is missing an expected entry");
  }
  const samples: AtlasTopologyEntry[] = [first, middle, last];

  for (const entry of samples) {
    test(`entry ${entry.id}`, async ({ page }) => {
      const pageErrors = trackPageErrors(page);
      const { doc } = documentFromEdges(permuteEdges(entry.edges), { name: entry.id });
      await seedDocument(page, doc);
      await page.goto("/");
      await page.getByRole("tab", { name: "Grafo" }).click();

      const topologyChip = page.getByTestId("graph-check-topology");
      await expect(topologyChip).toHaveAttribute("data-topology-id", entry.id);
      await expect(topologyChip).toContainText("8 barras");
      await expect(topologyChip).toContainText(entry.id);

      expect(pageErrors).toEqual([]);
    });
  }
});
