/**
 * Regression guard for the 04-07 gap-closure fix: react-resizable-panels v4
 * reads a bare NUMBER Panel size prop as PIXELS, not percent. Before the
 * fix, `StudioShell.tsx` passed bare numbers (`maxSize={50}`), which capped
 * the right dock (Inspector/Graph/Export) at a hard ~50 PIXELS wide on any
 * screen size -- the "Inspector" tab title rendered clipped to "ECTOR", and
 * jsdom/RTL component tests never caught it because they never render
 * through react-resizable-panels' real (pixel) layout math. This spec runs
 * in a real browser so it actually measures rendered widths.
 */
import { test, expect, type Page } from "@playwright/test";

const PREFS_KEY = "simuplandes:ui-prefs";
const RAIL_WIDTH = 52;

function dock(page: Page) {
  return page.getByRole("complementary");
}

function inspectorTab(page: Page) {
  return page.getByRole("tab", { name: "Inspector" });
}

function readPrefs(page: Page): Promise<Record<string, unknown> | null> {
  return page.evaluate((key): Record<string, unknown> | null => {
    const raw = window.localStorage.getItem(key);
    return raw === null ? null : (JSON.parse(raw) as Record<string, unknown>);
  }, PREFS_KEY);
}

test.describe("dock layout (right dock width, tab clipping, migration, persistence)", () => {
  test("default dock is ~26% wide and the Inspector tab is not clipped", async ({ page }) => {
    await page.goto("/");

    const viewport = page.viewportSize();
    if (!viewport) throw new Error("no viewport size reported");
    const mainWidth = viewport.width - RAIL_WIDTH;

    const dockLocator = dock(page);
    await expect(dockLocator).toBeVisible();
    const dockBox = await dockLocator.boundingBox();
    if (!dockBox) throw new Error("dock has no bounding box");

    // Key regression assertion: the old (buggy) build gave a ~50px dock,
    // which is nowhere near 20% of a 1280px-wide viewport.
    expect(dockBox.width).toBeGreaterThanOrEqual(0.2 * viewport.width);

    const ratio = dockBox.width / mainWidth;
    expect(ratio).toBeGreaterThanOrEqual(0.26 - 0.03);
    expect(ratio).toBeLessThanOrEqual(0.26 + 0.03);

    const tab = inspectorTab(page);
    await expect(tab).toBeVisible();
    const tabBox = await tab.boundingBox();
    if (!tabBox) throw new Error("Inspector tab has no bounding box");
    expect(tabBox.x).toBeGreaterThanOrEqual(dockBox.x - 1);
    expect(tabBox.x + tabBox.width).toBeLessThanOrEqual(dockBox.x + dockBox.width + 1);

    // No horizontal clipping of the tab's own text.
    const noHorizontalClip = await tab.evaluate((el) => el.scrollWidth <= el.clientWidth);
    expect(noHorizontalClip).toBe(true);

    // The label renders as one line reading "Inspector" (MUI uppercases via
    // CSS only, so the underlying text content is unaffected).
    const tabText = (await tab.innerText()).trim();
    expect(tabText.toLowerCase()).toBe("inspector");
  });

  test("a pre-fix persisted dock size (15, unversioned) is migrated to the default", async ({
    page,
  }) => {
    await page.addInitScript(
      ({ key, value }) => {
        window.localStorage.setItem(key, JSON.stringify(value));
      },
      {
        key: PREFS_KEY,
        value: {
          themeMode: "light",
          language: "es",
          gridVisible: true,
          snapEnabled: true,
          dockSizePct: 15,
        },
      },
    );
    await page.goto("/");

    const viewport = page.viewportSize();
    if (!viewport) throw new Error("no viewport size reported");
    const mainWidth = viewport.width - RAIL_WIDTH;

    const dockLocator = dock(page);
    await expect(dockLocator).toBeVisible();
    const dockBox = await dockLocator.boundingBox();
    if (!dockBox) throw new Error("dock has no bounding box");

    const ratio = dockBox.width / mainWidth;
    expect(ratio).toBeGreaterThanOrEqual(0.26 - 0.03);
    expect(ratio).toBeLessThanOrEqual(0.26 + 0.03);

    // onResize fires on mount too, so the migrated value gets re-saved.
    const prefs = await readPrefs(page);
    expect(prefs?.dockLayoutVersion).toBe(2);
    const dockSizePct = prefs?.dockSizePct as number;
    expect(dockSizePct).toBeGreaterThanOrEqual(26 - 1);
    expect(dockSizePct).toBeLessThanOrEqual(26 + 1);
  });

  test("a versioned 40% dock round-trips in percent units", async ({ page }) => {
    await page.addInitScript(
      ({ key, value }) => {
        window.localStorage.setItem(key, JSON.stringify(value));
      },
      {
        key: PREFS_KEY,
        value: {
          themeMode: "light",
          language: "es",
          gridVisible: true,
          snapEnabled: true,
          dockSizePct: 40,
          dockLayoutVersion: 2,
        },
      },
    );
    await page.goto("/");

    const viewport = page.viewportSize();
    if (!viewport) throw new Error("no viewport size reported");
    const mainWidth = viewport.width - RAIL_WIDTH;

    const dockLocator = dock(page);
    await expect(dockLocator).toBeVisible();
    const dockBox = await dockLocator.boundingBox();
    if (!dockBox) throw new Error("dock has no bounding box");

    const ratio = dockBox.width / mainWidth;
    expect(ratio).toBeGreaterThanOrEqual(0.4 - 0.03);
    expect(ratio).toBeLessThanOrEqual(0.4 + 0.03);

    const prefs = await readPrefs(page);
    const dockSizePct = prefs?.dockSizePct as number;
    expect(dockSizePct).toBeGreaterThanOrEqual(40 - 1);
    expect(dockSizePct).toBeLessThanOrEqual(40 + 1);
  });

  test("dragging the separator resizes the dock and survives reload", async ({ page }) => {
    await page.goto("/");

    const dockLocator = dock(page);
    await expect(dockLocator).toBeVisible();
    const dockBoxBefore = await dockLocator.boundingBox();
    if (!dockBoxBefore) throw new Error("dock has no bounding box");

    const separator = page.getByRole("separator");
    await expect(separator).toBeVisible();
    const separatorBox = await separator.boundingBox();
    if (!separatorBox) throw new Error("separator has no bounding box");

    const startX = separatorBox.x + separatorBox.width / 2;
    const startY = separatorBox.y + separatorBox.height / 2;

    await page.mouse.move(startX, startY);
    await page.mouse.down();
    const steps = 10;
    const totalDelta = -150; // move left -> dock gets wider
    for (let i = 1; i <= steps; i++) {
      await page.mouse.move(startX + (totalDelta * i) / steps, startY, { steps: 1 });
    }
    await page.mouse.up();

    const dockBoxAfter = await dockLocator.boundingBox();
    if (!dockBoxAfter) throw new Error("dock has no bounding box after drag");
    expect(dockBoxAfter.width - dockBoxBefore.width).toBeGreaterThan(100);

    const prefsAfterDrag = await readPrefs(page);
    const dockSizePctAfterDrag = prefsAfterDrag?.dockSizePct as number;
    expect(dockSizePctAfterDrag).toBeGreaterThanOrEqual(15);
    expect(dockSizePctAfterDrag).toBeLessThanOrEqual(50);
    expect(dockSizePctAfterDrag).toBeGreaterThan(26);

    // Do NOT use addInitScript here -- it would re-seed localStorage on
    // reload and mask a real persistence regression.
    await page.reload();

    const viewport = page.viewportSize();
    if (!viewport) throw new Error("no viewport size reported");
    const mainWidth = viewport.width - RAIL_WIDTH;

    await expect(dockLocator).toBeVisible();
    const dockBoxReloaded = await dockLocator.boundingBox();
    if (!dockBoxReloaded) throw new Error("dock has no bounding box after reload");

    expect(Math.abs(dockBoxReloaded.width - dockBoxAfter.width)).toBeLessThanOrEqual(
      0.03 * mainWidth,
    );
  });
});
