import { describe, expect, it } from "vitest";
import small from "../../../../data/goods/small.json";
import { loadCatalog } from "../catalog";
import { applyCommand } from "../commands";
import { createConfig } from "../config";
import { foundGovernments, transferArea } from "../government";
import { initializeWorld } from "../init";
import { generateMap } from "../mapgen";
import { realmWorld, send, smallCatalog } from "../testing";
import type { GovernmentAreaState, World } from "../types";
import { type AreaSpec, createWorld, type EdgeSpec } from "../world";
import { runHiring } from "./hiring";
import {
  rebuildAirRoutes,
  rebuildSeaRoutes,
  runConstruction,
  updateInfrastructureEffects,
  updateStaffing,
} from "./infrastructure";
import { runPopulation } from "./population";
import { scratchOf } from "./scratch";
import { runTaxes } from "./taxes";

const catalog = loadCatalog(small);

/** Areas on a 100 km grid; the airport levels given switch airports on. */
function airportWorld(levels: number[], edges: EdgeSpec[] = []): World {
  const areas: AreaSpec[] = levels.map((airportLevel, i) => ({
    name: `A${i}`,
    position: { x: (i % 4) * 100, y: Math.floor(i / 4) * 100 },
    population: 1000,
    airportLevel,
  }));
  const world = createWorld(catalog, createConfig(catalog), { areas, edges, seed: 1 });
  for (const area of world.areas) area.staffing.fill(1); // no government here: every airport runs as if staffed
  return world;
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

type Area = World["areas"][number];
const stateOf = (world: World, area: number, government = 0) =>
  world.governments[government]?.areaStates.get(area) as GovernmentAreaState;

describe("construction (phase 10)", () => {
  it("builds a level after its build days, paid into the area's savings as it goes", () => {
    const world = realmWorld();
    const valley = world.areas[1] as Area;
    const { costPerLevel, buildDaysPerLevel } = world.config.infrastructure;
    send(world, { type: "setInfrastructureTarget", area: 1, kind: "fort", level: 1 });
    const scratch = scratchOf(world);
    scratch.taxDue.fill(0);
    scratch.paymentDue.fill(0);
    const savings = valley.savings;
    runTaxes(world);
    expect(valley.savings - savings).toBeCloseTo(costPerLevel.fort / buildDaysPerLevel.fort, 6);
    for (let day = 1; day < buildDaysPerLevel.fort; day++) runConstruction(world);
    expect(valley.fortificationLevel).toBe(0);
    runConstruction(world);
    expect(valley.fortificationLevel).toBe(1);
    expect(stateOf(world, 1).buildDays[3]).toBe(0);
  });

  it("builds slower when the treasury cannot pay in full, and costs more per level", () => {
    const world = realmWorld();
    const valley = world.areas[1] as Area;
    const { buildDaysPerLevel } = world.config.infrastructure;
    send(world, { type: "setInfrastructureTarget", area: 1, kind: "roads", level: 2 });
    scratchOf(world).paidShare[0] = 0.5;
    for (let day = 0; day < buildDaysPerLevel.roads; day++) runConstruction(world);
    expect(valley.roadLevel).toBe(0);
    for (let day = 0; day < buildDaysPerLevel.roads; day++) runConstruction(world);
    expect(valley.roadLevel).toBe(1);
    expect(stateOf(world, 1).buildDays[2]).toBe(0); // the second level starts from nothing
  });
});

describe("staff", () => {
  it("fill the quota at the default wage, and leave when paid less than private jobs", () => {
    const world = realmWorld();
    const valley = world.areas[1] as Area;
    valley.fortificationLevel = 1;
    const quota = world.config.infrastructure.staffPerLevel.fort;
    for (let day = 0; day < 60; day++) runHiring(world);
    expect(stateOf(world, 1).staff[3]).toBeGreaterThan(0.99 * quota);
    expect(valley.staffing[3]).toBeGreaterThan(0.99);
    send(world, { type: "setAreaPolicy", area: 1, setting: { policy: "staffWageShare", good: null, value: 0.8 } });
    runHiring(world);
    expect(stateOf(world, 1).staff[3]).toBeLessThan(0.99 * quota);
  });

  it("run infrastructure at their staffed share: sea capacity, road costs and defense", () => {
    const world = realmWorld();
    const harbor = world.areas[0] as Area;
    const valley = world.areas[1] as Area;
    const { seaCapacityPerPortLevel } = world.config.transport;
    const { staffPerLevel, minimumTransportCostFactor } = world.config.infrastructure;
    stateOf(world, 0).staff[0] = staffPerLevel.port / 2;
    updateStaffing(world, harbor, stateOf(world, 0));
    valley.roadLevel = 3;
    stateOf(world, 1).staff[2] = 3 * staffPerLevel.roads;
    updateStaffing(world, valley, stateOf(world, 1));
    updateInfrastructureEffects(world);
    const sea = world.edges[2] as World["edges"][number];
    expect(sea.capacityPerDay).toBeCloseTo(seaCapacityPerPortLevel / 2, 9);
    const road = world.edges[0] as World["edges"][number];
    // Harbor has no roads, the Valley runs the maximum: half the way to the floor.
    expect(road.transportCost / road.baseTransportCost).toBeCloseTo(1 - (1 - minimumTransportCostFactor) / 2, 12);
  });

  it("are released when the area is captured, and the infrastructure stands idle", () => {
    const world = realmWorld();
    const harbor = world.areas[0] as Area;
    const staff = stateOf(world, 0).staff.reduce((sum, s) => sum + s, 0);
    expect(staff).toBeGreaterThan(0);
    const unemployed = harbor.unemployedWorkers;
    transferArea(world, harbor, 1);
    expect(harbor.unemployedWorkers).toBeCloseTo(unemployed + staff, 6);
    expect(harbor.portLevel).toBe(1);
    expect(Array.from(stateOf(world, 0, 1).targetLevel)).toEqual([1, 1, 0, 0]);
    expect((world.edges[2] as World["edges"][number]).capacityPerDay).toBe(0);
  });
});

describe("starting infrastructure", () => {
  it("gives a quarter of coasts a port, every landmass one, each capital an airport, all staffed", () => {
    const config = createConfig(smallCatalog, { map: { landAreaCount: 300, governmentCount: 6 } });
    const { world, capitals } = generateMap(smallCatalog, config, 5);
    initializeWorld(world);
    foundGovernments(world, capitals);
    const coastal = world.areas.filter((area) => area.isCoastal).length;
    const ports = world.areas.filter((area) => area.portLevel > 0);
    // A quarter by chance, plus the ports of landmasses that would otherwise have none.
    expect(ports.length).toBeGreaterThan(0.15 * coastal);
    expect(ports.length).toBeLessThan(0.4 * coastal);
    for (const government of world.governments) {
      const capital = world.areas[government.capital as number] as Area;
      expect(capital.airportLevel).toBe(1);
      expect(capital.staffing[1]).toBeCloseTo(1, 9);
    }
    expect(world.areas.filter((area) => area.airportLevel > 0)).toHaveLength(world.governments.length);
    for (const area of ports) expect(area.staffing[0]).toBeCloseTo(1, 9);
    // Sea routes join the ports along the lanes, and carry goods; the lanes carry nothing.
    const routes = world.edges.filter((edge) => edge.mode === "sea" && !edge.isLane && edge.isActive);
    expect(routes.length).toBeGreaterThanOrEqual(ports.length / 2);
    for (const route of routes) {
      expect(world.areas[route.areaA]?.portLevel).toBeGreaterThan(0);
      expect(world.areas[route.areaB]?.portLevel).toBeGreaterThan(0);
      expect(route.capacityPerDay).toBeCloseTo(world.config.transport.seaCapacityPerPortLevel, 6);
    }
    for (const lane of world.edges.filter((edge) => edge.isLane)) expect(lane.capacityPerDay).toBe(0);

    // A port taken down closes its routes; built again, they reopen with the same ids.
    const port = ports[0] as Area;
    const owner = world.governments[port.owner as number] as World["governments"][number];
    const own = (route: World["edges"][number]) => route.areaA === port.id || route.areaB === port.id;
    const before = routes.filter(own).map((route) => route.id);
    expect(before.length).toBeGreaterThan(0);
    owner.controller = { kind: "human", player: "p" };
    const order = (level: number) =>
      applyCommand(world, {
        player: "p",
        government: owner.id,
        command: { type: "setInfrastructureTarget", area: port.id, kind: "port", level },
      });
    expect(order(0)).toBeNull();
    for (const id of before) expect(world.edges[id]?.isActive).toBe(false);
    port.portLevel = 1;
    rebuildSeaRoutes(world);
    for (const id of before) expect(world.edges[id]?.isActive).toBe(true);
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
      for (const area of world.areas) area.staffing.fill(1); // the route runs
      updateInfrastructureEffects(world);
      world.config.population.growthRatePerDay = 0; // migration only
      world.config.population.starvationRatePerDay = 0;
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

  it("does not cross a route that does not run", () => {
    const areas: AreaSpec[] = [0, 1].map((i) => ({
      name: `M${i}`,
      position: { x: i * 100, y: 0 },
      population: 10_000,
      isCoastal: true,
    }));
    const world = createWorld(catalog, createConfig(catalog), { areas, edges: [{ a: 0, b: 1, mode: "sea" }], seed: 1 });
    world.config.population.growthRatePerDay = 0; // migration only
    world.config.population.starvationRatePerDay = 0;
    (world.areas[0] as World["areas"][number]).satisfaction = 0.5;
    runPopulation(world);
    expect(world.areas[1]?.population).toBe(10_000);
  });
});
