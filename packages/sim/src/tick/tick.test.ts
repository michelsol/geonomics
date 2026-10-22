import { describe, expect, it } from "vitest";
import medium from "../../../../data/goods/medium.json";
import small from "../../../../data/goods/small.json";
import { type Catalog, loadCatalog } from "../catalog";
import { createConfig, type DeepPartial, type WorldConfig } from "../config";
import { initializeWorld, referenceDemandPerPerson } from "../init";
import type { World } from "../types";
import { type AreaSpec, createWorld } from "../world";
import { runConsumption } from "./consumption";
import { runPrices } from "./prices";
import { produceArea, runProduction } from "./production";
import { scratchOf } from "./scratch";
import { runTick } from "./tick";
import { runTrade } from "./trade";

const smallCatalog = loadCatalog(small);
const mediumCatalog = loadCatalog(medium);
const id = (catalog: Catalog, key: string) => catalog.goods.findIndex((good) => good.key === key);

/** Two neighbors 100 km apart; capacities are multiples of the reference demand of both areas together. */
function twoAreas(
  catalog: Catalog,
  capacities: [Record<string, number>, Record<string, number>],
  config?: DeepPartial<WorldConfig>,
): World {
  const probe = createWorld(catalog, createConfig(catalog), {
    areas: [{ name: "probe", position: { x: 0, y: 0 }, population: 1 }],
    edges: [],
    seed: 1,
  });
  const perPerson = referenceDemandPerPerson(probe);
  const toCapacity = (multiples: Record<string, number>) =>
    Object.fromEntries(
      Object.entries(multiples).map(([key, m]) => [key, m * (perPerson[id(catalog, key)] as number) * 20_000]),
    );
  const areas: AreaSpec[] = capacities.map((multiples, i) => ({
    name: `Area ${i}`,
    position: { x: i * 100, y: 0 },
    population: 10_000,
    naturalCapacity: toCapacity(multiples),
  }));
  const world = createWorld(catalog, createConfig(catalog, config), {
    areas,
    edges: [{ a: 0, b: 1, mode: "land" }],
    seed: 1,
  });
  initializeWorld(world);
  return world;
}

const everything = { grain: 2, fish: 2, ore: 2 };

describe("initializeWorld (Rule 6)", () => {
  const world = twoAreas(smallCatalog, [everything, everything]);
  const area = world.areas[0] as World["areas"][number];

  it("starts prices and smoothed prices at labor value", () => {
    for (const good of world.goods) {
      expect(area.price[good.id]).toBe(good.laborValue);
      expect(area.smoothedPrice[good.id]).toBe(good.laborValue);
    }
  });

  it("places workers to cover local demand and leaves the rest unemployed", () => {
    let employed = 0;
    for (const good of world.goods) employed += area.privateWorkers[good.id] as number;
    const workforce = area.population * world.config.economy.workforceShare;
    expect(employed + area.unemployedWorkers).toBeCloseTo(workforce, 6);
    // The calibration rule leaves roughly a quarter of the labor for government jobs and armies.
    expect(area.unemployedWorkers / workforce).toBeGreaterThan(0.15);
    expect(area.unemployedWorkers / workforce).toBeLessThan(0.35);
  });

  it("produces about what is demanded on the first tick", () => {
    runTick(world);
    for (const key of ["bread", "tools", "fish"]) {
      const g = id(smallCatalog, key);
      const used = (area.demanded[g] as number) + (area.inputDemanded[g] as number);
      expect((area.produced[g] as number) / used).toBeGreaterThan(0.9);
      expect((area.produced[g] as number) / used).toBeLessThan(1.1);
    }
  });
});

describe("production", () => {
  it("rations a scarce input between its users in proportion to their requests", () => {
    // Medium catalog: electricity feeds several recipes. Empty its stock and cut its production well below what
    // producers request.
    const world = twoAreas(mediumCatalog, [{ grain: 2, fish: 2, cotton: 2, timber: 2, coal: 2, iron_ore: 2 }, {}]);
    const area = world.areas[0] as World["areas"][number];
    const electricity = id(mediumCatalog, "electricity");
    area.stock[electricity] = 0;
    area.privateWorkers[electricity] = (area.privateWorkers[electricity] as number) / 50;
    const scratch = scratchOf(world);
    produceArea(world, area, scratch, true);
    const ration = scratch.ration[electricity] as number;
    expect(ration).toBeGreaterThan(0);
    expect(ration).toBeLessThan(0.5);
    // Every user drew the same share of its request, so the whole output went to producers.
    expect(ration * (area.inputDemanded[electricity] as number)).toBeCloseTo(area.produced[electricity] as number, 6);
    for (const good of mediumCatalog.goods) {
      if (!good.inputs.some((input) => input.good === electricity) || !(area.privateWorkers[good.id] as number))
        continue;
      expect(area.outputLimitedByInputs[good.id]).toBe(1);
    }
    expect(area.stock[electricity]).toBeGreaterThanOrEqual(0);
  });

  it("depletes natural capacity by extraction", () => {
    const world = twoAreas(smallCatalog, [everything, everything]);
    const area = world.areas[0] as World["areas"][number];
    const fish = id(smallCatalog, "fish");
    const before = area.naturalCapacity[fish] as number;
    runProduction(world);
    const extracted = area.produced[fish] as number;
    expect(area.naturalCapacity[fish]).toBeCloseTo(before - extracted * 0.005, 9);
  });
});

describe("consumption", () => {
  it("spills unmet need over to substitutes that still have stock", () => {
    const world = twoAreas(smallCatalog, [everything, everything]);
    const area = world.areas[0] as World["areas"][number];
    const bread = id(smallCatalog, "bread");
    const fish = id(smallCatalog, "fish");
    area.stock[bread] = 0;
    area.stock[fish] = 1e9;
    runConsumption(world);
    expect(area.consumed[bread]).toBe(0);
    expect(area.consumed[fish]).toBeGreaterThan(area.demanded[fish] as number);
    expect(area.necessitySatisfaction).toBeCloseTo(1, 9);
    // The scarce good keeps its demand, so its price pressure stays up.
    expect(area.demanded[bread]).toBeGreaterThan(0);
  });

  it("lowers necessity satisfaction when food runs out", () => {
    const world = twoAreas(smallCatalog, [everything, everything]);
    const area = world.areas[0] as World["areas"][number];
    area.stock[id(smallCatalog, "bread")] = 0;
    area.stock[id(smallCatalog, "fish")] = 0;
    runConsumption(world);
    expect(area.necessitySatisfaction).toBe(0);
    expect(area.satisfaction).toBeGreaterThan(0);
  });
});

describe("prices", () => {
  it("stay within the floor and ceiling multiples of labor value", () => {
    const world = twoAreas(smallCatalog, [everything, everything]);
    const area = world.areas[0] as World["areas"][number];
    for (let i = 0; i < 1000; i++) {
      area.stock.fill(0);
      runPrices(world);
    }
    for (const good of world.goods) expect(area.price[good.id]).toBeCloseTo(good.laborValue * 10, 9);
    for (let i = 0; i < 2000; i++) {
      area.stock.fill(1e12);
      runPrices(world);
    }
    for (const good of world.goods) expect(area.price[good.id]).toBeCloseTo(good.laborValue * 0.1, 9);
  });

  it("move at most maxPriceChangePerTick per tick", () => {
    const world = twoAreas(smallCatalog, [everything, everything]);
    const area = world.areas[0] as World["areas"][number];
    area.smoothedPrice.fill(1e6);
    const before = Float64Array.from(area.price);
    runPrices(world);
    for (const good of world.goods) {
      expect((area.price[good.id] as number) / (before[good.id] as number)).toBeLessThanOrEqual(1.1 + 1e-12);
    }
  });
});

describe("trade", () => {
  it("conserves goods and money between neutral areas", () => {
    // West has grain and ore, East has fish: each must import from the other.
    const world = twoAreas(smallCatalog, [{ grain: 2, ore: 2 }, { fish: 2 }]);
    const fish = id(smallCatalog, "fish");
    let fishImported = 0;
    for (let i = 0; i < 50; i++) {
      runTick(world);
      fishImported += world.areas[0]?.imported[fish] as number;
    }
    expect(fishImported).toBeGreaterThan(0);
    const stockBefore = world.goods.map((good) => world.areas.reduce((s, a) => s + (a.stock[good.id] as number), 0));
    const moneyBefore = world.areas.reduce((s, a) => s + a.savings, 0);
    runTrade(world);
    const moneyAfter = world.areas.reduce((s, a) => s + a.savings, 0);
    expect(moneyAfter).toBeCloseTo(moneyBefore, 3);
    for (const good of world.goods) {
      const after = world.areas.reduce((s, a) => s + (a.stock[good.id] as number), 0);
      expect(after).toBeCloseTo(stockBefore[good.id] as number, 6);
    }
    expect(world.areas[0]?.imported[fish]).toBeCloseTo(world.areas[1]?.exported[fish] as number, 9);
  });

  it("never sends goods against the price gap or across a blocked edge", () => {
    const world = twoAreas(smallCatalog, [{ grain: 2, ore: 2 }, { fish: 2 }]);
    for (let i = 0; i < 20; i++) runTick(world);
    (world.edges[0] as World["edges"][number]).isBlocked = true;
    runTrade(world);
    for (const area of world.areas) {
      expect(area.imported.every((v) => v === 0)).toBe(true);
      expect(area.exported.every((v) => v === 0)).toBe(true);
    }
  });

  it("stops at the buyer's savings", () => {
    const world = twoAreas(smallCatalog, [{ grain: 2, ore: 2 }, { fish: 2 }]);
    for (let i = 0; i < 20; i++) runTick(world);
    (world.areas[0] as World["areas"][number]).savings = 0;
    runTrade(world);
    expect(world.areas[0]?.imported.every((v) => v === 0)).toBe(true);
  });
});

describe("runTick", () => {
  it("keeps the workforce whole as population changes", () => {
    const world = twoAreas(smallCatalog, [{ grain: 2, ore: 2 }, { fish: 2 }]);
    for (let i = 0; i < 300; i++) runTick(world);
    for (const area of world.areas) {
      let employed = 0;
      for (const good of world.goods) employed += area.privateWorkers[good.id] as number;
      expect(employed + area.unemployedWorkers).toBeCloseTo(area.population * world.config.economy.workforceShare, 3);
    }
  });

  it("advances the clock by gameDaysPerTick", () => {
    const world = twoAreas(smallCatalog, [everything, everything], { pace: { gameDaysPerTick: 0.5 } });
    runTick(world);
    runTick(world);
    expect(world.tick).toBe(2);
    expect(world.gameDay).toBe(1);
  });
});
