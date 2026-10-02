/**
 * Real-browser E2E for the plot/CSV half of SC-3 (SIM-05): the "Gráficas"
 * chip opens a plot row showing the output angle vs input by default, and
 * "Exportar CSV" downloads an invariant, Freudenstein-verified CSV, whose
 * bytes don't depend on the active UI language. Every test collects
 * `pageerror` events and asserts there are none.
 */
import * as fs from "node:fs";
import { test, expect, type Page } from "@playwright/test";
import {
  distance,
  loadExampleFourBar,
  pressSpace,
  readSessionDocument,
  siteWorld,
} from "./helpers";
import { freudensteinBranchOf, freudensteinTheta4 } from "../src/kinematics/__fixtures__/analytic";

function trackPageErrors(page: Page): Error[] {
  const errors: Error[] = [];
  page.on("pageerror", (err) => errors.push(err));
  return errors;
}

async function openPlots(page: Page): Promise<void> {
  await page.getByText("Gráficas ▾").click();
  await expect(page.getByRole("region", { name: "Panel de gráficas" })).toBeVisible();
}

interface CsvParsed {
  header: string[];
  rows: string[][];
}

function parseCsv(text: string): CsvParsed {
  expect(text.includes("\n")).toBe(true);
  // Every line must be CRLF-terminated (including the last) -- split on
  // "\r\n" and drop the trailing empty entry from the final terminator.
  const lines = text.split("\r\n");
  expect(lines[lines.length - 1]).toBe("");
  const dataLines = lines.slice(0, -1);
  const header = dataLines[0].split(",");
  const rows = dataLines.slice(1).map((line) => line.split(","));
  return { header, rows };
}

test("Plots show output angle vs input and export a correct CSV", async ({ page }) => {
  const pageErrors = trackPageErrors(page);
  await page.goto("/");
  await loadExampleFourBar(page);
  await pressSpace(page);
  await openPlots(page);

  const region = page.getByRole("region", { name: "Panel de gráficas" });
  await expect(region.locator(".uplot canvas").first()).toBeVisible();
  await expect(region.getByText(/rocker · ángulo/).first()).toBeVisible();

  const doc = await readSessionDocument(page);
  const jointO2 = doc.joints.find((j) => j.name === "O2")!;
  const jointA = doc.joints.find((j) => j.name === "A")!;
  const jointB = doc.joints.find((j) => j.name === "B")!;
  const jointO4 = doc.joints.find((j) => j.name === "O4")!;
  const O2 = siteWorld(doc, jointO2.siteA);
  const O4 = siteWorld(doc, jointO4.siteB);
  const A = siteWorld(doc, jointA.siteA);
  const B = siteWorld(doc, jointB.siteA);
  const crank = doc.links.find((l) => l.name === "crank")!;
  const rocker = doc.links.find((l) => l.name === "rocker")!;

  const a = distance(O2, A);
  const b = distance(A, B);
  const c = distance(O4, B);
  const d = distance(O2, O4);
  // The ground link's world angle is 0, so the crank's own link angle IS
  // theta2 (the plan's own framing) -- read directly off the document
  // rather than assuming the fixture's 60-degree literal.
  const refTheta2 = crank.pose.angle;
  const refTheta4 = rocker.pose.angle;
  const branch = freudensteinBranchOf(a, b, c, d, refTheta2, refTheta4);

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Exportar CSV" }).click();
  const download = await downloadPromise;
  const filePath = await download.path();
  expect(filePath).not.toBeNull();
  const text = fs.readFileSync(filePath, "utf8");

  expect(download.suggestedFilename()).toMatch(/^simuplandes-four-bar-example-vs-input\.csv$/);

  const { header, rows } = parseCsv(text);
  expect(header).toEqual(["input O2 [deg]", "rocker.angle [deg]"]);
  expect(rows.length).toBe(361);

  const numberPattern = /^-?\d+(\.\d+)?(e[-+]?\d+)?$/;
  for (const row of rows) {
    expect(row).toHaveLength(2);
    for (const field of row) {
      expect(field).toMatch(numberPattern);
      expect(field).not.toContain(";");
    }
  }
  expect(text).not.toContain(";");

  const xs = rows.map((r) => Number(r[0]));
  expect(xs[0]).toBeCloseTo(60, 6);
  expect(xs[xs.length - 1]).toBeCloseTo(420, 6);
  for (let i = 1; i < xs.length; i++) {
    expect(xs[i]).toBeGreaterThan(xs[i - 1]);
  }

  for (let i = 0; i < rows.length; i++) {
    const theta2 = (xs[i] * Math.PI) / 180;
    const theta4Analytic = freudensteinTheta4(a, b, c, d, theta2, branch);
    const analyticDeg = ((theta4Analytic * 180) / Math.PI) % 360;
    const actualDeg = Number(rows[i][1]) % 360;
    let diff = Math.abs(analyticDeg - actualDeg);
    if (diff > 180) diff = 360 - diff;
    expect(diff).toBeLessThan(1e-4);
  }

  expect(pageErrors).toEqual([]);
});

test("CSV is language-invariant", async ({ page }) => {
  const pageErrors = trackPageErrors(page);
  await page.goto("/");
  await loadExampleFourBar(page);
  await pressSpace(page);
  await openPlots(page);

  const download1Promise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Exportar CSV" }).click();
  const download1 = await download1Promise;
  const path1 = await download1.path();
  const bytes1 = fs.readFileSync(path1);

  await page.getByRole("button", { name: "EN", exact: true }).click();
  await expect(page.getByRole("button", { name: "Export CSV" })).toBeVisible();

  const download2Promise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export CSV" }).click();
  const download2 = await download2Promise;
  const path2 = await download2.path();
  const bytes2 = fs.readFileSync(path2);

  expect(bytes2.equals(bytes1)).toBe(true);

  expect(pageErrors).toEqual([]);
});

test("Time axis records history while playing", async ({ page }) => {
  const pageErrors = trackPageErrors(page);
  await page.goto("/");
  await loadExampleFourBar(page);
  await pressSpace(page);
  await openPlots(page);

  await page.getByRole("button", { name: "Tiempo" }).click();
  await expect(
    page.getByText("Sin historial: reproduce la simulación para registrar datos en el tiempo"),
  ).toBeVisible();

  await page.getByRole("button", { name: "Reproducir" }).click();
  await page.waitForTimeout(1000);
  await page.getByRole("button", { name: "Pausar" }).click();

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Exportar CSV" }).click();
  const download = await downloadPromise;
  const filePath = await download.path();
  const text = fs.readFileSync(filePath, "utf8");

  const { header, rows } = parseCsv(text);
  expect(header[0]).toBe("time [s]");
  expect(rows.length).toBeGreaterThanOrEqual(20);

  const ts = rows.map((r) => Number(r[0]));
  for (let i = 1; i < ts.length; i++) {
    expect(ts[i]).toBeGreaterThan(ts[i - 1]);
  }
  const lastT = ts[ts.length - 1];
  expect(lastT).toBeGreaterThan(0.5);
  expect(lastT).toBeLessThan(1.5);

  expect(pageErrors).toEqual([]);
});
