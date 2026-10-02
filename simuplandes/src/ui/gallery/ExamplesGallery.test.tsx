// @vitest-environment jsdom
import { render, screen, fireEvent, cleanup, within } from "@testing-library/react";
import { afterEach, beforeAll, describe, it, expect } from "vitest";
import { I18nextProvider } from "react-i18next";
import { ThemeProvider } from "@mui/material";
import { ExamplesGallery } from "./ExamplesGallery";
import { fitViewToDocument } from "./fitView";
import { createStudioTheme } from "../theme/studioTheme";
import { createI18n } from "../../i18n/i18n";
import { createStudioStore } from "../../uiState/studioStore";
import { createMechanismStore, buildExampleFourBar } from "../../store";
import { loadExampleDocument } from "../../examples/registry";
import { worldToScreen } from "../../canvas/viewport";
import { documentBounds } from "../../canvas/bounds";
import { siteWorldPosition } from "../../model";
import { installDomStubs } from "../../test/domStubs";

beforeAll(() => {
  installDomStubs();
});
afterEach(cleanup);

function setup(variant: "dialog" | "inline", lang: "en" | "es" = "en") {
  const store = createMechanismStore();
  const studio = createStudioStore();
  const i18n = createI18n(lang);
  render(
    <I18nextProvider i18n={i18n}>
      <ThemeProvider theme={createStudioTheme("light", "en")}>
        <ExamplesGallery store={store} studio={studio} variant={variant} />
      </ThemeProvider>
    </I18nextProvider>,
  );
  return { store, studio };
}

describe("ExamplesGallery", () => {
  it("renders five localized cards inline", () => {
    setup("inline");
    const cards = screen.getAllByTestId("example-card");
    expect(cards.map((c) => c.getAttribute("data-example-id"))).toEqual([
      "four-bar",
      "slider-crank",
      "watt",
      "stephenson",
      "eight-bar",
    ]);
    expect(screen.getByText("Four-bar")).toBeTruthy();
    expect(within(cards[0]).getByTestId("drawing-svg")).toBeTruthy();
  });

  it("localizes titles in Spanish", () => {
    setup("inline", "es");
    expect(screen.getByText("Cuatro barras")).toBeTruthy();
  });

  it("the dialog variant is closed until studio.dialog is examples", () => {
    setup("dialog");
    expect(screen.queryByTestId("examples-gallery")).toBeNull();
  });

  it("opens, lists the cards and closes from the close button", async () => {
    const { studio } = setup("dialog");
    studio.getState().openDialog("examples");
    expect(await screen.findAllByTestId("example-card")).toHaveLength(5);
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(studio.getState().dialog).toBeNull();
  });

  it("loads the four-bar on an empty document and enters Simulate", () => {
    const { store, studio } = setup("inline");
    fireEvent.click(screen.getAllByTestId("example-card")[0]);
    expect(store.getState().document.links).toHaveLength(4);
    expect(store.getState().document.motors).toHaveLength(1);
    expect(store.getState().canUndo).toBe(false);
    expect(studio.getState().mode).toBe("simulate");
  });

  it("asks before replacing an edited document; Cancel keeps it, Replace loads", async () => {
    const { store, studio } = setup("inline");
    buildExampleFourBar(store);
    const before = store.getState().document;
    expect(store.getState().canUndo).toBe(true);

    fireEvent.click(screen.getAllByTestId("example-card")[1]);
    expect(await screen.findByTestId("replace-confirm")).toBeTruthy();
    expect(store.getState().document).toBe(before);

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(store.getState().document).toBe(before);
    expect(studio.getState().mode).toBe("build");

    fireEvent.click(screen.getAllByTestId("example-card")[1]);
    fireEvent.click(await screen.findByRole("button", { name: "Replace" }));
    expect(store.getState().document).not.toBe(before);
    expect(store.getState().document.links).toHaveLength(4);
    expect(studio.getState().mode).toBe("simulate");
  });
});

describe("fitViewToDocument", () => {
  it("contains every site point with the padding", () => {
    const doc = loadExampleDocument("eight-bar");
    const view = fitViewToDocument(doc, 168, 104, 22);
    expect(view.widthPx).toBe(168);
    expect(view.heightPx).toBe(104);
    expect(documentBounds(doc)).not.toBeNull();
    for (const link of doc.links) {
      for (const site of link.sites) {
        const s = worldToScreen(view.viewport, siteWorldPosition(link, site.local));
        expect(s.x).toBeGreaterThanOrEqual(22 - 1e-6);
        expect(s.x).toBeLessThanOrEqual(168 - 22 + 1e-6);
        expect(s.y).toBeGreaterThanOrEqual(22 - 1e-6);
        expect(s.y).toBeLessThanOrEqual(104 - 22 + 1e-6);
      }
    }
  });

  it("returns a default view for an empty document", () => {
    const store = createMechanismStore();
    const view = fitViewToDocument(store.getState().document, 100, 60, 10);
    expect(view.viewport.widthPx).toBe(100);
    expect(view.viewport.heightPx).toBe(60);
    expect(Number.isFinite(view.viewport.zoom)).toBe(true);
  });
});
