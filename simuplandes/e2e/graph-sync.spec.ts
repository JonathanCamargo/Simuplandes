/**
 * Real-browser E2E for SC-1 (GRF-01): drawing a bar with the real bar tool
 * adds a node and its edges to the graph panel immediately (Playwright
 * auto-wait, no fixed sleeps), and undo removes them again. Collects
 * `pageerror` events and asserts there are none.
 */
import { test, expect, type Page } from "@playwright/test";
import { clickCanvasPoint, loadExampleFourBar, readSessionDocument } from "./helpers";

function trackPageErrors(page: Page): Error[] {
  const errors: Error[] = [];
  page.on("pageerror", (err) => errors.push(err));
  return errors;
}

test("Adding a bar on the canvas adds a node and edges in the graph panel", async ({ page }) => {
  const pageErrors = trackPageErrors(page);
  await page.goto("/");
  await page.getByRole("tab", { name: "Grafo" }).click();
  await loadExampleFourBar(page);

  await expect(page.getByTestId("graph-node")).toHaveCount(4);
  await expect(page.getByTestId("graph-edge")).toHaveCount(4);
  await expect(page.getByTestId("graph-check-topology")).toHaveAttribute(
    "data-topology-id",
    "four-bar",
  );
  await expect(page.getByTestId("graph-check-mobility")).toHaveAttribute("data-severity", "ok");

  // Draw a bar with the real bar tool, exactly like simulate-dof.spec.ts's
  // redundant-bar test: A -> O4, both ends snap onto existing joint sites.
  await page.click('[data-tool-id="bar"]');
  await clickCanvasPoint(page, { x: 20, y: 20 * Math.sqrt(3) }); // A
  await clickCanvasPoint(page, { x: 100, y: 0 }); // O4
  await page.keyboard.press("Escape");

  // Immediately (Playwright auto-wait on toHaveCount/toHaveAttribute, no
  // fixed sleeps): 5 nodes, 6 edges, F = 0.
  await expect(page.getByTestId("graph-node")).toHaveCount(5);
  await expect(page.getByTestId("graph-edge")).toHaveCount(6);

  const doc = await readSessionDocument(page);
  expect(doc.links).toHaveLength(5);
  const newLink = doc.links[doc.links.length - 1];
  await expect(page.locator(`[data-node-id="${newLink.id}"]`)).toHaveCount(1);

  await expect(page.getByTestId("graph-check-mobility")).toHaveAttribute("data-severity", "error");

  // Undo -> back to 4 nodes / 4 edges.
  await page.keyboard.press("Control+z");
  await expect(page.getByTestId("graph-node")).toHaveCount(4);
  await expect(page.getByTestId("graph-edge")).toHaveCount(4);
  await expect(page.getByTestId("graph-check-mobility")).toHaveAttribute("data-severity", "ok");

  expect(pageErrors).toEqual([]);
});
