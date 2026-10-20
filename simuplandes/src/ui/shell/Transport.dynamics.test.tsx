// @vitest-environment jsdom
import { useState } from "react";
import { render, screen, fireEvent, cleanup, act } from "@testing-library/react";
import { afterEach, beforeAll, describe, it, expect } from "vitest";
import { I18nextProvider } from "react-i18next";
import { ThemeProvider } from "@mui/material";
import type { StoreApi } from "zustand";
import { Transport } from "./Transport";
import { createStudioTheme } from "../theme/studioTheme";
import { createI18n } from "../../i18n/i18n";
import { createPreferencesStore } from "../../uiState/preferences";
import { createStudioStore, type StudioState } from "../../uiState/studioStore";
import { createMechanismStore, type MechanismStore } from "../../store";
import { createSimStore, type SimStore } from "../../sim/simStore";
import { createSimRuntime, READOUT_INTERVAL_MS } from "../../sim/runtime";
import { useSimRuntime } from "../../sim/react/useSimRuntime";
import { FakeScheduler } from "../../sim/__fixtures__/fakeScheduler";
import { MechanismDocumentSchema, type MechanismDocument } from "../../model";
import { installDomStubs } from "../../test/domStubs";

beforeAll(() => {
  installDomStubs();
});

afterEach(cleanup);

/** A two-rod pendulum hanging from the origin, both rods horizontal at the start (2 DOF). */
function doublePendulum(extra: Partial<MechanismDocument> = {}): MechanismDocument {
  return MechanismDocumentSchema.parse({
    schemaVersion: 2,
    links: [
      {
        id: "ground",
        name: "ground",
        isGround: true,
        pose: { position: [0, 0], angle: 0 },
        shape: { kind: "bar" },
        sites: [{ id: "g", local: [0, 0] }],
      },
      {
        id: "upper",
        name: "upper",
        isGround: false,
        pose: { position: [0, 0], angle: 0 },
        shape: { kind: "bar" },
        sites: [
          { id: "u0", local: [0, 0] },
          { id: "u1", local: [500, 0] },
        ],
      },
      {
        id: "lower",
        name: "lower",
        isGround: false,
        pose: { position: [500, 0], angle: 0 },
        shape: { kind: "bar" },
        sites: [
          { id: "l0", local: [0, 0] },
          { id: "l1", local: [500, 0] },
        ],
      },
    ],
    joints: [
      { id: "j0", name: "O", type: "R", siteA: "g", siteB: "u0" },
      { id: "j1", name: "A", type: "R", siteA: "u1", siteB: "l0" },
    ],
    ...extra,
  });
}

function Wrapper(props: {
  studioStore: StoreApi<StudioState>;
  mechanismStore: MechanismStore;
  simStore: SimStore;
  scheduler: FakeScheduler;
}) {
  const { studioStore, mechanismStore, simStore, scheduler } = props;
  const [preferencesStore] = useState(() => {
    const store = createPreferencesStore({ storage: null });
    store.getState().setLanguage("en");
    return store;
  });
  const [runtime] = useState(() =>
    createSimRuntime({ store: simStore, scheduler, readoutIntervalMs: READOUT_INTERVAL_MS }),
  );
  useSimRuntime({ studioStore, mechanismStore, simStore, runtime });
  return (
    <Transport
      studioStore={studioStore}
      simStore={simStore}
      runtime={runtime}
      preferencesStore={preferencesStore}
      lengthUnit="mm"
    />
  );
}

function renderTransport(doc: MechanismDocument) {
  const studioStore = createStudioStore();
  const mechanismStore = createMechanismStore({ initialDocument: doc });
  const simStore = createSimStore();
  simStore.getState().setDynamicsDuration(2);
  const scheduler = new FakeScheduler();
  render(
    <I18nextProvider i18n={createI18n("en")}>
      <ThemeProvider theme={createStudioTheme("light", "en")}>
        <Wrapper
          studioStore={studioStore}
          mechanismStore={mechanismStore}
          simStore={simStore}
          scheduler={scheduler}
        />
      </ThemeProvider>
    </I18nextProvider>,
  );
  return { studioStore, mechanismStore, simStore, scheduler };
}

function enterDynamics(h: ReturnType<typeof renderTransport>): void {
  act(() => h.studioStore.getState().setMode("simulate"));
  fireEvent.click(screen.getByRole("button", { name: "Dynamics" }));
}

describe("Transport: dynamics analysis", () => {
  it("switches analysis, shows computing progress, then the free DOF", () => {
    const h = renderTransport(doublePendulum());
    act(() => h.studioStore.getState().setMode("simulate"));
    // Kinematics cannot drive two DOF.
    expect(screen.getByRole("button", { name: "Play" })).toHaveProperty("disabled", true);

    fireEvent.click(screen.getByRole("button", { name: "Dynamics" }));
    expect(h.simStore.getState().analysis).toBe("dynamics");
    expect(screen.getByText(/Computing… 0\.0 of 2 s/)).toBeTruthy();
    expect(h.studioStore.getState().simHint?.key).toBe("sim.hint.dynamics");
    expect(screen.getByRole("button", { name: "Play" })).toHaveProperty("disabled", false);

    act(() => h.scheduler.tick(16));
    expect(screen.getByText("2 free DOF under gravity, springs and motors")).toBeTruthy();
    expect(screen.getByRole("slider", { name: "Time" })).toBeTruthy();
  });

  it("plays, scrubs and changes the duration", () => {
    const h = renderTransport(doublePendulum());
    enterDynamics(h);
    act(() => h.scheduler.tick(16));

    fireEvent.click(screen.getByRole("button", { name: "Play" }));
    act(() => {
      for (let i = 0; i < 5; i++) h.scheduler.tick(100);
    });
    expect(h.simStore.getState().readout!.time).toBeCloseTo(0.5, 6);
    fireEvent.click(screen.getByRole("button", { name: "Pause" }));

    fireEvent.change(screen.getByRole("slider", { name: "Time" }), { target: { value: 1.5 } });
    expect(h.simStore.getState().readout!.time).toBeCloseTo(1.5, 6);
    expect(screen.getAllByText("1.50 s").length).toBeGreaterThan(0);

    fireEvent.mouseDown(screen.getByRole("combobox", { name: "Duration" }));
    fireEvent.click(screen.getByRole("option", { name: "5 s" }));
    expect(h.simStore.getState().dynamicsDuration).toBe(5);
  });

  it("explains why a document cannot run", () => {
    const h = renderTransport(
      doublePendulum({
        motors: [
          {
            id: "m0",
            name: "",
            jointId: "j0",
            kind: "rotary",
            drive: { mode: "constant", speed: 1 },
            dynamics: { mode: "effort", expression: "q +" },
          },
        ],
      }),
    );
    enterDynamics(h);
    expect(screen.getByText("Fix the motor expressions: m0")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Play" })).toHaveProperty("disabled", true);
    expect(h.studioStore.getState().simHint?.key).toBe("sim.hint.notDrivable");
  });

  it("reports where integration stopped, and flags redundant constraints", () => {
    const h = renderTransport(
      doublePendulum({
        joints: [
          { id: "j0", name: "O", type: "R", siteA: "g", siteB: "u0" },
          { id: "j1", name: "A", type: "R", siteA: "u1", siteB: "l0" },
          // A redundant second pin at A.
          { id: "j2", name: "A2", type: "R", siteA: "u1", siteB: "l0" },
        ],
        motors: [
          {
            id: "m0",
            name: "",
            jointId: "j0",
            kind: "rotary",
            drive: { mode: "constant", speed: 1 },
            dynamics: { mode: "effort", expression: "sqrt(0.5 - t)" },
          },
        ],
      }),
    );
    enterDynamics(h);
    act(() => h.scheduler.tick(16));
    expect(screen.getByText(/Stopped at 0\.5\d s: a motor's effort is not a number/)).toBeTruthy();
    expect(screen.getByText("Redundant constraints: the reactions are not unique")).toBeTruthy();
  });

  it("goes back to kinematics", () => {
    const h = renderTransport(doublePendulum());
    enterDynamics(h);
    fireEvent.click(screen.getByRole("button", { name: "Kinematics" }));
    expect(h.simStore.getState().analysis).toBe("kinematics");
    expect(screen.queryByRole("combobox", { name: "Duration" })).toBeNull();
    expect(h.studioStore.getState().simHint?.key).toBe("sim.hint.notDrivable");
  });

  it("shows other session problems", () => {
    const empty = renderTransport(MechanismDocumentSchema.parse({ schemaVersion: 2 }));
    enterDynamics(empty);
    expect(screen.getByText("Draw a mechanism to simulate it")).toBeTruthy();
  });
});
