// @vitest-environment jsdom
import { createRef } from "react";
import { render, cleanup } from "@testing-library/react";
import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { UPlotChart, type UPlotChartHandle, type UPlotSeriesSpec } from "./UPlotChart";

interface FakeUPlotInstance {
  opts: unknown;
  data: unknown;
  target: unknown;
  setData: ReturnType<typeof vi.fn>;
  setSize: ReturnType<typeof vi.fn>;
  destroy: ReturnType<typeof vi.fn>;
}

const instances: FakeUPlotInstance[] = [];

vi.mock("uplot", () => {
  class FakeUPlot {
    opts: unknown;
    data: unknown;
    target: unknown;
    setData = vi.fn();
    setSize = vi.fn();
    destroy = vi.fn();
    constructor(opts: unknown, data: unknown, target: unknown) {
      this.opts = opts;
      this.data = data;
      this.target = target;
      instances.push(this);
    }
  }
  return { default: FakeUPlot };
});

class FakeResizeObserver {
  static instances: FakeResizeObserver[] = [];
  callback: ResizeObserverCallback;
  observe = vi.fn();
  unobserve = vi.fn();
  disconnect = vi.fn();
  constructor(callback: ResizeObserverCallback) {
    this.callback = callback;
    FakeResizeObserver.instances.push(this);
  }
  trigger(width: number, height: number): void {
    this.callback([{ contentRect: { width, height } } as unknown as ResizeObserverEntry], this);
  }
}

function series(overrides?: Partial<UPlotSeriesSpec>[]): UPlotSeriesSpec[] {
  const base: UPlotSeriesSpec = {
    id: "link:rocker:angle",
    label: "rocker · angle",
    stroke: "#C44E17",
    unitLabel: "deg",
  };
  return overrides ? overrides.map((o) => ({ ...base, ...o })) : [base];
}

beforeEach(() => {
  instances.length = 0;
  FakeResizeObserver.instances.length = 0;
  vi.stubGlobal("ResizeObserver", FakeResizeObserver);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("UPlotChart", () => {
  it("constructs once on mount with opts.series.length === 1 + ySeries.length and the initial data", () => {
    const data: [number[], number[]] = [
      [0, 1, 2],
      [10, 20, 30],
    ];
    render(
      <UPlotChart
        xLabel="input"
        series={series()}
        data={data}
        axisStroke="#000"
        gridStroke="#ccc"
        height={140}
      />,
    );

    expect(instances).toHaveLength(1);
    const instance = instances[0];
    const opts = instance.opts as { series: unknown[] };
    expect(opts.series).toHaveLength(2); // 1 x + 1 y
    expect(instance.data).toBe(data);
  });

  it("a new data prop with the same series config calls setData, without reconstructing", () => {
    const data1: [number[], number[]] = [
      [0, 1],
      [10, 20],
    ];
    const { rerender } = render(
      <UPlotChart
        xLabel="input"
        series={series()}
        data={data1}
        axisStroke="#000"
        gridStroke="#ccc"
        height={140}
      />,
    );
    expect(instances).toHaveLength(1);
    const instance = instances[0];

    const data2: [number[], number[]] = [
      [0, 1, 2],
      [10, 20, 30],
    ];
    rerender(
      <UPlotChart
        xLabel="input"
        series={series()}
        data={data2}
        axisStroke="#000"
        gridStroke="#ccc"
        height={140}
      />,
    );

    expect(instances).toHaveLength(1); // no reconstruct
    expect(instance.setData).toHaveBeenCalledTimes(1);
    expect(instance.setData).toHaveBeenCalledWith(data2);
    expect(instance.destroy).not.toHaveBeenCalled();
  });

  it("a changed series config (labels/colors) destroys the old instance and constructs a new one", () => {
    const data: [number[], number[]] = [
      [0, 1],
      [10, 20],
    ];
    const { rerender } = render(
      <UPlotChart
        xLabel="input"
        series={series()}
        data={data}
        axisStroke="#000"
        gridStroke="#ccc"
        height={140}
      />,
    );
    const first = instances[0];
    expect(instances).toHaveLength(1);

    rerender(
      <UPlotChart
        xLabel="input"
        series={series([{ stroke: "#2E7D4F" }])}
        data={data}
        axisStroke="#000"
        gridStroke="#ccc"
        height={140}
      />,
    );

    expect(first.destroy).toHaveBeenCalledTimes(1);
    expect(instances).toHaveLength(2);
  });

  it("a theme change (axisStroke/gridStroke) destroys and reconstructs", () => {
    const data: [number[], number[]] = [
      [0, 1],
      [10, 20],
    ];
    const { rerender } = render(
      <UPlotChart
        xLabel="input"
        series={series()}
        data={data}
        axisStroke="#000"
        gridStroke="#ccc"
        height={140}
      />,
    );
    const first = instances[0];

    rerender(
      <UPlotChart
        xLabel="input"
        series={series()}
        data={data}
        axisStroke="#fff"
        gridStroke="#333"
        height={140}
      />,
    );

    expect(first.destroy).toHaveBeenCalledTimes(1);
    expect(instances).toHaveLength(2);
  });

  it("a container resize (via the ResizeObserver stub) calls setSize", () => {
    const data: [number[], number[]] = [
      [0, 1],
      [10, 20],
    ];
    render(
      <UPlotChart
        xLabel="input"
        series={series()}
        data={data}
        axisStroke="#000"
        gridStroke="#ccc"
        height={140}
      />,
    );
    const instance = instances[0];
    expect(FakeResizeObserver.instances).toHaveLength(1);

    FakeResizeObserver.instances[0].trigger(400, 140);

    expect(instance.setSize).toHaveBeenCalledWith({ width: 400, height: 140 });
  });

  it("the imperative handle's setData works", () => {
    const data: [number[], number[]] = [
      [0, 1],
      [10, 20],
    ];
    const ref = createRef<UPlotChartHandle>();
    render(
      <UPlotChart
        ref={ref}
        xLabel="input"
        series={series()}
        data={data}
        axisStroke="#000"
        gridStroke="#ccc"
        height={140}
      />,
    );
    const instance = instances[0];
    const pushed: [number[], number[]] = [
      [0, 1, 2],
      [10, 20, 30],
    ];

    ref.current?.setData(pushed);

    expect(instance.setData).toHaveBeenCalledWith(pushed);
  });

  it("destroys the instance on unmount", () => {
    const data: [number[], number[]] = [
      [0, 1],
      [10, 20],
    ];
    const { unmount } = render(
      <UPlotChart
        xLabel="input"
        series={series()}
        data={data}
        axisStroke="#000"
        gridStroke="#ccc"
        height={140}
      />,
    );
    const instance = instances[0];

    unmount();

    expect(instance.destroy).toHaveBeenCalledTimes(1);
  });
});
