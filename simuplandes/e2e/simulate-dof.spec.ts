/**
 * Real-browser E2E for SC-4 (SIM-06): the live "F = n" DOF badge and its
 * explanation popover, in Build mode (the badge is visible in BOTH modes --
 * this file exercises Build, `simulate-mode.spec.ts` already covers
 * Simulate's own transport/status text). Every test collects `pageerror`
 * events and asserts there are none.
 */
import { test, expect, type Page } from "@playwright/test";
import {
  clickCanvasPoint,
  getSimInput,
  getSimPoses,
  loadExampleFourBar,
  maxJointResidual,
  pressSpace,
  readSessionDocument,
  seedDocument,
} from "./helpers";
import { build as buildDoubleParallelogram } from "../src/kinematics/__fixtures__/doubleParallelogram";

function trackPageErrors(page: Page): Error[] {
  const errors: Error[] = [];
  page.on("pageerror", (err) => errors.push(err));
  return errors;
}

test("F = 1 for the four-bar", async ({ page }) => {
  const pageErrors = trackPageErrors(page);
  await page.goto("/");
  await loadExampleFourBar(page);

  const badge = page.getByTestId("dof-badge");
  await expect(badge).toHaveText("F = 1");
  await expect(badge).toHaveAttribute("data-severity", "ok");

  await badge.click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("Un grado de libertad");
  await expect(dialog).toContainText("3(4 − 1) − 2·4 = 1");

  await page.keyboard.press("Escape");

  expect(pageErrors).toEqual([]);
});

test("F = 0 when a redundant bar is added, with an explanation", async ({ page }) => {
  const pageErrors = trackPageErrors(page);
  await page.goto("/");
  await loadExampleFourBar(page);

  await page.click('[data-tool-id="bar"]');
  await clickCanvasPoint(page, { x: 20, y: 20 * Math.sqrt(3) }); // A
  await clickCanvasPoint(page, { x: 100, y: 0 }); // O4
  await page.keyboard.press("Escape");

  const doc = await readSessionDocument(page);
  expect(doc.links.length).toBe(5);
  expect(doc.joints.length).toBe(6);

  const badge = page.getByTestId("dof-badge");
  await expect(badge).toHaveText("F = 0");
  await expect(badge).toHaveAttribute("data-severity", "error");

  await badge.click();
  await expect(page.getByRole("dialog")).toContainText("es una estructura; no puede moverse");
  await page.keyboard.press("Escape");

  await page.getByRole("button", { name: "EN", exact: true }).click();
  await badge.click();
  await expect(page.getByRole("dialog")).toContainText("this is a structure; it cannot move");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toBeHidden();

  await pressSpace(page);
  await expect(page.getByRole("region", { name: "Transport" })).toContainText("cannot move");

  expect(pageErrors).toEqual([]);
});

test("Double parallelogram: F = 0 but it moves (redundant constraint explained)", async ({
  page,
}) => {
  const pageErrors = trackPageErrors(page);
  await seedDocument(page, buildDoubleParallelogram());
  await page.goto("/");

  const badge = page.getByTestId("dof-badge");
  await expect(badge).toHaveText("F = 0");
  await expect(badge).toHaveAttribute("data-severity", "warn");

  await badge.click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("se mueve con 1 GDL");
  await expect(dialog).toContainText("restricción redundante");
  await page.keyboard.press("Escape");

  await pressSpace(page);
  const doc = await readSessionDocument(page);
  const slider = page.getByRole("slider");
  await slider.focus();
  const before = (await getSimInput(page))?.display ?? 0;
  for (let i = 0; i < 20; i++) {
    await page.keyboard.press("ArrowRight");
  }
  const after = (await getSimInput(page))?.display ?? 0;
  expect(after - before).toBeCloseTo(20, 1);

  const poses = await getSimPoses(page);
  expect(maxJointResidual(doc, poses)).toBeLessThan(1e-6);

  expect(pageErrors).toEqual([]);
});
