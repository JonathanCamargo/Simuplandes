/**
 * Manual-review artifacts for the orchestrator's visual pass (the
 * VALIDATION manual-only row): Simulate mode's plots + DOF badge in light
 * and dark, es and en. Still asserts there are no `pageerror`s.
 */
import { test, expect, type Page } from "@playwright/test";
import { loadExampleFourBar, pressSpace } from "./helpers";

function trackPageErrors(page: Page): Error[] {
  const errors: Error[] = [];
  page.on("pageerror", (err) => errors.push(err));
  return errors;
}

test("Simulate-mode screenshots (light/dark, es/en)", async ({ page }) => {
  const pageErrors = trackPageErrors(page);
  await page.goto("/");
  await loadExampleFourBar(page);
  await pressSpace(page);

  const slider = page.getByRole("slider", { name: /Entrada/ });
  await slider.focus();
  for (let i = 0; i < 60; i++) {
    await page.keyboard.press("ArrowRight");
  }

  await page.getByText("Gráficas ▾").click();
  await expect(page.getByRole("region", { name: "Panel de gráficas" })).toBeVisible();

  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: "test-results/screenshots/simulate-light-es.png" });

  await page.click('button[aria-label="Oscuro"]');
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: "test-results/screenshots/simulate-dark-es.png" });

  await page.getByRole("button", { name: "EN", exact: true }).click();
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: "test-results/screenshots/simulate-dark-en.png" });

  await page.click('button[aria-label="Light"]');
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: "test-results/screenshots/simulate-light-en.png" });

  // Back to dark AND back to es (the file name says "-es"), then the DOF
  // popover.
  await page.click('button[aria-label="Dark"]');
  await page.getByRole("button", { name: "ES", exact: true }).click();
  await page.getByTestId("dof-badge").click();
  await expect(page.getByRole("dialog")).toBeVisible();
  // MUI's Popover Grow transition takes ~225ms to fully paint -- an
  // explicit settle wait (matching `i18n-theme.spec.ts`'s own precedent for
  // a Menu's exit transition), not just a `role="dialog"` presence check,
  // is what's actually needed before a pixel capture.
  await page.waitForTimeout(300);
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: "test-results/screenshots/simulate-dof-popover-dark-es.png" });

  expect(pageErrors).toEqual([]);
});
