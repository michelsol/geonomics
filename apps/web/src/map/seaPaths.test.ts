import { describe, expect, it } from "vitest";
import { smooth, waterPath } from "./seaPaths";

// Two coastal areas, 0 at the left and 1 at the right, with an island area 2 between them. The water runs around the
// island: west (cells 0, 1), north (2, 3, 4) and east (5, 6); cell 7 sits on the straight line but is not water linked.
const areas = [
  { x: 0, y: 0, z: 0 },
  { x: 40, y: 0, z: 0 },
  { x: 20, y: 0, z: 0 },
];
const waters = [
  { x: 6, y: 0, z: 0, neighbors: [1], coasts: [0] },
  { x: 6, y: -10, z: 0, neighbors: [0, 2], coasts: [] },
  { x: 12, y: -16, z: 0, neighbors: [1, 3], coasts: [] },
  { x: 20, y: -16, z: 0, neighbors: [2, 4], coasts: [] },
  { x: 28, y: -16, z: 0, neighbors: [3, 5], coasts: [] },
  { x: 34, y: -10, z: 0, neighbors: [4, 6], coasts: [] },
  { x: 34, y: 0, z: 0, neighbors: [5], coasts: [1] },
  { x: 20, y: 0, z: 0, neighbors: [], coasts: [] },
];
const shore = [[0], [6], []];
const data = { areas, waters } as unknown as Parameters<typeof waterPath>[0];

describe("sea route paths", () => {
  it("go around land by water, from one area's center to the other's", () => {
    const path = waterPath(data, shore, 0, 1) as number[];
    expect(path.slice(0, 3)).toEqual([0, 0, 0]);
    expect(path.slice(-3)).toEqual([40, 0, 0]);
    const ys = path.filter((_, i) => i % 3 === 1);
    expect(Math.min(...ys)).toBeLessThan(-10); // north of the island, not through it
  });

  it("are null without water cells or a water path", () => {
    expect(waterPath({ areas, waters: [] } as unknown as typeof data, [[], [], []], 0, 1)).toBeNull();
    expect(waterPath(data, shore, 0, 2)).toBeNull(); // the island has no shore cell here
  });

  it("smooth corners and keep both ends", () => {
    const smoothed = smooth([0, 0, 0, 10, 0, 0, 10, 10, 0]);
    expect(smoothed.slice(0, 3)).toEqual([0, 0, 0]);
    expect(smoothed.slice(-3)).toEqual([10, 10, 0]);
    expect(smoothed.length).toBeGreaterThan(9);
    expect(smoothed.length % 3).toBe(0);
  });
});
