import { buildStaticData } from "@geonomics/sim";
import { describe, expect, it } from "vitest";
import { createGame } from "../host/createGame";
import { buildGlobe } from "./globe";

describe("the globe's cells", () => {
  const world = createGame(
    { catalog: "small", areas: 60, seed: 5, realms: 4, aiMix: "balanced", warmupDays: 0 },
    () => {},
  );
  const data = buildStaticData(world);
  const globe = buildGlobe(data);
  const sides = (area: number) => globe.corners(area).length;

  it("cover every area and water cell with a fan of triangles on the sphere", () => {
    expect(globe.cellCount).toBe(data.areas.length + data.waters.length);
    for (let cell = 0; cell < globe.cellCount; cell++) {
      expect(globe.vertexCount[cell]).toBe(sides(cell) + 1);
      expect((globe.firstTriangle[cell + 1] as number) - (globe.firstTriangle[cell] as number)).toBe(sides(cell));
    }
    for (let i = 0; i < globe.positions.length; i += 3) {
      const r = Math.hypot(
        globe.positions[i] as number,
        globe.positions[i + 1] as number,
        globe.positions[i + 2] as number,
      );
      expect(r).toBeCloseTo(globe.radius, 0);
    }
  });

  it("outline one area's cell all around, and leave out the sides between two selected areas", () => {
    expect(globe.outline([0]).length / 6).toBe(sides(0));
    const land = data.edges.find((edge) => edge.mode === "land") as (typeof data.edges)[number];
    const [a, b] = [land.areaA, land.areaB];
    expect(globe.outline([a, b]).length / 6).toBe(sides(a) + sides(b) - 2); // one shared side, counted in both cells
    expect(globe.outline([])).toEqual([]);
  });

  it("pick the area under a point, and nothing over water", () => {
    for (const [id, area] of data.areas.entries()) expect(globe.pick(area)).toBe(id);
    expect(globe.pick(data.waters[0] as (typeof data.waters)[number])).toBeNull();
  });

  it("list each border between two areas, or an area and the sea", () => {
    for (const border of globe.borders) {
      expect(border.a).toBeLessThan(data.areas.length);
      expect(border.b).toBeLessThan(data.areas.length);
    }
    expect(globe.borders.some((border) => border.b < 0)).toBe(true); // coasts
  });
});
