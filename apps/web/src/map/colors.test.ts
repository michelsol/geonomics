import { describe, expect, it } from "vitest";
import { POPULATION, populationColor } from "./colors";

describe("population colors", () => {
  const largest = 50_000;

  it("show every emptied area as the darkest color", () => {
    const darkest = POPULATION[0];
    for (const people of [0, 0.02, 3, largest / 100]) expect(populationColor(people, largest)).toBe(darkest);
  });

  it("span two decades below the largest area", () => {
    expect(populationColor(largest, largest)).toBe(POPULATION.at(-1));
    const middle = populationColor(largest / 10, largest);
    expect(middle).not.toBe(POPULATION[0]);
    expect(middle).not.toBe(POPULATION.at(-1));
    expect(populationColor(largest / 20, largest)).not.toBe(middle);
  });
});
