// @vitest-environment jsdom
import { render, screen, fireEvent, cleanup, act, within } from "@testing-library/react";
import { afterEach, beforeAll, describe, it, expect } from "vitest";
import { I18nextProvider } from "react-i18next";
import { ThemeProvider } from "@mui/material";
import { InspectorPanel } from "./InspectorPanel";
import { createI18n } from "../../i18n/i18n";
import { createStudioTheme } from "../theme/studioTheme";
import { createMechanismStore, buildExampleFourBar, type MechanismStore } from "../../store";
import { addSpring } from "../../store/commands";
import { installDomStubs } from "../../test/domStubs";
import type { MechanismDocument } from "../../model";

beforeAll(() => {
  installDomStubs();
});

afterEach(cleanup);

function renderPanel(store: MechanismStore) {
  const i18n = createI18n("en");
  const theme = createStudioTheme("light", "en");
  return render(
    <I18nextProvider i18n={i18n}>
      <ThemeProvider theme={theme}>
        <InspectorPanel store={store} />
      </ThemeProvider>
    </I18nextProvider>,
  );
}

function typeInto(label: string | RegExp, value: string): void {
  const field = screen.getByLabelText<HTMLInputElement>(label);
  fireEvent.change(field, { target: { value } });
  fireEvent.keyDown(field, { key: "Enter" });
}

function fourBar(): { store: MechanismStore; ids: ReturnType<typeof buildExampleFourBar> } {
  const store = createMechanismStore();
  const ids = buildExampleFourBar(store);
  return { store, ids };
}

function jointId(doc: MechanismDocument, name: string): string {
  return doc.joints.find((j) => j.name === name)!.id;
}

describe("Inspector: document dynamics", () => {
  it("edits gravity and densities, ignoring a non-positive density", () => {
    const { store } = fourBar();
    renderPanel(store);
    typeInto("Gravity y", "-1.62");
    expect(store.getState().document.dynamics.gravity).toEqual([0, -1.62]);
    typeInto("Gravity x", "0.5");
    expect(store.getState().document.dynamics.gravity).toEqual([0.5, -1.62]);
    typeInto("Bar density", "2");
    typeInto("Plate density", "20");
    expect(store.getState().document.dynamics).toMatchObject({ barDensity: 2, plateDensity: 20 });
    typeInto("Bar density", "0");
    typeInto("Plate density", "-3");
    expect(store.getState().document.dynamics).toMatchObject({ barDensity: 2, plateDensity: 20 });
  });

  it("counts springs", () => {
    const { store } = fourBar();
    const b = jointId(store.getState().document, "B");
    store
      .getState()
      .execute("t", addSpring({ id: "s1", kind: "torsional", jointId: b, stiffness: 1 }));
    renderPanel(store);
    expect(screen.getByText(/1 spring/)).toBeTruthy();
  });
});

describe("Inspector: link mass properties and loads", () => {
  it("shows computed mass properties, switches to custom (prefilled) and back", () => {
    const { store, ids } = fourBar();
    store.getState().select([ids.crankId]);
    renderPanel(store);
    // The 40 mm crank at 0.5 kg/m: 0.02 kg.
    expect(screen.getByTestId("computed-mass").textContent).toMatch(/Mass: 0\.02 kg/);

    fireEvent.click(screen.getByRole("button", { name: "Custom" }));
    const crank = () => store.getState().document.links.find((l) => l.id === ids.crankId)!;
    expect(crank().massProperties?.mass).toBeCloseTo(0.02, 12);
    typeInto("Mass", "0.5");
    typeInto("Center of mass x", "10");
    typeInto("Center of mass y", "-2");
    typeInto("Inertia about the center of mass", "0.001");
    expect(crank().massProperties).toEqual({ mass: 0.5, com: [10, -2], inertia: 0.001 });
    typeInto("Mass", "-4");
    expect(crank().massProperties?.mass).toBe(0);

    fireEvent.click(screen.getByRole("button", { name: "Custom" })); // already custom: no-op
    fireEvent.click(screen.getByRole("button", { name: "From shape" }));
    expect(crank().massProperties).toBeUndefined();
  });

  it("adds, edits and removes a load", () => {
    const { store, ids } = fourBar();
    store.getState().select([ids.couplerId]);
    renderPanel(store);
    expect(screen.getByText("No loads on this link")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Add load" }));
    const load = () => store.getState().document.loads[0];
    expect(load()).toMatchObject({ force: [0, -1], torque: 0 });
    typeInto("Fx", "3");
    typeInto("Fy", "-5");
    typeInto("Torque", "0.25");
    expect(load()).toMatchObject({ force: [3, -5], torque: 0.25 });

    const group = screen.getByRole("group", { name: "Loads 1" });
    fireEvent.mouseDown(within(group).getByRole("combobox", { name: "Site" }));
    const coupler = store.getState().document.links.find((l) => l.id === ids.couplerId)!;
    const secondSite = coupler.sites[1];
    fireEvent.click(screen.getByRole("option", { name: secondSite.name || secondSite.id }));
    expect(load().siteId).toBe(secondSite.id);

    fireEvent.click(screen.getByRole("button", { name: "Add load" }));
    expect(screen.getByRole("group", { name: "Loads 2" })).toBeTruthy();
    fireEvent.click(screen.getAllByRole("button", { name: "Remove load" })[0]);
    expect(store.getState().document.loads).toHaveLength(1);
  });

  it("shows no dynamics sections for ground", () => {
    const { store } = fourBar();
    const ground = store.getState().document.links.find((l) => l.isGround)!;
    store.getState().select([ground.id]);
    renderPanel(store);
    expect(screen.queryByText("Mass properties")).toBeNull();
    expect(screen.queryByText("Loads")).toBeNull();
  });
});

describe("Inspector: motor dynamics", () => {
  it("switches a motor to an effort expression and back", () => {
    const { store } = fourBar();
    const o2 = jointId(store.getState().document, "O2");
    store.getState().select([o2]);
    renderPanel(store);
    const motor = () => store.getState().document.motors[0];

    fireEvent.click(screen.getByRole("button", { name: "Applies a torque" }));
    expect(motor().dynamics).toEqual({ mode: "effort", expression: "0" });
    expect(screen.getByText(/Use t \(s\)/)).toBeTruthy();

    const field = screen.getByLabelText<HTMLInputElement>("Torque [N·m]");
    fireEvent.change(field, { target: { value: "  " } });
    fireEvent.keyDown(field, { key: "Enter" });
    expect(screen.getByText("The expression cannot be empty")).toBeTruthy();
    fireEvent.change(field, { target: { value: "-2*dq" } });
    fireEvent.blur(field);
    expect(motor().dynamics).toEqual({ mode: "effort", expression: "-2*dq" });
    fireEvent.keyDown(field, { key: "Enter" }); // unchanged: no new step

    fireEvent.click(screen.getByRole("button", { name: "Applies a torque" })); // no-op
    fireEvent.click(screen.getByRole("button", { name: "Follows its motion" }));
    expect(motor().dynamics).toEqual({ mode: "motion" });
  });
});

describe("Inspector: springs", () => {
  it("adds a torsional spring from a joint and edits it", () => {
    const { store } = fourBar();
    const b = jointId(store.getState().document, "B");
    store.getState().select([b]);
    renderPanel(store);

    fireEvent.click(screen.getByRole("button", { name: "Add torsional spring" }));
    const spring = () => store.getState().document.springs[0];
    expect(spring()).toMatchObject({ kind: "torsional", jointId: b, stiffness: 1 });
    expect(store.getState().selection).toEqual(new Set([spring().id]));

    expect(screen.getByText("Torsional spring")).toBeTruthy();
    expect(screen.getByText("Joint B")).toBeTruthy();
    typeInto("Stiffness", "2.5");
    typeInto("Damping", "-1");
    typeInto("Free angle", "90");
    expect(spring()).toMatchObject({ stiffness: 2.5, damping: 0 });
    const torsional = spring();
    if (torsional.kind !== "torsional") throw new Error("expected a torsional spring");
    expect(torsional.freeAngle).toBeCloseTo(Math.PI / 2, 12);

    const nameField = screen.getByLabelText<HTMLInputElement>("Name");
    fireEvent.change(nameField, { target: { value: "k-B" } });
    fireEvent.keyDown(nameField, { key: "Enter" });
    expect(spring().name).toBe("k-B");

    // Back on the joint, the spring is listed and selectable.
    act(() => store.getState().select([b]));
    fireEvent.click(screen.getByRole("button", { name: "k-B" }));
    expect(store.getState().selection).toEqual(new Set([spring().id]));
  });

  it("edits a linear spring and shows its current length", () => {
    const { store, ids } = fourBar();
    const doc = store.getState().document;
    const ground = doc.links.find((l) => l.isGround)!;
    const coupler = doc.links.find((l) => l.id === ids.couplerId)!;
    store.getState().execute(
      "t",
      addSpring({
        id: "s1",
        kind: "linear",
        siteA: ground.sites[0].id,
        siteB: coupler.sites[1].id,
        stiffness: 100,
        freeLength: 50,
      }),
    );
    store.getState().select(["s1"]);
    renderPanel(store);
    expect(screen.getByText("Spring")).toBeTruthy();
    expect(screen.getByText(/Current length: \d+\.\d\d mm/)).toBeTruthy();
    typeInto("Free length", "80");
    typeInto("Stiffness", "250");
    const spring = store.getState().document.springs[0];
    expect(spring).toMatchObject({ freeLength: 80, stiffness: 250 });
  });
});
