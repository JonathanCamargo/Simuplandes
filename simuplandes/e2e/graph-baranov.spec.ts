/**
 * Real-browser E2E for SC-3 (GRF-03): a rigid three-link triangle riveted
 * onto an otherwise-valid four-bar is flagged by Baranov (even though
 * Gruebler's F = 1 misses it) and the 3 offending links are highlighted in
 * both the graph panel and the canvas; fixing it (deleting the offending
 * link) clears every issue flag. Collects `pageerror` events and asserts
 * there are none.
 */
import { test, expect, type Page } from "@playwright/test";
import { documentFromEdges } from "../src/graph/__fixtures__/fromEdges";
import { GROUND_NODE_ID } from "../src/graph/types";
import { seedDocument } from "./helpers";
import type { CanvasHaloState } from "../src/canvas/layers/canvasTestHook";

/** Node 0 (ground, per `documentFromEdges`'s default) merges into `GROUND_NODE_ID` -- every other node's `data-node-id` is its own document link id. */
function graphNodeIdOf(node: number, linkIdOf: (node: number) => string): string {
  return node === 0 ? GROUND_NODE_ID : linkIdOf(node);
}

function trackPageErrors(page: Page): Error[] {
  const errors: Error[] = [];
  page.on("pageerror", (err) => errors.push(err));
  return errors;
}

async function canvasHalo(page: Page, id: string): Promise<CanvasHaloState | null> {
  return page.evaluate((entityId: string) => {
    const hook = window.__simuplandesCanvas;
    if (!hook) {
      throw new Error(
        "window.__simuplandesCanvas is not installed -- the DEV-only canvas test hook is missing (is this a production build?)",
      );
    }
    return hook.haloState(entityId);
  }, id);
}

test("A rigid three-link triangle is flagged by Baranov and highlighted in both views", async ({
  page,
}) => {
  const pageErrors = trackPageErrors(page);

  // A four-bar loop (nodes 0-3) with a rigid triangle (nodes 2, 4, 5)
  // riveted onto node 2 -- the SC-3 golden fixture (06-01-SUMMARY.md).
  const { doc, linkIdOf, jointIdOf } = documentFromEdges(
    [
      [0, 1],
      [1, 2],
      [2, 3],
      [3, 0],
      [2, 4],
      [4, 5],
      [5, 2],
    ],
    { name: "Triangle on four-bar" },
  );
  await seedDocument(page, doc);
  await page.goto("/");
  await page.getByRole("tab", { name: "Grafo" }).click();

  const baranovChip = page.getByTestId("graph-check-baranov");
  await expect(baranovChip).toHaveAttribute("data-status", "fail");
  await expect(baranovChip).toContainText("subcadena rígida");

  // Gruebler's F still reports 1 (misses the rigid subchain) -- the whole
  // point of Baranov.
  await expect(page.getByTestId("graph-check-mobility")).toHaveAttribute("data-severity", "ok");

  const offendingNodeIds = new Set([linkIdOf(2), linkIdOf(4), linkIdOf(5)]);
  for (let node = 0; node < 6; node++) {
    const graphNodeId = graphNodeIdOf(node, linkIdOf);
    await expect(page.locator(`[data-node-id="${graphNodeId}"]`)).toHaveAttribute(
      "data-issue",
      offendingNodeIds.has(linkIdOf(node)) ? "true" : "false",
    );
  }

  const offendingEdgeIds = new Set([jointIdOf(4), jointIdOf(5), jointIdOf(6)]);
  for (let edge = 0; edge < 7; edge++) {
    const id = jointIdOf(edge);
    await expect(page.locator(`[data-edge-id="${id}"]`)).toHaveAttribute(
      "data-issue",
      offendingEdgeIds.has(id) ? "true" : "false",
    );
  }

  for (const node of [2, 4, 5]) {
    await expect.poll(async () => (await canvasHalo(page, linkIdOf(node)))?.issue).toBe(true);
  }
  for (const node of [1, 3]) {
    await expect.poll(async () => (await canvasHalo(page, linkIdOf(node)))?.issue).toBe(false);
  }

  // Fix it in the app: select link 5's graph node and delete it.
  await page.locator(`[data-node-id="${linkIdOf(5)}"]`).click();
  await page.keyboard.press("Delete");

  await expect(baranovChip).toHaveAttribute("data-status", "pass");
  await expect(page.locator(`[data-node-id="${linkIdOf(5)}"]`)).toHaveCount(0);
  for (const node of [0, 1, 2, 3, 4]) {
    await expect(page.locator(`[data-node-id="${graphNodeIdOf(node, linkIdOf)}"]`)).toHaveAttribute(
      "data-issue",
      "false",
    );
  }

  for (const node of [2, 4]) {
    await expect.poll(async () => (await canvasHalo(page, linkIdOf(node)))?.issue).toBe(false);
  }
  expect(await canvasHalo(page, linkIdOf(5))).toBeNull();

  expect(pageErrors).toEqual([]);
});
