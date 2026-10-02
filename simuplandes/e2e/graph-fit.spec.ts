/**
 * Real-browser E2E for the 06-09 gap-closure legibility fixes (GRF-01/
 * GRF-05) at the exact 1280x720 viewport the user reviewed:
 * - The graph SVG renders at a real 1:1 screen-px scale (its viewBox size
 *   matches its own boundingBox size).
 * - Every node shape is drawn at a fixed on-screen size floor (>= 20 px).
 * - No two node shapes overlap in any layout, for a real Stephenson six-bar
 *   and for the SC-3 rigid-triangle fixture (L2/L3 specifically).
 * - Every node label is >= 10 real screen px tall, untruncated for the
 *   drawn Stephenson six-bar's names, and never overlaps any node shape
 *   (own or other) or any other label -- placed INSIDE its own node only
 *   when it fits there at a readable size, otherwise beside/below it.
 * - The ChecksStrip's chips (including the topology chip) are fully inside
 *   the 1280x720 viewport and inside the right dock, and are not covered by
 *   anything else (`elementFromPoint` at the chip's center hits the chip).
 *
 * 06-08's rule "every label sits fully inside its own node shape" is
 * INTENTIONALLY REPLACED here: a readable ~11-12px label of a name like
 * "coupler" is physically wider than a ~26px node, so 06-09 instead proves
 * "labels are readable and never overlap anything" -- see
 * 06-09-PLAN.md's must-haves for the full rationale.
 *
 * Collects `pageerror` events and asserts there are none, matching every
 * other graph E2E spec's convention.
 */
import { test, expect, type Page, type Locator } from "@playwright/test";
import { documentFromEdges } from "../src/graph/__fixtures__/fromEdges";
import { buildStephensonIII } from "../src/kinematics/__fixtures__/sixBars";
import { seedDocument } from "./helpers";

test.use({ viewport: { width: 1280, height: 720 } });

function trackPageErrors(page: Page): Error[] {
  const errors: Error[] = [];
  page.on("pageerror", (err) => errors.push(err));
  return errors;
}

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** AABB intersection test with a small tolerance (px) so touching edges don't false-positive. */
function boxesIntersect(a: Box, b: Box, tolerance: number): boolean {
  return (
    a.x + tolerance < b.x + b.width &&
    b.x + tolerance < a.x + a.width &&
    a.y + tolerance < b.y + b.height &&
    b.y + tolerance < a.y + a.height
  );
}

/** `inner` lies within `outer`'s bounds, with a small tolerance (px). */
function boxWithin(inner: Box, outer: Box, tolerance: number): boolean {
  return (
    inner.x + tolerance >= outer.x &&
    inner.y + tolerance >= outer.y &&
    inner.x + inner.width <= outer.x + outer.width + tolerance &&
    inner.y + inner.height <= outer.y + outer.height + tolerance
  );
}

async function requireBox(locator: Locator): Promise<Box> {
  const box = await locator.boundingBox();
  if (!box)
    throw new Error(
      `boundingBox() was null for ${await locator.evaluate((e) => e.outerHTML.slice(0, 120))}`,
    );
  return box;
}

/** Asserts every `[data-testid="graph-checks"]` chip is inside the 1280x720 viewport, inside the dock, and is hit by `elementFromPoint` at its own center. */
async function assertChecksStripVisible(page: Page): Promise<void> {
  const asideBox = await requireBox(page.locator('[role="complementary"]'));
  const chips = page.locator('[data-testid="graph-checks"] > *');
  const count = await chips.count();
  expect(count).toBeGreaterThanOrEqual(3); // at least mobility, baranov, topology

  const requiredTestIds = [
    "graph-check-mobility",
    "graph-check-baranov",
    "graph-check-assortment",
    "graph-check-topology",
  ];
  for (const testId of requiredTestIds) {
    const chip = page.getByTestId(testId);
    if ((await chip.count()) === 0) continue; // assortment/warnings chips are conditional
    const box = await requireBox(chip);
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.y + box.height).toBeLessThanOrEqual(720);
    expect(box.y + box.height).toBeLessThanOrEqual(asideBox.y + asideBox.height + 0.5);

    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;
    const hitsChip = await page.evaluate(
      ({ testId, cx, cy }) => {
        const el = document.elementFromPoint(cx, cy);
        const chipEl = document.querySelector(`[data-testid="${testId}"]`);
        return !!el && !!chipEl && (el === chipEl || chipEl.contains(el));
      },
      { testId, cx, cy },
    );
    expect(hitsChip, `elementFromPoint should hit ${testId} at its center`).toBe(true);
  }
}

/**
 * Real screen-pixel legibility assertions for the CURRENT layout:
 * 1. 1:1 scale: the svg's `viewBox` size matches its own boundingBox size.
 * 2. Every node shape's smaller dimension is >= 20 px (the on-screen size floor).
 * 3. No two node shapes overlap.
 * 4. Every node has exactly one label in `graph-labels`, >= 10px tall, inside the svg box.
 * 5. An "inside"-placed label sits inside its own node shape; every other label
 *    intersects NO node shape (own included).
 * 6. No two labels intersect each other.
 */
async function assertReadableAndNonOverlapping(page: Page): Promise<void> {
  const svg = page.locator('[data-testid="graph-svg"]');
  const svgBox = await requireBox(svg);
  const viewBoxAttr = (await svg.getAttribute("viewBox")) ?? "";
  const [, , vbWidthStr, vbHeightStr] = viewBoxAttr.split(/\s+/);
  const vbWidth = Number(vbWidthStr);
  const vbHeight = Number(vbHeightStr);
  expect(Math.abs(vbWidth - svgBox.width)).toBeLessThanOrEqual(2);
  expect(Math.abs(vbHeight - svgBox.height)).toBeLessThanOrEqual(2);

  const nodeGs = page.locator('[data-testid="graph-node"]');
  const n = await nodeGs.count();

  const shapeBoxes: Box[] = [];
  const nodeIds: string[] = [];
  for (let i = 0; i < n; i++) {
    const g = nodeGs.nth(i);
    const shape = g.locator('[data-role="node-shape"]');
    shapeBoxes.push(await requireBox(shape));
    nodeIds.push((await g.getAttribute("data-node-id")) ?? "");
    expect(Math.min(shapeBoxes[i].width, shapeBoxes[i].height)).toBeGreaterThanOrEqual(20);
  }
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      expect(
        boxesIntersect(shapeBoxes[i], shapeBoxes[j], 0.5),
        `node ${i} and node ${j} shapes must not overlap`,
      ).toBe(false);
    }
  }

  const labelBoxes: Box[] = [];
  for (let i = 0; i < n; i++) {
    const label = page.locator(`[data-testid="graph-labels"] [data-label-for="${nodeIds[i]}"]`);
    expect(await label.count(), `expected exactly one label for node ${nodeIds[i]}`).toBe(1);
    const labelBox = await requireBox(label);
    labelBoxes.push(labelBox);

    expect(labelBox.height).toBeGreaterThanOrEqual(10);
    expect(boxWithin(labelBox, svgBox, 1), `node ${i}'s label must sit inside the svg box`).toBe(
      true,
    );

    const placement = await label.getAttribute("data-label-placement");
    if (placement === "inside") {
      expect(
        boxWithin(labelBox, shapeBoxes[i], 1),
        `node ${i}'s inside-placed label must sit inside its shape`,
      ).toBe(true);
    } else {
      for (let j = 0; j < n; j++) {
        expect(
          boxesIntersect(labelBox, shapeBoxes[j], 0.5),
          `node ${i}'s outside-placed label must not overlap node ${j}'s shape`,
        ).toBe(false);
      }
    }
  }

  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      expect(
        boxesIntersect(labelBoxes[i], labelBoxes[j], 0.5),
        `node ${i} and node ${j} labels must not overlap`,
      ).toBe(false);
    }
  }
}

test("Stephenson six-bar: ChecksStrip fully visible, nodes don't overlap, labels readable, in every layout", async ({
  page,
}) => {
  const pageErrors = trackPageErrors(page);

  await seedDocument(page, buildStephensonIII().doc);
  await page.goto("/");
  await page.getByRole("tab", { name: "Grafo" }).click();
  await page.evaluate(() => document.fonts.ready);

  const layouts = ["Espacial", "Circular", "Por capas"];
  const expectedNames = new Set(["Tierra", "crank", "coupler", "rocker", "L5", "L6"]);
  for (const layoutLabel of layouts) {
    await page.getByRole("button", { name: layoutLabel, exact: true }).click();
    await page.evaluate(() => document.fonts.ready);

    await assertChecksStripVisible(page);
    await assertReadableAndNonOverlapping(page);

    const labels = page.locator('[data-testid="graph-labels"] [data-role="node-label"]');
    const count = await labels.count();
    expect(count).toBe(6);
    const texts = new Set<string>();
    for (let i = 0; i < count; i++) {
      const label = labels.nth(i);
      expect(await label.getAttribute("data-label-truncated")).toBe("false");
      texts.add((await label.textContent()) ?? "");
    }
    expect(texts).toEqual(expectedNames);
  }

  expect(pageErrors).toEqual([]);
});

test("SC-3 triangle (spatial): L2 and L3 separated, labels readable, issue rings don't overlap other nodes", async ({
  page,
}) => {
  const pageErrors = trackPageErrors(page);

  const { doc } = documentFromEdges(
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
  await page.evaluate(() => document.fonts.ready);

  await assertChecksStripVisible(page);
  await assertReadableAndNonOverlapping(page);

  // Every issue-flagged node's own `[data-role="issue-ring"]` box must not
  // intersect any OTHER node's own shape boundingBox.
  const nodeGs = page.locator('[data-testid="graph-node"]');
  const n = await nodeGs.count();
  const shapeBoxes: Box[] = [];
  for (let i = 0; i < n; i++) {
    shapeBoxes.push(await requireBox(nodeGs.nth(i).locator('[data-role="node-shape"]')));
  }

  let issueCount = 0;
  for (let i = 0; i < n; i++) {
    const issue = await nodeGs.nth(i).getAttribute("data-issue");
    if (issue !== "true") continue;
    issueCount += 1;
    const ring = nodeGs.nth(i).locator('[data-role="issue-ring"]');
    expect(await ring.count()).toBe(1);
    const ringBox = await requireBox(ring);
    for (let j = 0; j < n; j++) {
      if (j === i) continue;
      expect(
        boxesIntersect(ringBox, shapeBoxes[j], 0.5),
        `issue node ${i}'s issue-ring must not overlap node ${j}'s shape`,
      ).toBe(false);
    }
  }
  expect(issueCount).toBe(3);

  expect(pageErrors).toEqual([]);
});
