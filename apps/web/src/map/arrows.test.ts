import { describe, expect, it } from "vitest";
import { arrowPolygon, arrowWidth } from "./arrows";

const points = (flat: number[]) => Array.from({ length: flat.length / 2 }, (_, i) => [flat[2 * i], flat[2 * i + 1]]);

describe("flow arrows", () => {
  it("run from 20% to 80% of the segment, tip toward the destination", () => {
    const polygon = arrowPolygon(0, 0, 100, 0, 2, 0, 1) as number[];
    const xs = points(polygon).map(([x]) => x as number);
    expect(Math.min(...xs)).toBeCloseTo(20, 9);
    expect(Math.max(...xs)).toBeCloseTo(80, 9);
    expect(points(polygon)[3]).toEqual([80, 0]); // the tip
    const reversed = arrowPolygon(100, 0, 0, 0, 2, 0, 1) as number[];
    expect(points(reversed)[3]).toEqual([20, 0]);
  });

  it("shift to the right of travel, so opposite flows on one edge stay apart", () => {
    // Heading east on a y-down screen, the right is +y; heading west, it is -y.
    const east = points(arrowPolygon(0, 0, 100, 0, 2, 3, 1) as number[]);
    const west = points(arrowPolygon(100, 0, 0, 0, 2, 3, 1) as number[]);
    expect(east[3]?.[1]).toBeCloseTo(3, 9);
    expect(west[3]?.[1]).toBeCloseTo(-3, 9);
  });

  it("keep the shaft width and a head at least as wide", () => {
    const polygon = points(arrowPolygon(0, 0, 100, 0, 4, 0, 1) as number[]);
    expect((polygon[6]?.[1] as number) - (polygon[0]?.[1] as number)).toBeCloseTo(4, 9);
    expect((polygon[4]?.[1] as number) - (polygon[2]?.[1] as number)).toBeGreaterThanOrEqual(8);
  });

  it("skip segments too short to hold an arrow", () => {
    expect(arrowPolygon(0, 0, 20, 0, 1, 0, 1)).toBeNull(); // 12 px of span
    expect(arrowPolygon(0, 0, 20, 0, 1, 0, 0.5)).not.toBeNull(); // zoomed in twice: 24 px
  });

  it("scale width with the square root of the flow, from 1 to 6 px", () => {
    expect(arrowWidth(0, 100)).toBe(1);
    expect(arrowWidth(25, 100)).toBeCloseTo(3.5, 9);
    expect(arrowWidth(-100, 100)).toBe(6);
    expect(arrowWidth(500, 100)).toBe(6);
    expect(arrowWidth(5, 0)).toBe(1);
  });
});
