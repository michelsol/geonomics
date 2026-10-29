import { describe, expect, it } from "vitest";
import large from "../../../data/goods/large.json";
import medium from "../../../data/goods/medium.json";
import small from "../../../data/goods/small.json";
import { loadCatalog } from "./catalog";
import { createConfig } from "./config";
import { hashWorld } from "./hash";
import { generateMap } from "./mapgen";
import type { World } from "./types";

const catalogs = { small: loadCatalog(small), medium: loadCatalog(medium), large: loadCatalog(large) };
const generate = (name: keyof typeof catalogs, seed: number, landAreaCount = 300) =>
  generateMap(catalogs[name], createConfig(catalogs[name], { map: { landAreaCount } }), seed);

function reachable(world: World): number {
  const seen = new Uint8Array(world.areas.length);
  const stack = [0];
  seen[0] = 1;
  let count = 1;
  while (stack.length > 0) {
    const current = stack.pop() as number;
    for (const id of world.areas[current]?.edges ?? []) {
      const edge = world.edges[id];
      if (!edge?.isActive) continue;
      const other = edge.areaA === current ? edge.areaB : edge.areaA;
      if (!seen[other]) {
        seen[other] = 1;
        count++;
        stack.push(other);
      }
    }
  }
  return count;
}

describe("generateMap", () => {
  const { world, capitals } = generate("medium", 1);

  it("is deterministic: the same seed gives the same map, another seed another map", () => {
    expect(hashWorld(generate("medium", 1).world)).toBe(hashWorld(world));
    expect(hashWorld(generate("medium", 2).world)).not.toBe(hashWorld(world));
  });

  it("makes about the requested number of areas", () => {
    for (const count of [300, 1000]) {
      const areas = generate("small", 3, count).world.areas.length;
      expect(Math.abs(areas - count) / count).toBeLessThan(0.05);
    }
  });

  it("lets every area reach every other one", () => {
    for (const seed of [1, 2, 3, 4]) {
      const generated = generate("small", seed).world;
      expect(reachable(generated)).toBe(generated.areas.length);
    }
  });

  it("places every primary good of every catalog somewhere, and fish only at sea within a port's reach", () => {
    for (const name of ["small", "medium", "large"] as const) {
      const generated = generate(name, 5).world;
      const reach = generated.config.infrastructure.maximumLevel;
      for (const good of generated.goods.filter((g) => g.isPrimary)) {
        const holders = generated.areas.filter((area) => (area.naturalCapacity[good.id] as number) > 0);
        const waters = generated.waters.filter((water) => (water.naturalCapacity[good.id] as number) > 0);
        expect(holders.length + waters.length, `${name} ${good.key}`).toBeGreaterThan(0);
        if (good.key === "fish") {
          expect(holders).toHaveLength(0);
          expect(waters.length).toBeGreaterThan(0);
          expect(waters.every((water) => water.depth <= reach)).toBe(true);
        } else if (good.key === "crude_oil" || good.key === "natural_gas") {
          expect(waters.length, good.key).toBeGreaterThan(0);
          expect(waters.every((water) => water.depth >= 2 && water.depth <= reach)).toBe(true);
        } else expect(waters, good.key).toHaveLength(0);
      }
      for (const area of generated.areas) {
        expect(generated.goods.some((g) => g.isPrimary && (area.naturalCapacity[g.id] as number) > 0)).toBe(true);
      }
    }
  });

  it("links coastal areas by sea lanes, with no port, route or airport until realms are founded", () => {
    const coastal = world.areas.filter((area) => area.isCoastal);
    expect(coastal.length).toBeGreaterThan(0);
    const sea = world.edges.filter((edge) => edge.mode === "sea");
    expect(sea.length).toBeGreaterThan(0);
    for (const edge of sea) expect([edge.isLane, edge.capacityPerDay]).toEqual([true, 0]);
    expect(world.edges.some((edge) => edge.mode === "air")).toBe(false);
    for (const area of world.areas) expect([area.portLevel, area.airportLevel, area.roadLevel]).toEqual([0, 0, 0]);
  });

  it("builds consistent edges, positions and populations", () => {
    for (const [id, edge] of world.edges.entries()) {
      expect(edge.id).toBe(id);
      expect(world.areas[edge.areaA]?.edges).toContain(id);
      expect(world.areas[edge.areaB]?.edges).toContain(id);
      expect(edge.distance).toBeGreaterThan(0);
      expect(Number.isFinite(edge.baseTransportCost)).toBe(true);
    }
    const mean = world.areas.reduce((sum, area) => sum + area.population, 0) / world.areas.length;
    expect(mean).toBeCloseTo(world.config.map.meanAreaPopulation, 0);
    const radius = world.map?.radius as number;
    for (const area of world.areas) {
      expect(Math.hypot(area.position.x, area.position.y, area.position.z)).toBeCloseTo(radius, 6); // on the sphere
      expect(area.owner).toBeNull();
    }
    expect(world.waters.length).toBeGreaterThan(world.areas.length);
  });

  it("covers the rest of the sphere with water cells, each with its depth and neighbors", () => {
    const radius = world.map?.radius as number;
    const spacing = world.config.map.cellSpacing;
    // Land and water together cover the sphere, at about one cell per spacing squared.
    const cells = world.areas.length + world.waters.length;
    expect((cells * spacing * spacing) / (4 * Math.PI * radius * radius)).toBeCloseTo(1, 6);
    const touching = new Set<number>();
    for (const [id, water] of world.waters.entries()) {
      expect(water.id).toBe(id);
      expect(Math.hypot(water.position.x, water.position.y, water.position.z)).toBeCloseTo(radius, 6);
      for (const other of water.neighbors) expect(world.waters[other]?.neighbors).toContain(id);
      for (const area of water.coasts) expect(world.areas[area]?.isCoastal).toBe(true);
      if (water.coasts.length > 0) touching.add(id);
      expect(water.depth).toBe(
        water.coasts.length > 0
          ? 1
          : 1 + Math.min(...water.neighbors.map((other) => world.waters[other]?.depth as number)),
      );
    }
    // Every coastal area touches a water cell.
    const coasts = new Set(world.waters.flatMap((water) => water.coasts));
    expect(world.areas.filter((area) => area.isCoastal).every((area) => coasts.has(area.id))).toBe(true);
    expect(touching.size).toBeGreaterThan(0);
  });

  it("places distinct capitals", () => {
    expect(capitals).toHaveLength(world.config.map.governmentCount);
    expect(new Set(capitals).size).toBe(capitals.length);
  });
});
