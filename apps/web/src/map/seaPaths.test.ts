import { describe, expect, it } from "vitest";
import { dashedPath, smooth, waterPath } from "./seaPaths";

// Two coastal areas, 0 at the left and 1 at the right, with an island area 2 between them. The water runs around the
// island: west (cells 0, 1), north (2, 3, 4) and east (5, 6); cell 7 sits on the straight line but is not water linked.
const areas = [
  { x: 0, y: 0 },
  { x: 40, y: 0 },
  { x: 20, y: 0 },
];
const waters = [
  { x: 6, y: 0, neighbors: [1], coasts: [0] },
  { x: 6, y: -10, neighbors: [0, 2], coasts: [] },
  { x: 12, y: -16, neighbors: [1, 3], coasts: [] },
  { x: 20, y: -16, neighbors: [2, 4], coasts: [] },
  { x: 28, y: -16, neighbors: [3, 5], coasts: [] },
  { x: 34, y: -10, neighbors: [4, 6], coasts: [] },
  { x: 34, y: 0, neighbors: [5], coasts: [1] },
  { x: 20, y: 0, neighbors: [], coasts: [] },
];
const shore = [[0], [6], []];
const data = { areas, waters } as unknown as Parameters<typeof waterPath>[0];

describe("sea route paths", () => {
  it("go around land by water, from one area's center to the other's", () => {
    const path = waterPath(data, shore, 0, 1) as number[];
    expect(path.slice(0, 2)).toEqual([0, 0]);
    expect(path.slice(-2)).toEqual([40, 0]);
    const ys = path.filter((_, i) => i % 2 === 1);
    expect(Math.min(...ys)).toBeLessThan(-10); // north of the island, not through it
  });

  it("are null without water cells or a water path", () => {
    expect(waterPath({ areas, waters: [] } as unknown as typeof data, [[], [], []], 0, 1)).toBeNull();
    expect(waterPath(data, shore, 0, 2)).toBeNull(); // the island has no shore cell here
  });

  it("smooth corners and keep both ends", () => {
    const smoothed = smooth([0, 0, 10, 0, 10, 10]);
    expect(smoothed.slice(0, 2)).toEqual([0, 0]);
    expect(smoothed.slice(-2)).toEqual([10, 10]);
    expect(smoothed.length).toBeGreaterThan(6);
  });

  it("dash a polyline with the pattern carried across its corners", () => {
    const dashes: [number, number, number, number][] = [];
    let start: [number, number] = [0, 0];
    const sink = {
      moveTo(x: number, y: number) {
        start = [x, y];
        return sink;
      },
      lineTo(x: number, y: number) {
        dashes.push([...start, x, y]);
        return sink;
      },
    };
    // An L of 15 + 15: dashes of 4 every 10, so 0–4, 10–14, 20–24 along the path.
    dashedPath(sink, [0, 0, 15, 0, 15, 15], 4, 6);
    const drawn = dashes.reduce((sum, [x1, y1, x2, y2]) => sum + Math.hypot(x2 - x1, y2 - y1), 0);
    expect(drawn).toBeCloseTo(12, 9);
    expect(dashes.at(-1)).toEqual([15, 5, 15, 9]); // the third dash, 20–24 along, lies on the second leg
  });

  it("finish on long paths whose corners fall just short of a dash's end", () => {
    // Long legs of awkward lengths once made rounding stall the dash pattern, freezing the page.
    const points: number[] = [];
    for (let i = 0; i <= 400; i++) points.push(i % 2 ? 1000 + i * Math.PI : 0, i * Math.SQRT2); // a zigzag
    let drawn = 0;
    let from = [0, 0];
    const sink = {
      moveTo(x: number, y: number) {
        from = [x, y];
        return sink;
      },
      lineTo(x: number, y: number) {
        drawn += Math.hypot(x - (from[0] as number), y - (from[1] as number));
        return sink;
      },
    };
    dashedPath(sink, points, 0.3, 0.3);
    let length = 0;
    for (let i = 0; i + 3 < points.length; i += 2)
      length += Math.hypot(
        (points[i + 2] as number) - (points[i] as number),
        (points[i + 3] as number) - (points[i + 1] as number),
      );
    expect(drawn / length).toBeCloseTo(0.5, 2);
  });
});
