import { describe, expect, it } from "vitest";
import { arrowWidth } from "./arrows";

describe("flow arrow widths", () => {
  it("scale width with the square root of the flow, from 1 to 6 px", () => {
    expect(arrowWidth(0, 100)).toBe(1);
    expect(arrowWidth(25, 100)).toBeCloseTo(3.5, 9);
    expect(arrowWidth(-100, 100)).toBe(6);
    expect(arrowWidth(500, 100)).toBe(6);
    expect(arrowWidth(5, 0)).toBe(1);
  });
});
