// @vitest-environment jsdom
import { Profiler, type ProfilerOnRenderCallback } from "react";
import { render, screen, fireEvent, cleanup, within, act } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, it, expect, vi } from "vitest";
import { I18nextProvider } from "react-i18next";
import { ThemeProvider, CssBaseline } from "@mui/material";
import { PlotDock } from "./PlotDock";
import { createStudioTheme } from "../theme/studioTheme";
import { createI18n } from "../../i18n/i18n";
import { createStudioStore } from "../../uiState/studioStore";
import { createMechanismStore } from "../../store";
import { createSimStore } from "../../sim/simStore";
import { createSimRuntime, type FrameScheduler } from "../../sim/runtime";
import { buildFourBarFixture } from "../../sim/__fixtures__/documents";
import { installDomStubs } from "../../test/domStubs";

interface FakeUPlotInstance {
  opts: unknown;
  data: unknown;
  setData: ReturnType<typeof vi.fn>;
  setSize: ReturnType<typeof vi.fn>;
  destroy: ReturnType<typeof vi.fn>;
}

const uplotInstances: FakeUPlotInstance[] = [];

vi.mock("uplot", () => {
  class FakeUPlot {
    opts: unknown;
    data: unknown;
    setData = vi.fn();
    setSize = vi.fn();
    destroy = vi.fn();
    constructor(opts: unknown, data: unknown) {
      this.opts = opts;
      this.data = data;
      uplotInstances.push(this);
    }
  }
  return { default: FakeUPlot };
});

/** A manual, deterministic `FrameScheduler` (same shape as `runtime.test.ts`'s own). */
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

beforeAll(() => {
  installDomStubs();
});

beforeEach(() => {
  uplotInstances.length = 0;
});

afterEach(cleanup);

function makeHarness(lang: "es" | "en" = "es") {
  const doc = buildFourBarFixture();
  const mechanismStore = createMechanismStore({ initialDocument: doc });
  const studioStore = createStudioStore();
  studioStore.getState().setMode("simulate");
  const simStore = createSimStore();
  const scheduler = new FakeScheduler();
  const runtime = createSimRuntime({ store: simStore, scheduler, readoutIntervalMs: 50 });
  runtime.enter(doc);
  simStore.getState().setPlotOpen(true);

  const i18n = createI18n(lang);
  const theme = createStudioTheme("light", lang);

  return { doc, mechanismStore, studioStore, simStore, scheduler, runtime, i18n, theme };
}

function renderDock(h: ReturnType<typeof makeHarness>) {
  return render(
    <I18nextProvider i18n={h.i18n}>
      <ThemeProvider theme={h.theme}>
        <CssBaseline />
        <PlotDock
          studioStore={h.studioStore}
          simStore={h.simStore}
          runtime={h.runtime}
          mechanismStore={h.mechanismStore}
        />
      </ThemeProvider>
    </I18nextProvider>,
  );
}

describe("PlotDock: visibility", () => {
  it("renders nothing in build mode", () => {
    const h = makeHarness();
    h.studioStore.getState().setMode("build");
    renderDock(h);
    expect(screen.queryByRole("region", { name: "Panel de gráficas" })).toBeNull();
  });

  it("renders nothing when plot.open is false", () => {
    const h = makeHarness();
    h.simStore.getState().setPlotOpen(false);
    renderDock(h);
    expect(screen.queryByRole("region", { name: "Panel de gráficas" })).toBeNull();
  });
});

describe("PlotDock: open in simulate", () => {
  it("shows the region, x-axis toggle, quantity picker (15 quantities), and the default rocker-angle selection", () => {
    const h = makeHarness();
    renderDock(h);

    expect(screen.getByRole("region", { name: "Panel de gráficas" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Entrada" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Tiempo" })).toBeTruthy();

    // Default selection: the rocker's angle (chip rendered in the closed Select).
    expect(screen.getByText(/rocker · ángulo/)).toBeTruthy();

    const combobox = screen.getByRole("combobox");
    fireEvent.mouseDown(combobox);
    const listbox = screen.getByRole("listbox");
    expect(within(listbox).getAllByRole("option")).toHaveLength(15);
  });

  it("receives sweepTable.x and the selected column, plus the nominal-rate note", () => {
    const h = makeHarness();
    renderDock(h);

    expect(uplotInstances).toHaveLength(1);
    const [xColumn] = uplotInstances[0].data as [number[], number[]];
    const sweepTable = h.simStore.getState().sweepTable;
    expect(sweepTable).not.toBeNull();
    expect(Array.from(xColumn)).toEqual(Array.from(sweepTable!.x));

    expect(screen.getByText(/rad\/s/)).toBeTruthy();
  });

  it("selecting an additional quantity updates simStore.plot.quantityIds and reconstructs the chart with 3 series", () => {
    const h = makeHarness();
    renderDock(h);
    expect(uplotInstances).toHaveLength(1);

    const combobox = screen.getByRole("combobox");
    fireEvent.mouseDown(combobox);
    const option = screen.getByText(/coupler-tracer · x/);
    fireEvent.click(option);

    expect(h.simStore.getState().plot.quantityIds).toHaveLength(2);
    expect(uplotInstances.length).toBeGreaterThanOrEqual(2);
    const latest = uplotInstances[uplotInstances.length - 1];
    const opts = latest.opts as { series: unknown[] };
    expect(opts.series).toHaveLength(3); // 1 x + 2 y
  });
});

describe("PlotDock: time axis", () => {
  it("shows emptyTime before playback, then pushes imperative updates with no extra PlotDock renders after the first", () => {
    const h = makeHarness();
    h.simStore.getState().setPlotXAxis("time");

    let renderCount = 0;
    const onRender: ProfilerOnRenderCallback = () => {
      renderCount += 1;
    };

    render(
      <I18nextProvider i18n={h.i18n}>
        <ThemeProvider theme={h.theme}>
          <CssBaseline />
          <Profiler id="plot-dock" onRender={onRender}>
            <PlotDock
              studioStore={h.studioStore}
              simStore={h.simStore}
              runtime={h.runtime}
              mechanismStore={h.mechanismStore}
            />
          </Profiler>
        </ThemeProvider>
      </I18nextProvider>,
    );

    expect(
      screen.getByText("Sin historial: reproduce la simulación para registrar datos en el tiempo"),
    ).toBeTruthy();

    // A single tick already bumps `historyVersion` (the very first frame's
    // `lastHistoryBumpMs === null` check fires unconditionally) -- flush
    // that ALONE first so React actually commits the chart's mount (and
    // `chartRef` gets attached) before any further bumps arrive. Batching
    // every tick into one `act()` (as a real 30-frame play would, absent
    // React's own automatic batching) would collapse all 30 bumps into a
    // single render, never exercising the imperative `setData` path this
    // test exists to prove.
    act(() => {
      h.runtime.play();
      h.scheduler.tick(16);
    });
    expect(h.simStore.getState().historyVersion).toBeGreaterThan(0);
    expect(uplotInstances.length).toBeGreaterThanOrEqual(1);

    const renderCountAfterMount = renderCount;
    act(() => {
      for (let i = 0; i < 29; i++) h.scheduler.tick(16);
    });

    // The chart mounted once history started arriving; further bumps push
    // through the imperative handle, not through more renders.
    const chart = uplotInstances[uplotInstances.length - 1];
    expect(chart.setData).toHaveBeenCalled();
    expect(renderCount).toBe(renderCountAfterMount);
  });
});

describe("PlotDock: CSV export", () => {
  it("Export CSV builds a Blob equal to tableToCsv(...) and downloads csvFileName(doc.name, xKind)", async () => {
    const h = makeHarness();
    renderDock(h);

    const created: { blob: Blob; url: string }[] = [];
    const originalCreate: typeof URL.createObjectURL = URL.createObjectURL.bind(URL);
    const originalRevoke: typeof URL.revokeObjectURL = URL.revokeObjectURL.bind(URL);
    const revoked: string[] = [];
    URL.createObjectURL = (blob: Blob) => {
      const url = `blob:fake-${created.length}`;
      created.push({ blob, url });
      return url;
    };
    URL.revokeObjectURL = (url: string) => {
      revoked.push(url);
    };

    let clickedHref: string | null = null;
    let clickedDownload: string | null = null;
    const originalClick: typeof HTMLAnchorElement.prototype.click =
      HTMLAnchorElement.prototype.click.bind(HTMLAnchorElement.prototype);
    HTMLAnchorElement.prototype.click = function click(this: HTMLAnchorElement) {
      clickedHref = this.href;
      clickedDownload = this.download;
    };

    try {
      fireEvent.click(screen.getByRole("button", { name: "Exportar CSV" }));

      expect(created).toHaveLength(1);
      const text = await created[0].blob.text();

      const { tableToCsv, csvFileName } = await import("../../sim/csv");
      const sweepTable = h.simStore.getState().sweepTable!;
      const session = h.simStore.getState().session!;
      const expectedCsv = tableToCsv(sweepTable, h.simStore.getState().plot.quantityIds, {
        inputLabel: session.inputLabel,
        lengthUnit: h.doc.units.length,
      });
      expect(text).toBe(expectedCsv);
      expect(clickedDownload).toBe(csvFileName(h.doc.name, "input"));
      expect(clickedHref).toContain(created[0].url);
      expect(revoked).toContain(created[0].url);
    } finally {
      URL.createObjectURL = originalCreate;
      URL.revokeObjectURL = originalRevoke;
      HTMLAnchorElement.prototype.click = originalClick;
    }
  });
});
