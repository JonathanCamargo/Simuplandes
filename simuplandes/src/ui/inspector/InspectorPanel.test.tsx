// @vitest-environment jsdom
import type { ReactNode } from "react";
import { render, screen, fireEvent, cleanup, act } from "@testing-library/react";
import { afterEach, beforeAll, describe, it, expect } from "vitest";
import { produce } from "immer";
import { I18nextProvider } from "react-i18next";
import { ThemeProvider } from "@mui/material";
import { InspectorPanel } from "./InspectorPanel";
import { createI18n } from "../../i18n/i18n";
import { createStudioTheme } from "../theme/studioTheme";
import {
  createMechanismStore,
  buildExampleFourBar,
  addLink,
  addJoint,
  type MechanismStore,
  type Recipe,
} from "../../store";
import { createStudioStore } from "../../uiState/studioStore";
import { useStudioShortcuts } from "../shell/useStudioShortcuts";
import { installDomStubs } from "../../test/domStubs";
import {
  createEmptyDocument,
  indexDocument,
  siteWorldPosition,
  degToRad,
  type MechanismDocument,
} from "../../model";

beforeAll(() => {
  installDomStubs();
});

afterEach(cleanup);

function applyRecipesForTest(doc: MechanismDocument, recipes: Recipe[]): MechanismDocument {
  return recipes.reduce((acc, recipe) => produce(acc, recipe), doc);
}

function renderPanel(store: MechanismStore, lang: "es" | "en" = "es") {
  const i18n = createI18n(lang);
  const theme = createStudioTheme("light", lang);
  const utils = render(
    <I18nextProvider i18n={i18n}>
      <ThemeProvider theme={theme}>
        <InspectorPanel store={store} />
      </ThemeProvider>
    </I18nextProvider>,
  );
  return { ...utils, i18n };
}

function jointIdByName(doc: MechanismDocument, name: string): string {
  const joint = doc.joints.find((j) => j.name === name);
  if (!joint) throw new Error(`joint "${name}" not found`);
  return joint.id;
}

describe("InspectorPanel", () => {
  it("empty selection shows document name and a units select", () => {
    const store = createMechanismStore();
    renderPanel(store);
    expect(screen.getByLabelText<HTMLInputElement>("Nombre").value).toBe("Untitled mechanism");
    expect(screen.getByRole("combobox", { name: "Unidades" })).toBeDefined();
  });

  it("changing units via the select is one undo step", () => {
    const store = createMechanismStore();
    renderPanel(store);
    const combo = screen.getByRole("combobox", { name: "Unidades" });
    fireEvent.mouseDown(combo);
    const option = screen.getByRole("option", { name: "m" });
    fireEvent.click(option);
    expect(store.getState().document.units.length).toBe("m");
    expect(store.getState().canUndo).toBe(true);
    act(() => {
      store.getState().undo();
    });
    expect(store.getState().document.units.length).toBe("mm");
    expect(store.getState().canUndo).toBe(false);
  });

  it("renaming the document via Enter is one undo step", () => {
    const store = createMechanismStore();
    renderPanel(store);
    const nameField = screen.getByLabelText<HTMLInputElement>("Nombre");
    fireEvent.change(nameField, { target: { value: "My mechanism" } });
    fireEvent.keyDown(nameField, { key: "Enter" });
    expect(store.getState().document.name).toBe("My mechanism");
    act(() => {
      store.getState().undo();
    });
    expect(store.getState().document.name).toBe("Untitled mechanism");
  });

  it("shows entity counts for a populated document", () => {
    const store = createMechanismStore();
    buildExampleFourBar(store);
    renderPanel(store);
    expect(screen.getByText("4 eslabones · 4 articulaciones · 1 motores")).toBeDefined();
  });

  it("two links selected shows the multi-selection count", () => {
    const store = createMechanismStore();
    const ids = buildExampleFourBar(store);
    store.getState().select([ids.crankId, ids.couplerId]);
    renderPanel(store);
    expect(screen.getByText("2 objetos seleccionados")).toBeDefined();
  });

  it("Clear selection empties the selection", () => {
    const store = createMechanismStore();
    const ids = buildExampleFourBar(store);
    store.getState().select([ids.crankId, ids.couplerId]);
    renderPanel(store);
    fireEvent.click(screen.getByRole("button", { name: "Borrar selección" }));
    expect(store.getState().selection.size).toBe(0);
  });

  describe("link form (crank)", () => {
    it("shows name/X/Y/angle/length; editing length keeps joint A connected; undo restores", () => {
      const store = createMechanismStore();
      const ids = buildExampleFourBar(store);
      store.getState().select([ids.crankId]);
      renderPanel(store);

      expect(screen.getByLabelText<HTMLInputElement>("Nombre").value).toBe("crank");
      expect(screen.getByLabelText<HTMLInputElement>("X").value).toBe("0,00");
      expect(screen.getByLabelText<HTMLInputElement>("Y").value).toBe("0,00");
      expect(screen.getByLabelText<HTMLInputElement>("Ángulo").value).toBe("60,00");
      expect(screen.getByLabelText<HTMLInputElement>("Longitud").value).toBe("40,00");

      const lengthField = screen.getByLabelText<HTMLInputElement>("Longitud");
      fireEvent.change(lengthField, { target: { value: "50" } });
      fireEvent.keyDown(lengthField, { key: "Enter" });

      const doc = store.getState().document;
      const index = indexDocument(doc);
      const crank = index.links.get(ids.crankId);
      const coupler = index.links.get(ids.couplerId);
      if (!crank || !coupler) throw new Error("links missing after edit");
      expect(crank.sites[1].local[0]).toBeCloseTo(50, 9);

      const crankBWorld = siteWorldPosition(crank, crank.sites[1].local);
      const couplerAWorld = siteWorldPosition(coupler, coupler.sites[0].local);
      expect(couplerAWorld.x).toBeCloseTo(crankBWorld.x, 9);
      expect(couplerAWorld.y).toBeCloseTo(crankBWorld.y, 9);

      act(() => {
        store.getState().undo();
      });
      expect(screen.getByLabelText<HTMLInputElement>("Longitud").value).toBe("40,00");
    });

    it("editing angle sets pose.angle in radians; undo restores", () => {
      const store = createMechanismStore();
      const ids = buildExampleFourBar(store);
      store.getState().select([ids.crankId]);
      renderPanel(store);

      const angleField = screen.getByLabelText<HTMLInputElement>("Ángulo");
      fireEvent.change(angleField, { target: { value: "30" } });
      fireEvent.keyDown(angleField, { key: "Enter" });

      const crank = store.getState().document.links.find((l) => l.id === ids.crankId);
      expect(crank?.pose.angle).toBeCloseTo(degToRad(30), 9);

      act(() => {
        store.getState().undo();
      });
      const restored = store.getState().document.links.find((l) => l.id === ids.crankId);
      expect(restored?.pose.angle).toBeCloseTo(degToRad(60), 9);
    });

    it("editing the colour sets link.color; Reset removes it; each is one undo step", () => {
      const store = createMechanismStore();
      const ids = buildExampleFourBar(store);
      store.getState().select([ids.crankId]);
      renderPanel(store);

      const colorInput = screen.getByLabelText<HTMLInputElement>("Color");
      fireEvent.change(colorInput, { target: { value: "#112233" } });
      expect(store.getState().document.links.find((l) => l.id === ids.crankId)?.color).toBe(
        "#112233",
      );
      expect(store.getState().canUndo).toBe(true);

      const resetButton = screen.getByRole("button", { name: /Restablecer/ });
      fireEvent.click(resetButton);
      const afterReset = store.getState().document.links.find((l) => l.id === ids.crankId);
      expect(afterReset && "color" in afterReset).toBe(false);

      act(() => {
        store.getState().undo();
      });
      expect(store.getState().document.links.find((l) => l.id === ids.crankId)?.color).toBe(
        "#112233",
      );
      act(() => {
        store.getState().undo();
      });
      expect(
        store.getState().document.links.find((l) => l.id === ids.crankId)?.color,
      ).toBeUndefined();
    });

    it("renaming the link via Enter is one undo step", () => {
      const store = createMechanismStore();
      const ids = buildExampleFourBar(store);
      store.getState().select([ids.crankId]);
      renderPanel(store);
      const nameField = screen.getByLabelText<HTMLInputElement>("Nombre");
      fireEvent.change(nameField, { target: { value: "Crank 2" } });
      fireEvent.keyDown(nameField, { key: "Enter" });
      expect(store.getState().document.links.find((l) => l.id === ids.crankId)?.name).toBe(
        "Crank 2",
      );
      act(() => {
        store.getState().undo();
      });
      expect(store.getState().document.links.find((l) => l.id === ids.crankId)?.name).toBe("crank");
    });

    it("shows a Ground chip for the ground link and lists its sites; clicking a site selects it", () => {
      const store = createMechanismStore();
      const ids = buildExampleFourBar(store);
      store.getState().select([ids.groundId]);
      renderPanel(store);
      expect(screen.getByText("Tierra")).toBeDefined();

      const ground = store.getState().document.links.find((l) => l.id === ids.groundId);
      if (!ground) throw new Error("ground link missing");
      const firstSiteId = ground.sites[0].id;
      const listItems = screen.getAllByRole("button", { name: /,/ });
      fireEvent.click(listItems[0]);
      expect([...store.getState().selection]).toEqual([firstSiteId]);
    });
  });

  describe("joint form", () => {
    it("joint A: X/Y show the world position; editing X moves both cluster sites; renaming works; undo works", () => {
      const store = createMechanismStore();
      buildExampleFourBar(store);
      const jointA = jointIdByName(store.getState().document, "A");
      store.getState().select([jointA]);
      renderPanel(store);

      const xField = screen.getByLabelText<HTMLInputElement>("X");
      const yField = screen.getByLabelText<HTMLInputElement>("Y");
      expect(Number(xField.value.replace(",", "."))).toBeCloseTo(20, 1);
      expect(Number(yField.value.replace(",", "."))).toBeCloseTo(20 * Math.sqrt(3), 1);

      fireEvent.change(xField, { target: { value: "25" } });
      fireEvent.keyDown(xField, { key: "Enter" });

      const doc = store.getState().document;
      const joint = doc.joints.find((j) => j.id === jointA);
      if (!joint) throw new Error("joint A missing");
      const index = indexDocument(doc);
      const siteA = index.sites.get(joint.siteA);
      const siteB = index.sites.get(joint.siteB);
      if (!siteA || !siteB) throw new Error("joint A sites missing");
      const worldA = siteWorldPosition(siteA.link, siteA.site.local);
      const worldB = siteWorldPosition(siteB.link, siteB.site.local);
      expect(worldA.x).toBeCloseTo(25, 9);
      expect(worldB.x).toBeCloseTo(25, 9);

      const nameField = screen.getByLabelText<HTMLInputElement>("Nombre");
      fireEvent.change(nameField, { target: { value: "Joint-A" } });
      fireEvent.keyDown(nameField, { key: "Enter" });
      expect(store.getState().document.joints.find((j) => j.id === jointA)?.name).toBe("Joint-A");

      act(() => {
        store.getState().undo();
      });
      expect(store.getState().document.joints.find((j) => j.id === jointA)?.name).toBe("A");
      act(() => {
        store.getState().undo();
      });
      const restoredSiteA = indexDocument(store.getState().document).sites.get(joint.siteA);
      if (!restoredSiteA) throw new Error("site missing after undo");
      const restoredWorld = siteWorldPosition(restoredSiteA.link, restoredSiteA.site.local);
      expect(restoredWorld.x).toBeCloseTo(20, 9);
    });

    it("joint O2 (with a motor): shows speed in deg/s; switching to Expression and typing commits each as one undo step", () => {
      const store = createMechanismStore();
      buildExampleFourBar(store);
      const jointO2 = jointIdByName(store.getState().document, "O2");
      store.getState().select([jointO2]);
      renderPanel(store);

      const speedField = screen.getByLabelText<HTMLInputElement>("Velocidad");
      expect(Number(speedField.value.replace(",", "."))).toBeCloseTo(57.3, 1);

      const historyBefore = store.getState().canUndo;
      expect(historyBefore).toBe(true);

      fireEvent.click(screen.getByRole("button", { name: "Expresión" }));
      const motorAfterSwitch = store.getState().document.motors.find((m) => m.jointId === jointO2);
      expect(motorAfterSwitch?.drive).toEqual({ mode: "expression", expression: "t" });

      const expressionField = screen.getByLabelText<HTMLInputElement>("Expresión");
      fireEvent.change(expressionField, { target: { value: "sin(t)" } });
      fireEvent.keyDown(expressionField, { key: "Enter" });
      const motorAfterType = store.getState().document.motors.find((m) => m.jointId === jointO2);
      expect(motorAfterType?.drive).toEqual({ mode: "expression", expression: "sin(t)" });

      act(() => {
        store.getState().undo();
      });
      expect(store.getState().document.motors.find((m) => m.jointId === jointO2)?.drive).toEqual({
        mode: "expression",
        expression: "t",
      });
      act(() => {
        store.getState().undo();
      });
      expect(store.getState().document.motors.find((m) => m.jointId === jointO2)?.drive).toEqual({
        mode: "constant",
        speed: 1,
      });
    });

    it("joint B (no motor) shows Add motor; clicking creates a rotary motor as one undo step", () => {
      const store = createMechanismStore();
      buildExampleFourBar(store);
      const jointB = jointIdByName(store.getState().document, "B");
      store.getState().select([jointB]);
      renderPanel(store);

      expect(store.getState().document.motors.some((m) => m.jointId === jointB)).toBe(false);
      const before = store.getState().document;

      fireEvent.click(screen.getByRole("button", { name: "Añadir motor" }));
      const motor = store.getState().document.motors.find((m) => m.jointId === jointB);
      expect(motor?.kind).toBe("rotary");

      act(() => {
        store.getState().undo();
      });
      expect(store.getState().document).toEqual(before);
    });

    it("a prismatic joint shows an axis-angle field; editing it stores a unit axis; undo restores", () => {
      const store = createMechanismStore();
      const doc = applyRecipesForTest(createEmptyDocument(), [
        addLink({
          id: "link-p1",
          name: "p1",
          pose: { position: [0, 0], angle: 0 },
          sites: [{ id: "site-p1", local: [0, 0] }],
        }),
        addLink({
          id: "link-p2",
          name: "p2",
          pose: { position: [5, 5], angle: 0 },
          sites: [{ id: "site-p2", local: [0, 0] }],
        }),
        addJoint({ id: "joint-p", type: "P", siteA: "site-p1", siteB: "site-p2", axis: [1, 0] }),
      ]);
      store.getState().loadDocument(doc);
      store.getState().select(["joint-p"]);
      renderPanel(store);

      const axisField = screen.getByLabelText<HTMLInputElement>("Ángulo del eje");
      expect(Number(axisField.value.replace(",", "."))).toBeCloseTo(0, 6);

      fireEvent.change(axisField, { target: { value: "90" } });
      fireEvent.keyDown(axisField, { key: "Enter" });

      const joint = store.getState().document.joints.find((j) => j.id === "joint-p");
      if (!joint || joint.type !== "P") throw new Error("joint-p missing or not P");
      expect(Math.hypot(joint.axis[0], joint.axis[1])).toBeCloseTo(1, 9);
      expect(joint.axis[1]).toBeCloseTo(1, 6);

      act(() => {
        store.getState().undo();
      });
      const restored = store.getState().document.joints.find((j) => j.id === "joint-p");
      expect(restored?.type === "P" && restored.axis).toEqual([1, 0]);
    });
  });

  describe("site form (a free site)", () => {
    it("shows name and world X/Y for a site with no joint; editing renames and moves it", () => {
      const store = createMechanismStore();
      buildExampleFourBar(store);
      const { siteIds } = store.getState().addLink({ name: "loose", sites: [{ local: [3, 4] }] });
      const freeSiteId = siteIds[0];
      store.getState().select([freeSiteId]);
      renderPanel(store);

      expect(screen.getByLabelText<HTMLInputElement>("X").value).toBe("3,00");
      expect(screen.getByLabelText<HTMLInputElement>("Y").value).toBe("4,00");

      const nameField = screen.getByLabelText<HTMLInputElement>("Nombre");
      fireEvent.change(nameField, { target: { value: "Loose site" } });
      fireEvent.keyDown(nameField, { key: "Enter" });
      const doc = store.getState().document;
      const site = indexDocument(doc).sites.get(freeSiteId);
      expect(site?.site.name).toBe("Loose site");

      const yField = screen.getByLabelText<HTMLInputElement>("Y");
      fireEvent.change(yField, { target: { value: "10" } });
      fireEvent.keyDown(yField, { key: "Enter" });
      const moved = indexDocument(store.getState().document).sites.get(freeSiteId);
      if (!moved) throw new Error("free site missing");
      expect(siteWorldPosition(moved.link, moved.site.local).y).toBeCloseTo(10, 9);
    });
  });

  describe("marker form", () => {
    it("shows the marker's world X/Y; editing Y moves marker.local accordingly", () => {
      const store = createMechanismStore();
      const ids = buildExampleFourBar(store);
      store.getState().select([ids.markerId]);
      renderPanel(store);

      const yField = screen.getByLabelText<HTMLInputElement>("Y");
      fireEvent.change(yField, { target: { value: "99" } });
      fireEvent.keyDown(yField, { key: "Enter" });

      const doc = store.getState().document;
      const marker = doc.markers.find((m) => m.id === ids.markerId);
      const link = doc.links.find((l) => l.id === marker?.linkId);
      if (!marker || !link) throw new Error("marker/link missing");
      const world = siteWorldPosition(link, marker.local);
      expect(world.y).toBeCloseTo(99, 9);
    });

    it("clicking the owning-link button selects the link", () => {
      const store = createMechanismStore();
      const ids = buildExampleFourBar(store);
      store.getState().select([ids.markerId]);
      renderPanel(store);
      fireEvent.click(screen.getByRole("button", { name: /coupler/ }));
      expect([...store.getState().selection]).toEqual([ids.couplerId]);
    });
  });

  it("does not fire tool shortcuts while typing in an Inspector text field", () => {
    const mechanismStore = createMechanismStore();
    const ids = buildExampleFourBar(mechanismStore);
    mechanismStore.getState().select([ids.crankId]);
    const studioStore = createStudioStore();

    function Harness(): ReactNode {
      useStudioShortcuts(studioStore, mechanismStore);
      return <InspectorPanel store={mechanismStore} />;
    }

    const i18n = createI18n("es");
    const theme = createStudioTheme("light", "es");
    render(
      <I18nextProvider i18n={i18n}>
        <ThemeProvider theme={theme}>
          <Harness />
        </ThemeProvider>
      </I18nextProvider>,
    );

    const nameField = screen.getByLabelText<HTMLInputElement>("Nombre");
    for (const key of ["s", "l", "v"]) {
      fireEvent.keyDown(nameField, { key, code: `Key${key.toUpperCase()}` });
    }
    expect(studioStore.getState().activeTool).toBe("select");
  });

  it("labels switch es -> en live", async () => {
    const store = createMechanismStore();
    const { i18n } = renderPanel(store, "es");
    expect(screen.getByLabelText("Nombre")).toBeDefined();
    await act(async () => {
      await i18n.changeLanguage("en");
    });
    expect(screen.getByLabelText("Name")).toBeDefined();
  });
});
