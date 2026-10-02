// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { ValidationReport } from "./ValidationReport";
import { createI18n } from "../../i18n/i18n";
import { createMechanismStore } from "../../store";
import { createStudioStore } from "../../uiState/studioStore";
import { buildExportReport, exportGraphthe, type ExportReport } from "../../interchange";
import { buildLink, makeDoc } from "../../interchange/__fixtures__/testDocs";
import { createId, type MechanismDocumentInput } from "../../model";

/** A doc whose motor drives a joint between two MOVING links (motor-not-on-ground). */
function badMotorDoc() {
  const ground = buildLink({
    name: "ground",
    isGround: true,
    origin: [0, 0],
    sites: { a: [0, 0] },
  });
  const crank = buildLink({ name: "crank", origin: [0, 0], sites: { p: [0, 0], q: [30, 0] } });
  const link = buildLink({ name: "link", origin: [30, 0], sites: { r: [30, 0], s: [60, 30] } });
  const [j1, j2] = [createId("joint"), createId("joint")];
  const doc = makeDoc({
    schemaVersion: 1,
    name: "bad-motor",
    links: [ground.link, crank.link, link.link],
    joints: [
      { id: j1, name: "j1", type: "R", siteA: ground.siteIds.a, siteB: crank.siteIds.p },
      { id: j2, name: "j2", type: "R", siteA: crank.siteIds.q, siteB: link.siteIds.r },
    ],
    motors: [
      {
        id: createId("motor"),
        name: "m",
        jointId: j2,
        kind: "rotary",
        drive: { mode: "constant", speed: 1 },
      },
    ],
  } satisfies MechanismDocumentInput);
  return { doc, j2, crank, link, ground };
}

function reportOf(doc: Parameters<typeof buildExportReport>[0]): ExportReport {
  return buildExportReport(doc, exportGraphthe(doc));
}

function renderReport(
  report: ExportReport,
  doc?: Parameters<typeof buildExportReport>[0],
  lang: "es" | "en" = "en",
): {
  studioStore: ReturnType<typeof createStudioStore>;
  mechanismStore: ReturnType<typeof createMechanismStore>;
} {
  const studioStore = createStudioStore();
  const mechanismStore = createMechanismStore();
  if (doc) mechanismStore.getState().loadDocument(doc);
  const i18n = createI18n(lang);
  render(
    <I18nextProvider i18n={i18n}>
      <ValidationReport report={report} studioStore={studioStore} mechanismStore={mechanismStore} />
    </I18nextProvider>,
  );
  return { studioStore, mechanismStore };
}

afterEach(() => {
  cleanup();
});

describe("ValidationReport", () => {
  it("shows the localized ready line for an empty report", () => {
    renderReport({ items: [], counts: { error: 0, warning: 0, info: 0 } });
    expect(screen.getByTestId("export-report-empty").textContent).toBe("Ready to export.");
  });

  it("shows the Spanish ready line for an empty report in es", () => {
    renderReport({ items: [], counts: { error: 0, warning: 0, info: 0 } }, undefined, "es");
    expect(screen.getByTestId("export-report-empty").textContent).toBe("Listo para exportar.");
  });

  it("renders only non-empty groups with counts, in English", () => {
    const { doc } = badMotorDoc();
    renderReport(reportOf(doc), doc, "en");
    const items = screen.getAllByTestId("export-report-item");
    expect(items.length).toBeGreaterThan(0);
    // The motor-not-on-ground error reads the English prefix.
    const err = items.find(
      (el) => el.getAttribute("data-code") === "cannot-simulate-motor-not-on-ground",
    );
    expect(err).toBeDefined();
    expect(err!.textContent).toContain("GraphThe won't be able to simulate this");
    expect(screen.getByText(/Errors \(/)).toBeTruthy();
  });

  it("renders the Spanish error prefix in es", () => {
    const { doc } = badMotorDoc();
    renderReport(reportOf(doc), doc, "es");
    const items = screen.getAllByTestId("export-report-item");
    const err = items.find(
      (el) => el.getAttribute("data-code") === "cannot-simulate-motor-not-on-ground",
    );
    expect(err).toBeDefined();
    expect(err!.textContent).toContain("GraphThe no podrá simular esto");
  });

  it("selects the offending ids and sets the hover on click; pointer leave clears it", () => {
    const { doc, j2, crank, link } = badMotorDoc();
    const { studioStore, mechanismStore } = renderReport(reportOf(doc), doc, "en");

    const err = screen
      .getAllByTestId("export-report-item")
      .find((el) => el.getAttribute("data-code") === "cannot-simulate-motor-not-on-ground")!;
    fireEvent.click(err);

    expect(mechanismStore.getState().selection.has(crank.link.id)).toBe(true);
    expect(mechanismStore.getState().selection.has(link.link.id)).toBe(true);
    expect(mechanismStore.getState().selection.has(j2)).toBe(true);
    expect(studioStore.getState().hoveredId).toBe(crank.link.id);

    fireEvent.mouseLeave(err);
    expect(studioStore.getState().hoveredId).toBeNull();
  });

  it("marks severity via data-severity and keeps items keyboard-focusable", () => {
    const { doc } = badMotorDoc();
    renderReport(reportOf(doc), doc, "en");
    const items = screen.getAllByTestId("export-report-item");
    for (const item of items) {
      // ListItemButton renders a <li role="button" tabindex="0"> — focusable.
      expect(item.getAttribute("tabindex")).not.toBeNull();
      expect(["error", "warning", "info"]).toContain(item.getAttribute("data-severity"));
    }
  });
});
