// A uPlot line chart that follows its container's width and redraws when its data changes.
import { useEffect, useRef } from "react";
import uPlot from "uplot";
import "uplot/dist/uPlot.min.css";
import { fmt } from "./components";

export interface ChartSeries {
  label: string;
  scale?: "y" | "y2"; // y2 plots on a second axis on the right
  color: string;
  values: number[];
  dash?: number[];
}

const HEIGHT = 180;

export function Chart({ x, series, testId }: { x: number[]; series: ChartSeries[]; testId?: string }) {
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
        height: HEIGHT,
        legend: { show: true },
        cursor: { drag: { x: false, y: false } },
        scales: { x: { time: false } },
        axes: [
          { ...axis, label: "day" },
          { ...axis, size: 52, values: (_: uPlot, splits: number[]) => splits.map((v) => fmt(v, 2)) },
          ...(series.some((s) => s.scale === "y2")
            ? [
                {
                  ...axis,
                  scale: "y2",
                  side: 1,
                  size: 52,
                  grid: { show: false },
                  values: (_: uPlot, splits: number[]) => splits.map((v) => fmt(v, 2)),
                },
              ]
            : []),
        ],
        series: [
          { label: "day" },
          ...series.map((s) => ({ label: s.label, stroke: s.color, width: 1.5, dash: s.dash, scale: s.scale ?? "y" })),
        ],
      },
      [[], ...series.map(() => [])],
      element,
    );
    const observer = new ResizeObserver(() => plot.current?.setSize({ width: element.clientWidth, height: HEIGHT }));
    observer.observe(element);
    return () => {
      observer.disconnect();
      plot.current?.destroy();
      plot.current = null;
    };
  }, [shape]);

  useEffect(() => {
    plot.current?.setData([x, ...series.map((s) => s.values)] as uPlot.AlignedData);
  });

  return <div ref={host} className="chart" data-testid={testId} />;
}
