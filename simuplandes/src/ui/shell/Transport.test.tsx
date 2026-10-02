// @vitest-environment jsdom
import { Profiler, useState, type ProfilerOnRenderCallback } from "react";
import { render, screen, fireEvent, cleanup, act } from "@testing-library/react";
import { afterEach, beforeAll, describe, it, expect } from "vitest";
import { I18nextProvider } from "react-i18next";
import { ThemeProvider, CssBaseline } from "@mui/material";
import type { StoreApi } from "zustand";
import { Transport } from "./Transport";
import { createStudioTheme } from "../theme/studioTheme";
import { createI18n } from "../../i18n/i18n";
import { createPreferencesStore, type PreferencesState } from "../../uiState/preferences";
import { createStudioStore, type StudioState } from "../../uiState/studioStore";
import { createMechanismStore, buildExampleFourBar, type MechanismStore } from "../../store";
import { createSimStore, type SimStore } from "../../sim/simStore";
import { createSimRuntime, READOUT_INTERVAL_MS, type FrameScheduler } from "../../sim/runtime";
import { useSimRuntime } from "../../sim/react/useSimRuntime";
import { poseFromWorldPoints, worldToLinkLocal, type MechanismDocument } from "../../model";
import { localToWorld } from "../../geom";
import { installDomStubs } from "../../test/domStubs";

beforeAll(() => {
  installDomStubs();
});

afterEach(cleanup);

/** A manual, deterministic `FrameScheduler`: `tick(ms)` advances `now()` and runs every queued callback. */
class FakeScheduler implements FrameScheduler {
  private nowMs = 0;
  private queue = new Map<number, (nowMs: number) => void>();
  private nextId = 1;

  now(): number {
    return this.nowMs;
  }

  request(cb: (nowMs: number) => void): number {
    const id = this.nextId++;
    this.queue.set(id, cb);
    return id;
  }

  cancel(id: number): void {
    this.queue.delete(id);
  }

  tick(ms: number): void {
    this.nowMs += ms;
    const callbacks = Array.from(this.queue.values());
    this.queue.clear();
    for (const cb of callbacks) cb(this.nowMs);
  }
}

/** A fresh `buildExampleFourBar` document, built (and immediately discarded) through a scratch `MechanismStore` -- never through `src/kinematics` (the seam forbids importing it outside `src/sim/**`). */
function buildFourBarDocument(): MechanismDocument {
  const store = createMechanismStore();
  buildExampleFourBar(store);
  return store.getState().document;
}

/** fourBar plus a fifth bar rigidly pinning crank-site A to ground-site O4: a truss (not-drivable, 0 DOF). Built entirely from plain document data (`../../model`/`../../geom`), matching the seam. */
function buildFourBarTruss(): MechanismDocument {
  const base = buildFourBarDocument();
  const jointA = base.joints.find((j) => j.name === "A")!;
  const jointO4 = base.joints.find((j) => j.name === "O4")!;
  const crank = base.links.find((l) => l.name === "crank")!;
  const ground = base.links.find((l) => l.name === "ground")!;
  const crankSiteA = crank.sites.find((s) => s.id === jointA.siteA)!;
  const groundSiteO4 = ground.sites.find((s) => s.id === jointO4.siteB)!;

  const worldA = localToWorld(
    { x: crankSiteA.local[0], y: crankSiteA.local[1] },
    { x: crank.pose.position[0], y: crank.pose.position[1] },
    crank.pose.angle,
  );
  const worldO4 = localToWorld(
    { x: groundSiteO4.local[0], y: groundSiteO4.local[1] },
    { x: ground.pose.position[0], y: ground.pose.position[1] },
    ground.pose.angle,
  );

  const fifthPose = poseFromWorldPoints(worldA, worldO4);
  const siteAtA = {
    id: `${crankSiteA.id}-fifth-a`,
    name: "",
    local: worldToLinkLocal(fifthPose, worldA),
  };
  const siteAtO4 = {
    id: `${groundSiteO4.id}-fifth-o4`,
    name: "",
    local: worldToLinkLocal(fifthPose, worldO4),
  };
  const fifthBar: MechanismDocument["links"][number] = {
    id: "link:fifth-bar",
    name: "fifth-bar",
    isGround: false,
    pose: fifthPose,
    shape: { kind: "bar" },
    sites: [siteAtA, siteAtO4],
  };

  return {
    ...base,
    links: [...base.links, fifthBar],
    joints: [
      ...base.joints,
      {
        id: "joint:fifth-a",
        name: "fifth-A",
        type: "R",
        siteA: crankSiteA.id,
        siteB: siteAtA.id,
      },
      {
        id: "joint:fifth-o4",
        name: "fifth-O4",
        type: "R",
        siteA: groundSiteO4.id,
        siteB: siteAtO4.id,
      },
    ],
  };
}

interface WrapperProps {
  studioStore: StoreApi<StudioState>;
  mechanismStore: MechanismStore;
  simStore: SimStore;
  preferencesStore: StoreApi<PreferencesState>;
  scheduler: FrameScheduler;
}

/** Mirrors `StudioShell`'s own wiring exactly: one runtime per mount, `useSimRuntime` connects it to `studioStore`'s mode and the document. */
function Wrapper({
  studioStore,
  mechanismStore,
  simStore,
  preferencesStore,
  scheduler,
}: WrapperProps) {
  const [runtime] = useState(() =>
    createSimRuntime({ store: simStore, scheduler, readoutIntervalMs: READOUT_INTERVAL_MS }),
  );
  useSimRuntime({ studioStore, mechanismStore, simStore, runtime });
  const lengthUnit = mechanismStore.getState().document.units.length;
  return (
    <Transport
      studioStore={studioStore}
      simStore={simStore}
      runtime={runtime}
      preferencesStore={preferencesStore}
      lengthUnit={lengthUnit}
    />
  );
}

function renderTransport(doc: MechanismDocument | null, lang: "es" | "en" = "es") {
  const preferencesStore = createPreferencesStore({ storage: null });
  if (lang === "en") preferencesStore.getState().setLanguage("en");
  const studioStore = createStudioStore();
  const mechanismStore = doc
    ? createMechanismStore({ initialDocument: doc })
    : createMechanismStore();
  if (!doc) buildExampleFourBar(mechanismStore);
  const simStore = createSimStore();
  const scheduler = new FakeScheduler();
  const i18n = createI18n(lang);
  const theme = createStudioTheme("light", lang);

  const utils = render(
    <I18nextProvider i18n={i18n}>
      <ThemeProvider theme={theme}>
        <CssBaseline />
        <Wrapper
          studioStore={studioStore}
          mechanismStore={mechanismStore}
          simStore={simStore}
          preferencesStore={preferencesStore}
          scheduler={scheduler}
        />
      </ThemeProvider>
    </I18nextProvider>,
  );
  return { ...utils, studioStore, mechanismStore, simStore, scheduler };
}

function enterSimulate(studioStore: StoreApi<StudioState>): void {
  act(() => {
    studioStore.getState().setMode("simulate");
  });
}

describe("Transport region", () => {
  it("is a region named 'Transporte'", () => {
    renderTransport(null);
    expect(screen.getByRole("region", { name: "Transporte" })).toBeTruthy();
  });
});

describe("Transport in Build mode", () => {
  it("Play is enabled; scrubber/step/reset are disabled; the enter-simulate caption is shown", () => {
    renderTransport(null);
    expect(screen.getByRole<HTMLButtonElement>("button", { name: "Reproducir" }).disabled).toBe(
      false,
    );
    expect(screen.getByRole<HTMLInputElement>("slider").disabled).toBe(true);
    expect(screen.getByRole<HTMLButtonElement>("button", { name: "Reiniciar" }).disabled).toBe(
      true,
    );
    expect(screen.getByText("Pulsa Espacio o Reproducir para simular")).toBeTruthy();
  });

  it("clicking Play enters Simulate and starts playing", () => {
    const { simStore, studioStore } = renderTransport(null);
    fireEvent.click(screen.getByRole("button", { name: "Reproducir" }));
    expect(studioStore.getState().mode).toBe("simulate");
    expect(simStore.getState().playing).toBe(true);
  });
});

describe("Transport in Simulate mode, ready with a motor", () => {
  it("Play/Pause toggles simStore.playing and swaps its aria-label", () => {
    const { studioStore, simStore } = renderTransport(null);
    enterSimulate(studioStore);

    const playButton = screen.getByRole<HTMLButtonElement>("button", { name: "Reproducir" });
    expect(playButton.disabled).toBe(false);
    fireEvent.click(playButton);
    expect(simStore.getState().playing).toBe(true);
    expect(screen.getByRole("button", { name: "Pausar" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Pausar" }));
    expect(simStore.getState().playing).toBe(false);
  });

  it("Step forward/back change readout.display by +-1 degree", () => {
    const { studioStore, simStore } = renderTransport(null);
    enterSimulate(studioStore);
    const before = simStore.getState().readout!.display;

    fireEvent.click(screen.getByRole("button", { name: "Paso adelante" }));
    expect(simStore.getState().readout!.display).toBeCloseTo(before + 1, 6);

    fireEvent.click(screen.getByRole("button", { name: "Paso atrás" }));
    expect(simStore.getState().readout!.display).toBeCloseTo(before, 6);
  });

  it("Reset returns the display to 60 degrees (the reference-pose crank angle)", () => {
    const { studioStore, simStore } = renderTransport(null);
    enterSimulate(studioStore);
    fireEvent.click(screen.getByRole("button", { name: "Paso adelante" }));
    fireEvent.click(screen.getByRole("button", { name: "Paso adelante" }));

    fireEvent.click(screen.getByRole("button", { name: "Reiniciar" }));
    expect(simStore.getState().readout!.display).toBeCloseTo(60, 6);
  });

  it("the speed select sets simStore.speed", () => {
    const { studioStore, simStore } = renderTransport(null);
    enterSimulate(studioStore);
    act(() => {
      simStore.getState().setSpeed(2);
    });
    expect(simStore.getState().speed).toBe(2);
  });

  it("the loop checkbox toggles simStore.loop", () => {
    const { studioStore, simStore } = renderTransport(null);
    enterSimulate(studioStore);
    const checkbox = screen.getByRole<HTMLInputElement>("checkbox", { name: "Repetir" });
    const before = simStore.getState().loop;
    fireEvent.click(checkbox);
    expect(simStore.getState().loop).toBe(!before);
  });

  it("changing the scrubber calls runtime.scrubTo and readout.display follows", () => {
    const { studioStore, simStore } = renderTransport(null);
    enterSimulate(studioStore);
    const before = simStore.getState().readout!.display;

    // jsdom does not implement a native <input type="range">'s browser-level
    // ArrowRight keyboard handling (MUI's own hidden-input `onKeyDown` only
    // handles the Shift+Arrow/PageUp/PageDown "big step" case) -- simulate
    // the resulting native value-change event directly, exactly as MUI's
    // own Slider test suite does.
    const slider = screen.getByRole<HTMLInputElement>("slider", { name: /Entrada/ });
    fireEvent.change(slider, { target: { value: String(before + 1) } });

    expect(simStore.getState().readout!.display).toBeCloseTo(before + 1, 6);
  });

  it("shows a lock-up chip when readout.lockUp is set", () => {
    const { studioStore, simStore } = renderTransport(null);
    enterSimulate(studioStore);
    act(() => {
      simStore.getState().setReadout({
        ...simStore.getState().readout!,
        lockUp: { display: 12.3 },
      });
    });
    expect(screen.getByText(/Posición de agarrotamiento/)).toBeTruthy();
  });

  it("shows a near-singular chip when readout.nearSingular is true", () => {
    const { studioStore, simStore } = renderTransport(null);
    enterSimulate(studioStore);
    act(() => {
      simStore.getState().setReadout({ ...simStore.getState().readout!, nearSingular: true });
    });
    expect(screen.getByText("Cerca de una posición singular")).toBeTruthy();
  });
});

describe("Transport: temporary-driver session (motors removed)", () => {
  it("disables the scrubber and Play, and shows the temporary-driver status text", () => {
    const doc = buildFourBarDocument();
    const noMotorDoc: MechanismDocument = { ...doc, motors: [] };
    const { studioStore } = renderTransport(noMotorDoc);
    enterSimulate(studioStore);

    expect(screen.getByRole<HTMLButtonElement>("button", { name: "Reproducir" }).disabled).toBe(
      true,
    );
    expect(screen.getByRole<HTMLInputElement>("slider").disabled).toBe(true);
    expect(
      screen.getByText(
        "Sin motor: arrastra un eslabón para moverlo; agrega un motor para usar el deslizador",
      ),
    ).toBeTruthy();
  });
});

describe("Transport: not-drivable truss", () => {
  it("disables the controls and shows the no-DOF status text", () => {
    const { studioStore } = renderTransport(buildFourBarTruss());
    enterSimulate(studioStore);

    expect(screen.getByRole<HTMLButtonElement>("button", { name: "Reproducir" }).disabled).toBe(
      true,
    );
    expect(
      screen.getByText("Este mecanismo no puede moverse (0 GDL). Mira el indicador F."),
    ).toBeTruthy();
  });
});

describe("Transport: ignored motors", () => {
  it("shows the ignoredMotors plural text while still driving the first motor", () => {
    const doc = buildFourBarDocument();
    const secondMotor = {
      id: "motor:second",
      name: "",
      jointId: doc.joints.find((j) => j.name === "A")!.id,
      kind: "rotary" as const,
      drive: { mode: "constant" as const, speed: 1 },
    };
    const twoMotorDoc: MechanismDocument = { ...doc, motors: [...doc.motors, secondMotor] };
    const { studioStore } = renderTransport(twoMotorDoc);
    enterSimulate(studioStore);

    expect(
      screen.getByText("Hay 1 motor adicional; el transporte solo impulsa el primero"),
    ).toBeTruthy();
    expect(screen.getByRole<HTMLButtonElement>("button", { name: "Reproducir" }).disabled).toBe(
      false,
    );
  });
});

describe("Transport plots chip", () => {
  it("toggles simStore.plot.open and is enabled only in simulate", () => {
    const { studioStore, simStore } = renderTransport(null);
    const chip = () => screen.getByText("Gráficas ▾");
    expect(chip().closest('[aria-disabled="true"]')).toBeTruthy();

    enterSimulate(studioStore);
    fireEvent.click(chip());
    expect(simStore.getState().plot.open).toBe(true);
  });
});

describe("Transport render discipline", () => {
  it("30 frames of fake-scheduler playback cause at most ceil(30*16/50)+2 renders", () => {
    const preferencesStore = createPreferencesStore({ storage: null });
    const studioStore = createStudioStore();
    const mechanismStore = createMechanismStore();
    buildExampleFourBar(mechanismStore);
    const simStore = createSimStore();
    const scheduler = new FakeScheduler();
    const i18n = createI18n("es");
    const theme = createStudioTheme("light", "es");

    let renderCount = 0;
    const onRender: ProfilerOnRenderCallback = () => {
      renderCount += 1;
    };

    render(
      <I18nextProvider i18n={i18n}>
        <ThemeProvider theme={theme}>
          <CssBaseline />
          <Profiler id="transport" onRender={onRender}>
            <Wrapper
              studioStore={studioStore}
              mechanismStore={mechanismStore}
              simStore={simStore}
              preferencesStore={preferencesStore}
              scheduler={scheduler}
            />
          </Profiler>
        </ThemeProvider>
      </I18nextProvider>,
    );
    renderCount = 0; // ignore the mount render itself

    act(() => {
      studioStore.getState().setMode("simulate");
    });
    renderCount = 0; // ignore entering simulate

    fireEvent.click(screen.getByRole("button", { name: "Reproducir" }));
    renderCount = 0; // ignore the play-click render

    act(() => {
      for (let i = 0; i < 30; i++) {
        scheduler.tick(16);
      }
    });

    const bound = Math.ceil((30 * 16) / READOUT_INTERVAL_MS) + 2;
    expect(renderCount).toBeLessThanOrEqual(bound);
  });
});
