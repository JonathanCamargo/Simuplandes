/**
 * A thin imperative uPlot wrapper (SIM-05): creates one `uPlot` instance
 * per (series config, theme) signature, pushes new `data` via `setData`
 * (never a reconstruct for a data-only change -- `PlotDock`'s time-mode
 * updates rely on this to push 60fps-ish history growth with zero React
 * re-render), tracks its own container size via `ResizeObserver` ->
 * `setSize`, and destroys the instance on unmount or on a series/theme
 * change. The x scale is always numeric (`time: false`) -- plotted x values
 * are either a sweep input (degrees/length units) or simulated seconds,
 * never a wall-clock date.
 */

import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import uPlot from "uplot";
import "uplot/dist/uPlot.min.css";

/** One y-series to plot alongside the shared x column. */
export interface UPlotSeriesSpec {
  readonly id: string;
  readonly label: string;
  readonly stroke: string;
  readonly unitLabel: string;
}

/** The imperative handle exposed via `ref`. */
export interface UPlotChartHandle {
  setData(data: uPlot.AlignedData): void;
}

export interface UPlotChartProps {
  readonly xLabel: string;
  readonly series: readonly UPlotSeriesSpec[];
  readonly data: uPlot.AlignedData;
  readonly axisStroke: string;
  readonly gridStroke: string;
  readonly height: number;
}

/** A signature capturing every input that requires destroying and rebuilding the uPlot instance (series identity/labels/colors, the theme's axis/grid colors, and the x-axis label). A data-only change never appears here -- it goes through `setData` instead. */
function seriesSignature(props: {
  series: readonly UPlotSeriesSpec[];
  axisStroke: string;
  gridStroke: string;
  xLabel: string;
}): string {
  return JSON.stringify({
    series: props.series.map((s) => [s.id, s.label, s.stroke, s.unitLabel]),
    axisStroke: props.axisStroke,
    gridStroke: props.gridStroke,
    xLabel: props.xLabel,
  });
}

export const UPlotChart = forwardRef<UPlotChartHandle, UPlotChartProps>(function UPlotChart(
  { xLabel, series, data, axisStroke, gridStroke, height },
  ref,
) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const plotRef = useRef<uPlot | null>(null);
  // Set right after a (re)construction, so the sibling data-effect (which
  // always fires on the same commit as a fresh mount) skips its otherwise
  // redundant `setData` call -- the constructor already received the
  // current `data`.
  const justConstructedRef = useRef(false);

  const signature = seriesSignature({ series, axisStroke, gridStroke, xLabel });

  useImperativeHandle(
    ref,
    () => ({
      setData(nextData: uPlot.AlignedData) {
        plotRef.current?.setData(nextData);
      },
    }),
    [],
  );

  // Reconstruct only when the series/theme/x-label signature changes -- a
  // data-only change is handled by the effect below via `setData`.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return undefined;

    const width = container.clientWidth || 1;
    const opts: uPlot.Options = {
      width,
      height,
      series: [
        { label: xLabel },
        ...series.map((s) => ({
          label: `${s.label} [${s.unitLabel}]`,
          stroke: s.stroke,
          width: 2,
        })),
      ],
      scales: { x: { time: false } },
      axes: [
        { stroke: axisStroke, grid: { stroke: gridStroke } },
        { stroke: axisStroke, grid: { stroke: gridStroke } },
      ],
      legend: { show: series.length > 0 },
    };

    const plot = new uPlot(opts, data, container);
    plotRef.current = plot;
    justConstructedRef.current = true;

    return () => {
      plot.destroy();
      plotRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on `signature` (which already captures series/theme/xLabel content) plus `height`; `data` is deliberately excluded (a data-only change goes through `setData` below, never a reconstruct), and the raw `series`/`xLabel`/`axisStroke`/`gridStroke` params are deliberately excluded too (a new-but-equal array/object reference on every render must NOT force a reconstruct -- only `signature`'s content-based comparison should).
  }, [signature, height]);

  useEffect(() => {
    if (justConstructedRef.current) {
      justConstructedRef.current = false;
      return;
    }
    plotRef.current?.setData(data);
  }, [data]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return undefined;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      const { width, height: observedHeight } = entry.contentRect;
      if (width <= 0) return;
      plotRef.current?.setSize({ width, height: observedHeight || height });
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, [height]);

  return <div ref={containerRef} style={{ width: "100%", height }} />;
});
