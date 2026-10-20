/**
 * Real-browser E2E for dynamics: a double pendulum (2 DOF, no motor, which
 * Kinematics cannot drive) integrates in the background, plays in
 * Dynamics with its joints closed; and the Spring tool draws a spring.
 * Every test collects `pageerror` events and asserts there are none.
 */
import { test, expect } from "@playwright/test";
import {
  clickCanvasPoint,
  getSimDynamics,
  getSimPoses,
  getSimReadout,
  loadExampleFourBar,
  maxJointResidual,
  pressSpace,
  readSessionDocument,
  seedDocument,
} from "./helpers";
import { buildDoublePendulum } from "../src/examples/dynamicsExamples";

test("a double pendulum swings in Dynamics with its joints closed", async ({ page }) => {
  const errors: Error[] = [];
  page.on("pageerror", (err) => errors.push(err));
  const doc = buildDoublePendulum();
  await seedDocument(page, doc);
  await page.goto("/");

  await pressSpace(page);
  await page.getByRole("button", { name: "Dinámica" }).click();
  await expect
    .poll(async () => (await getSimDynamics(page))?.summary.dof, { timeout: 10_000 })
    .toBe(2);
  await expect
    .poll(async () => (await getSimDynamics(page))?.status, { timeout: 30_000 })
    .toBe("complete");

  const before = await getSimPoses(page);
  await page.getByRole("button", { name: "Reproducir" }).click();
  await expect
    .poll(async () => (await getSimReadout(page))?.time ?? 0, { timeout: 10_000 })
    .toBeGreaterThan(0.5);
  await page.getByRole("button", { name: "Pausar" }).click();

  const after = await getSimPoses(page);
  expect(after).not.toEqual(before);
  expect(maxJointResidual(doc, after)).toBeLessThan(1e-6);
  expect(errors).toEqual([]);
});

test("the Spring tool connects the coupler to ground", async ({ page }) => {
  const errors: Error[] = [];
  page.on("pageerror", (err) => errors.push(err));
  await page.goto("/");
  await loadExampleFourBar(page);

  await page.click('[data-tool-id="spring"]');
  // The example coupler runs from A = (20, 34.6) to B = (110, 80); O4 = (100, 0) is a ground pivot.
  await clickCanvasPoint(page, { x: 65, y: 57.3 });
  await clickCanvasPoint(page, { x: 100, y: 0 });

  await expect.poll(async () => (await readSessionDocument(page)).springs.length).toBe(1);
  const spring = (await readSessionDocument(page)).springs[0];
  expect(spring.kind).toBe("linear");
  expect(spring.stiffness).toBe(100);
  expect(errors).toEqual([]);
});
