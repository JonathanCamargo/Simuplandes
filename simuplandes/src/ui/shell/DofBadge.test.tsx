// @vitest-environment jsdom
import { render, screen, fireEvent, cleanup, act } from "@testing-library/react";
import { afterEach, beforeAll, describe, it, expect, vi } from "vitest";
import { I18nextProvider } from "react-i18next";
import { ThemeProvider, CssBaseline } from "@mui/material";
import type { i18n as I18nInstance } from "i18next";
import { DofBadge } from "./DofBadge";
import { createStudioTheme } from "../theme/studioTheme";
import { createI18n } from "../../i18n/i18n";
import { createMechanismStore } from "../../store";
import { buildExampleFourBar } from "../../store";
import { buildDoubleParallelogram } from "../../sim/__fixtures__/documents";
import { poseFromWorldPoints, worldToLinkLocal } from "../../model";
import { vec2 } from "../../geom";
import { installDomStubs } from "../../test/domStubs";
import type { MechanismStore } from "../../store";

vi.mock("../../sim/dof", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../sim/dof")>();
  return { ...actual, computeDofReport: vi.fn(actual.computeDofReport) };
});
import { computeDofReport } from "../../sim/dof";

const mockComputeDofReport = vi.mocked(computeDofReport);

beforeAll(() => {
  installDomStubs();
});

afterEach(() => {
  cleanup();
  mockComputeDofReport.mockClear();
});

function renderBadge(
  mechanismStore: MechanismStore,
  lang: "es" | "en" = "es",
): ReturnType<typeof render> & { i18n: I18nInstance } {
  const i18n = createI18n(lang);
  const theme = createStudioTheme("light", lang);
  const utils = render(
    <I18nextProvider i18n={i18n}>
      <ThemeProvider theme={theme}>
        <CssBaseline />
        <DofBadge mechanismStore={mechanismStore} />
      </ThemeProvider>
    </I18nextProvider>,
  );
  return { ...utils, i18n };
}

/** Adds a 5th link pinned to the crank's own "A" site and the ground's "O4" site (a redundant bar), via store commands only -- matching this plan's own dof.test.ts precedent (05-03) and the E2E bar-tool test's resulting document shape (5 links, 6 joints). */
function addRedundantBar(mechanismStore: MechanismStore): void {
  const state = mechanismStore.getState();
  const doc = state.document;
  const jointA = doc.joints.find((j) => j.name === "A");
  const jointO4 = doc.joints.find((j) => j.name === "O4");
  if (!jointA || !jointO4) throw new Error("expected joints named A and O4");

  const A = vec2(20, 20 * Math.sqrt(3));
  const O4 = vec2(100, 0);
  const pose = poseFromWorldPoints(A, O4);
  const extra = state.addLink({
    name: "extra",
    pose,
    sites: [{ local: [0, 0] }, { local: worldToLinkLocal(pose, O4) }],
  });
  state.addJoint({ type: "R", siteA: extra.siteIds[0], siteB: jointA.siteA, name: "extra-A" });
  state.addJoint({ type: "R", siteA: extra.siteIds[1], siteB: jointO4.siteB, name: "extra-O4" });
}

describe("DofBadge: example four-bar", () => {
  it("shows F = 1, ok severity, and an aria-label mentioning Movilidad (Gruebler)", () => {
    const mechanismStore = createMechanismStore();
    buildExampleFourBar(mechanismStore);
    renderBadge(mechanismStore);

    const badge = screen.getByTestId("dof-badge");
    expect(badge.textContent).toContain("F = 1");
    expect(badge.getAttribute("data-severity")).toBe("ok");
    expect(badge.getAttribute("aria-label")).toContain("Movilidad (Gruebler)");
  });

  it("clicking opens a dialog with the formula, the plain explanation, and the rank line", () => {
    const mechanismStore = createMechanismStore();
    buildExampleFourBar(mechanismStore);
    const { i18n } = renderBadge(mechanismStore);

    fireEvent.click(screen.getByTestId("dof-badge"));
    const dialog = screen.getByRole("dialog");
    const dialogText = dialog.textContent ?? "";

    expect(dialogText).toContain(i18n.t("sim.dof.formula", { n: 4, j: 4, f: 1 }));
    expect(dialogText).toContain("Un grado de libertad");
    expect(dialogText).toContain(i18n.t("sim.dof.rank", { rank: 1 }));

    fireEvent.keyDown(dialog, { key: "Escape" });
  });
});

describe("DofBadge: redundant bar (structure)", () => {
  it("F = 0, error severity, explains it is a structure", () => {
    const mechanismStore = createMechanismStore();
    buildExampleFourBar(mechanismStore);
    addRedundantBar(mechanismStore);
    renderBadge(mechanismStore);

    const badge = screen.getByTestId("dof-badge");
    expect(badge.textContent).toContain("F = 0");
    expect(badge.getAttribute("data-severity")).toBe("error");

    fireEvent.click(badge);
    expect(screen.getByRole("dialog").textContent).toContain("es una estructura; no puede moverse");
  });

  it("in English: F = 0 and the structure explanation in English", () => {
    const mechanismStore = createMechanismStore();
    buildExampleFourBar(mechanismStore);
    addRedundantBar(mechanismStore);
    renderBadge(mechanismStore, "en");

    const badge = screen.getByTestId("dof-badge");
    expect(badge.textContent).toContain("F = 0");

    fireEvent.click(badge);
    expect(screen.getByRole("dialog").textContent).toContain("this is a structure; it cannot move");
  });
});

describe("DofBadge: double parallelogram (redundant but mobile)", () => {
  it("F = 0, warn severity, explains the redundant constraint", () => {
    const mechanismStore = createMechanismStore();
    mechanismStore.getState().loadDocument(buildDoubleParallelogram());
    renderBadge(mechanismStore);

    const badge = screen.getByTestId("dof-badge");
    expect(badge.textContent).toContain("F = 0");
    expect(badge.getAttribute("data-severity")).toBe("warn");

    fireEvent.click(badge);
    const dialogText = screen.getByRole("dialog").textContent ?? "";
    expect(dialogText).toContain("se mueve con 1 GDL");
    expect(dialogText).toContain("restricción redundante");
  });
});

describe("DofBadge: empty document", () => {
  it("shows F = -, neutral severity, and does not crash", () => {
    const mechanismStore = createMechanismStore();
    renderBadge(mechanismStore);

    const badge = screen.getByTestId("dof-badge");
    expect(badge.textContent).toContain("F = —");
    expect(badge.getAttribute("data-severity")).toBe("neutral");
  });
});

describe("DofBadge: motor note", () => {
  it("shows the sim.dof.motors.none note when the example's motor is removed", () => {
    const mechanismStore = createMechanismStore();
    buildExampleFourBar(mechanismStore);
    const doc = mechanismStore.getState().document;
    mechanismStore.getState().loadDocument({ ...doc, motors: [] });
    renderBadge(mechanismStore);

    fireEvent.click(screen.getByTestId("dof-badge"));
    const dialogText = screen.getByRole("dialog").textContent ?? "";
    expect(dialogText).toContain("Sin motor: arrastra un eslabón para moverlo");
  });
});

describe("DofBadge: recompute discipline", () => {
  it("computeDofReport is called once per document identity, not per unrelated re-render", () => {
    const mechanismStore = createMechanismStore();
    buildExampleFourBar(mechanismStore);
    const { i18n } = renderBadge(mechanismStore);
    expect(mockComputeDofReport).toHaveBeenCalledTimes(1);

    for (let i = 0; i < 5; i++) {
      act(() => {
        void i18n.changeLanguage(i % 2 === 0 ? "en" : "es");
      });
    }
    expect(mockComputeDofReport).toHaveBeenCalledTimes(1);
  });
});
