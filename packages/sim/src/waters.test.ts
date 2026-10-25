import { describe, expect, it } from "vitest";
import { createConfig } from "./config";
import { setLevel } from "./infrastructure";
import { initializeWorld } from "./init";
import { goodId, smallCatalog } from "./testing";
import { runDecay } from "./tick/decay";
import { runProduction } from "./tick/production";
import type { World } from "./types";
import { depleteExtraction, extractionCapacity, extractionCapacityMaximum, waterReach, waterReachOf } from "./waters";
import { createWorld } from "./world";

// Five water cells in a line, 0 to 4; area 0 touches cell 0 and area 1 touches cell 4.
const line = [
  { neighbors: [1], coasts: [0] },
  { neighbors: [0, 2], coasts: [] },
  { neighbors: [1, 3], coasts: [] },
  { neighbors: [2, 4], coasts: [] },
  { neighbors: [3], coasts: [1] },
];
const cells = (reach: ReturnType<typeof waterReach>, area: number) => reach[area]?.map((r) => r.water);

describe("waterReach", () => {
  it("reaches the water cells within as many hops of the coast as the port's level", () => {
    expect(cells(waterReach(line, [1, 0]), 0)).toEqual([0]);
    expect(cells(waterReach(line, [2, 0]), 0)).toEqual([0, 1]);
    expect(cells(waterReach(line, [3, 0]), 0)).toEqual([0, 1, 2]);
    expect(cells(waterReach(line, [0, 0]), 0)).toEqual([]);
  });

  it("shares a cell two ports reach equally between them", () => {
    const reach = waterReach(line, [3, 3]);
    expect(reach[0]).toEqual([
      { water: 0, share: 1 },
      { water: 1, share: 1 },
      { water: 2, share: 0.5 },
    ]);
    expect(reach[1]?.find((r) => r.water === 2)?.share).toBe(0.5);
  });
});

/** A port area touching cell 0 of three water cells in a line, with fish in each, and an inland area. */
function harborWorld(): World {
  const world = createWorld(smallCatalog, createConfig(smallCatalog), {
    areas: [
      { name: "Harbor", position: { x: 0, y: 0 }, population: 10_000, isCoastal: true, portLevel: 1 },
      { name: "Inland", position: { x: 100, y: 0 }, population: 10_000, naturalCapacity: { grain: 500 } },
    ],
    edges: [{ a: 0, b: 1, mode: "land" }],
    waters: [
      { position: { x: -100, y: 0 }, coasts: [0], neighbors: [1], naturalCapacity: { fish: 1000 } },
      { position: { x: -200, y: 0 }, coasts: [], neighbors: [0, 2], naturalCapacity: { fish: 2000 } },
      { position: { x: -300, y: 0 }, coasts: [], neighbors: [1], naturalCapacity: { fish: 4000 } },
    ],
    seed: 1,
  });
  initializeWorld(world);
  (world.areas[0] as World["areas"][number]).staffing[0] = 1; // a fully staffed port
  return world;
}

describe("extraction at sea", () => {
  it("gives a port area the capacity of the cells it reaches, at its staffed share", () => {
    const world = harborWorld();
    const fish = goodId(world, "fish");
    const harbor = world.areas[0] as World["areas"][number];
    expect(world.waters.map((water) => water.depth)).toEqual([1, 2, 3]);
    expect(extractionCapacity(world, harbor, fish)).toBeCloseTo(1000, 9);
    setLevel(harbor, "port", 2);
    expect(extractionCapacity(world, harbor, fish)).toBeCloseTo(3000, 9);
    harbor.staffing[0] = 0.5;
    expect(extractionCapacity(world, harbor, fish)).toBeCloseTo(1500, 9);
    expect(extractionCapacityMaximum(world, harbor, fish)).toBeCloseTo(3000, 9);
    harbor.staffing[0] = 0;
    expect(extractionCapacity(world, harbor, fish)).toBe(0);
    setLevel(harbor, "port", 0);
    expect(waterReachOf(world)[0]).toEqual([]);
    expect(extractionCapacityMaximum(world, harbor, fish)).toBe(0);
  });

  it("catches fish at sea, depleting the cells in proportion to what they bring, and lets them recover", () => {
    const world = harborWorld();
    const fish = goodId(world, "fish");
    const harbor = world.areas[0] as World["areas"][number];
    setLevel(harbor, "port", 2);
    harbor.privateWorkers[fish] = 500;
    runProduction(world);
    expect(harbor.produced[fish]).toBeGreaterThan(0);
    const [first, second, third] = world.waters as [
      World["waters"][number],
      World["waters"][number],
      World["waters"][number],
    ];
    const lost = [1000 - (first.naturalCapacity[fish] as number), 2000 - (second.naturalCapacity[fish] as number)];
    expect(lost[0]).toBeGreaterThan(0);
    expect((lost[1] as number) / (lost[0] as number)).toBeCloseTo(2, 6); // cell 1 brings twice the capacity
    expect(third.naturalCapacity[fish]).toBe(4000); // out of reach
    expect(world.areas[1]?.produced[fish]).toBe(0); // inland
    const before = first.naturalCapacity[fish] as number;
    runDecay(world);
    expect(first.naturalCapacity[fish]).toBeGreaterThan(before);
  });

  it("splits a loss between land and sea by the capacity each brings", () => {
    const world = harborWorld();
    const fish = goodId(world, "fish");
    const harbor = world.areas[0] as World["areas"][number];
    harbor.naturalCapacity[fish] = 1000;
    depleteExtraction(world, harbor, fish, 100);
    expect(harbor.naturalCapacity[fish]).toBeCloseTo(950, 9);
    expect(world.waters[0]?.naturalCapacity[fish]).toBeCloseTo(950, 9);
  });
});
