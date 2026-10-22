import { describe, expect, it } from "vitest";
import small from "../../../../data/goods/small.json";
import { loadCatalog } from "../catalog";
import { createConfig } from "../config";
import type { World } from "../types";
import { type AreaSpec, createWorld, type EdgeSpec } from "../world";
import { advanceInfrastructure, rebuildAirRoutes } from "./infrastructure";
import { runPopulation } from "./population";

const catalog = loadCatalog(small);

/** Areas on a 100 km grid; the airport levels given switch airports on. */
function airportWorld(levels: number[], edges: EdgeSpec[] = []): World {
  const areas: AreaSpec[] = levels.map((airportLevel, i) => ({
    name: `A${i}`,
    position: { x: (i % 4) * 100, y: Math.floor(i / 4) * 100 },
    population: 1000,
    airportLevel,
  }));
  return createWorld(catalog, createConfig(catalog), { areas, edges, seed: 1 });
}

const airPairs = (world: World) =>
  world.edges
    .filter((edge) => edge.mode === "air")
    .map((edge) => ({ id: edge.id, pair: `${edge.areaA}-${edge.areaB}`, active: edge.isActive }));

describe("rebuildAirRoutes", () => {
  it("links every airport to its nearest airports", () => {
    const world = airportWorld([1, 1, 1, 1, 1, 1, 1, 1]);
    rebuildAirRoutes(world);
    for (const area of world.areas) {
      const routes = area.edges.map((id) => world.edges[id]).filter((edge) => edge?.mode === "air" && edge.isActive);
      expect(routes.length).toBeGreaterThanOrEqual(world.config.transport.airRoutesPerAirport);
    }
    for (const edge of world.edges) {
      expect(edge.travelDays).toBe(Number.POSITIVE_INFINITY);
      expect(edge.capacityPerDay).toBe(world.config.transport.airCapacityPerAirportLevel);
    }
  });

  it("keeps edge ids stable: dropped routes are deactivated, then reactivated", () => {
    const world = airportWorld([1, 1, 1, 1, 1, 1, 1, 1], [{ a: 0, b: 1, mode: "land" }]);
    rebuildAirRoutes(world);
    const first = airPairs(world);
    expect(first.every((route) => route.active)).toBe(true);

    const closed = world.areas[5] as World["areas"][number];
    closed.airportLevel = 0;
    rebuildAirRoutes(world);
    const second = airPairs(world);
    expect(second.slice(0, first.length).map((r) => r.pair)).toEqual(first.map((r) => r.pair));
    expect(second.slice(0, first.length).map((r) => r.id)).toEqual(first.map((r) => r.id));
    for (const route of second) {
      const touchesClosed = route.pair.split("-").map(Number).includes(5);
      if (touchesClosed) expect(route.active).toBe(false);
    }

    closed.airportLevel = 1;
    rebuildAirRoutes(world);
    const third = airPairs(world);
    expect(third.length).toBe(second.length); // reactivated, not duplicated
    expect(third.map((route) => route.id)).toEqual(second.map((route) => route.id));
    for (const route of first) expect(third.find((r) => r.id === route.id)?.active).toBe(true);
    expect(world.edges[0]?.mode).toBe("land");
  });

  it("links hubs at the maximum level to each other", () => {
    const world = airportWorld([3, 1, 1, 1, 1, 1, 1, 3]);
    rebuildAirRoutes(world);
    expect(airPairs(world).some((route) => route.pair === "0-7" && route.active)).toBe(true);
  });
});

describe("advanceInfrastructure", () => {
  it("turns port work into levels and raises sea route capacity", () => {
    const areas: AreaSpec[] = [0, 1].map((i) => ({
      name: `Port ${i}`,
      position: { x: i * 500, y: 0 },
      isCoastal: true,
      portLevel: 1,
    }));
    const world = createWorld(catalog, createConfig(catalog), {
      areas,
      edges: [{ a: 0, b: 1, mode: "sea" }],
      seed: 1,
    });
    const edge = world.edges[0] as World["edges"][number];
    const { seaCapacityPerPortLevel, portWorkerDaysPerLevel, maximumPortLevel } = world.config.transport;
    expect(edge.capacityPerDay).toBe(seaCapacityPerPortLevel);
    for (const area of world.areas) area.portProgress = 10 * portWorkerDaysPerLevel;
    advanceInfrastructure(world);
    expect(world.areas.map((area) => area.portLevel)).toEqual([maximumPortLevel, maximumPortLevel]);
    expect(edge.capacityPerDay).toBe(seaCapacityPerPortLevel * maximumPortLevel);
    expect(edge.distance).toBe(500);
    expect(edge.baseTransportCost).toBeCloseTo(world.config.transport.seaCostPerDistance * 500, 12);
  });

  it("opens air routes when an airport reaches its first level", () => {
    const world = airportWorld([1, 1, 0, 0]);
    rebuildAirRoutes(world);
    expect(airPairs(world)).toHaveLength(1);
    const opening = world.areas[3] as World["areas"][number];
    opening.airportProgress = world.config.transport.airportWorkerDaysPerLevel;
    advanceInfrastructure(world);
    expect(opening.airportLevel).toBe(1);
    expect(airPairs(world).filter((route) => route.pair.endsWith("-3"))).toHaveLength(2);
  });
});

describe("migration", () => {
  it("is scaled by the mode of the edge", () => {
    const migrants = (mode: "land" | "sea" | "air") => {
      const areas: AreaSpec[] = [0, 1].map((i) => ({
        name: `M${i}`,
        position: { x: i * 100, y: 0 },
        population: 10_000,
        isCoastal: true,
        portLevel: 1,
        airportLevel: 1,
      }));
      const world = createWorld(catalog, createConfig(catalog), { areas, edges: [{ a: 0, b: 1, mode }], seed: 1 });
      for (const area of world.areas) area.necessitySatisfaction = 0.9; // no growth, no starvation
      (world.areas[0] as World["areas"][number]).satisfaction = 0.5;
      (world.areas[1] as World["areas"][number]).satisfaction = 1;
      runPopulation(world);
      return (world.areas[1]?.population as number) - 10_000;
    };
    const land = migrants("land");
    expect(land).toBeGreaterThan(0);
    expect(migrants("sea") / land).toBeCloseTo(0.5, 9);
    expect(migrants("air") / land).toBeCloseTo(0.25, 9);
  });
});
