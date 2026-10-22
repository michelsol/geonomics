// A uPlot line chart that follows its container's width and redraws when its data changes.
import { useEffect, useRef } from "react";
import uPlot from "uplot";
import "uplot/dist/uPlot.min.css";
import { fmt } from "./components";

export interface ChartSeries {
  label: string;
  color: string;
  values: number[];
  dash?: number[];
}

/** One axis only: measures of different scales go in separate charts. */
export function Chart({
  x,
  series,
  testId,
  height = 180,
}: {
  x: number[];
  series: ChartSeries[];
  testId?: string;
  height?: number;
}) {
  const host = useRef<HTMLDivElement>(null);
  const plot = useRef<uPlot | null>(null);
  const shape = series.map((s) => s.label).join("|");

  // The chart is rebuilt only when its series change, not on every new sample.
  // biome-ignore lint/correctness/useExhaustiveDependencies: series are read once per shape; data updates below
  useEffect(() => {
    const element = host.current;
    if (!element) return;
    const axis = { stroke: "#8e9aab", grid: { stroke: "#2b3646" }, ticks: { stroke: "#2b3646" } };
    plot.current = new uPlot(
      {
        width: element.clientWidth || 300,
        height,
        legend: { show: series.length > 1 },
        cursor: { drag: { x: false, y: false } },
        scales: {
          x: { time: false },
          // A flat series (an idle treasury) gets a band around its value instead of a range down to zero.
          y: {
            range: (_: uPlot, min: number, max: number) =>
              min === max
                ? [min - Math.max(1, Math.abs(min) * 0.1), max + Math.max(1, Math.abs(max) * 0.1)]
                : uPlot.rangeNum(min, max, 0.1, true),
          },
        },
        axes: [
          height < 160 ? { ...axis, size: 28 } : { ...axis, label: "day" },
          { ...axis, size: 52, values: (_: uPlot, splits: number[]) => splits.map((v) => fmt(v)) },
        ],
        series: [{ label: "day" }, ...series.map((s) => ({ label: s.label, stroke: s.color, width: 2, dash: s.dash }))],
      },
      [[], ...series.map(() => [])],
      element,
    );
    const observer = new ResizeObserver(() => plot.current?.setSize({ width: element.clientWidth, height }));
    observer.observe(element);
    return () => {
      observer.disconnect();
      plot.current?.destroy();
      plot.current = null;
    };
  }, [shape, height]);

  useEffect(() => {
    plot.current?.setData([x, ...series.map((s) => s.values)] as uPlot.AlignedData);
  });

  return <div ref={host} className="chart" data-testid={testId} />;
}
