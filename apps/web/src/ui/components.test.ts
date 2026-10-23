import { describe, expect, it } from "vitest";
import { count, fmt } from "./components";

describe("fmt", () => {
  it("keeps at most two decimals below 100, without trailing zeros", () => {
    expect(fmt(0.137)).toBe("0.14");
    expect(fmt(20.64)).toBe("20.64");
    expect(fmt(3.1)).toBe("3.1");
    expect(fmt(3)).toBe("3");
    expect(fmt(99.994)).toBe("99.99");
    expect(fmt(-1.256)).toBe("-1.26");
    expect(fmt(0)).toBe("0");
  });

  it("shows traces as below a hundredth rather than zero", () => {
    expect(fmt(0.004)).toBe("<0.01");
    expect(fmt(-0.004)).toBe(">-0.01");
    expect(fmt(0.005)).toBe("0.01");
  });

  it("drops decimals from 100 and goes compact from 10,000", () => {
    expect(fmt(100)).toBe("100");
    expect(fmt(4383.2)).toBe("4383");
    expect(fmt(9999.4)).toBe("9999");
    expect(fmt(10_000)).toBe("10k");
    expect(fmt(24_312)).toBe("24.3k");
    expect(fmt(123_456)).toBe("123k");
    expect(fmt(1_234_567)).toBe("1.23M");
    expect(fmt(4_500_000_000)).toBe("4.5B");
    expect(fmt(-24_312)).toBe("-24.3k");
    expect(fmt(999_999)).toBe("1M");
    // Whole numbers keep their zeros: only zeros after the point go.
    expect(fmt(100_000)).toBe("100k");
    expect(fmt(500_000)).toBe("500k");
    expect(fmt(120_000_000)).toBe("120M");
  });

  it("names infinite and missing values", () => {
    expect(fmt(Number.POSITIVE_INFINITY)).toBe("∞");
    expect(fmt(Number.NaN)).toBe("—");
  });
});

describe("count", () => {
  it("shows whole numbers, grouped, below a million", () => {
    expect(count(29.7)).toBe("30");
    expect(count(2605.4)).toBe("2,605");
    expect(count(24_312.8)).toBe("24,313");
    expect(count(999_999.2)).toBe("999,999");
    for (const value of [0.4, 12.5, 4321.9, 87_654.3]) expect(count(value)).not.toContain(".");
  });

  it("goes compact from a million", () => {
    expect(count(1_234_567)).toBe("1.23M");
    expect(count(12_345_678)).toBe("12.3M");
  });
});
