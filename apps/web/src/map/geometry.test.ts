import { buildStaticData } from "@geonomics/sim";
import { describe, expect, it } from "vitest";
import { createGame } from "../host/createGame";
import { buildGeometry } from "./geometry";

describe("selection outlines", () => {
  const world = createGame(
    { catalog: "small", areas: 60, seed: 5, realms: 4, aiMix: "balanced", warmupDays: 0 },
    () => {},
  );
  const data = buildStaticData(world);
  const geometry = buildGeometry(data);
  const sides = (area: number) => ((geometry.cells[area] as number[]).length - 2) / 2;

  it("follow one area's cell all around", () => {
    expect(geometry.outline([0]).length / 4).toBe(sides(0));
  });

  it("leave out the sides between two selected areas", () => {
    const land = data.edges.find((edge) => edge.mode === "land") as (typeof data.edges)[number];
    const [a, b] = [land.areaA, land.areaB];
    const outline = geometry.outline([a, b]).length / 4;
    expect(outline).toBe(sides(a) + sides(b) - 2); // one shared side, counted in both cells
    expect(geometry.outline([])).toEqual([]);
  });
});
