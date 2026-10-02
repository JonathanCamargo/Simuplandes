/**
 * Success criterion 5: live EN/ES and light/dark switching, with NO
 * navigation/reload. Also produces the four manual-review screenshots
 * (`test-results/screenshots/studio-{light,dark}-{es,en}.png`) listed in
 * 04-VALIDATION.md's Manual-Only Verifications table.
 */
import { test, expect } from "@playwright/test";

test("EN/ES and light/dark switch live (no reload); example four-bar screenshots", async ({
  page,
}) => {
  await page.goto("/");
  await page.evaluate(() => {
    (window as unknown as { __noReload: number }).__noReload = 1;
  });

  // Load the example four-bar (Spanish menu labels, the default language)
  // before the first screenshot, so all four have the same content.
  await page.click("text=Archivo");
  await page.click("text=Cargar ejemplo de cuatro barras");
  // MUI's Menu strips its `role="menu"` (so `toBeHidden()` resolves) at the
  // START of its exit transition, well before the ~225ms Grow fade-out
  // actually finishes painting -- an explicit settle wait, not a polled
  // element-state check, is what's actually needed before a pixel capture.
  await page.waitForTimeout(300);

  await page.screenshot({ path: "test-results/screenshots/studio-light-es.png" });

  // Click EN: rail tooltips/aria-labels switch live, h1 stays mounted (no
  // route change / remount).
  const h1Before = page.getByRole("heading", { level: 1 });
  await expect(h1Before).toBeVisible();
  await page.click('button:has-text("EN")');
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.locator('[data-tool-id="bar"]')).toHaveAttribute("aria-label", /Bar/);

  await page.screenshot({ path: "test-results/screenshots/studio-light-en.png" });

  // Toggle the theme: `<html data-theme>` changes.
  const themeBefore = await page.evaluate(() => document.documentElement.dataset.theme);
  await page.click('button[aria-label="Dark"]');
  const themeAfter = await page.evaluate(() => document.documentElement.dataset.theme);
  expect(themeAfter).not.toBe(themeBefore);
  expect(themeAfter).toBe("dark");

  await page.screenshot({ path: "test-results/screenshots/studio-dark-en.png" });

  // Back to ES, still dark.
  await page.click('button:has-text("ES")');
  await expect(page.locator('[data-tool-id="bar"]')).toHaveAttribute("aria-label", /Barra/);

  await page.screenshot({ path: "test-results/screenshots/studio-dark-es.png" });

  const noReload = await page.evaluate(
    () => (window as unknown as { __noReload: number }).__noReload,
  );
  expect(noReload).toBe(1);
});
