// Roadmap stage 3: the private economy runs on its own and converges (specification §4, Diagnostics).
import {
  createConfig,
  createWorld,
  hashWorld,
  initializeWorld,
  referenceDemandPerPerson,
  reserveDaysOf,
  runTick,
  type World,
  warmUp,
} from "@geonomics/sim";
import { describe, expect, it } from "vitest";
import { CATALOG_NAMES, readCatalog } from "./catalogs";
import { Recorder } from "./diagnostics";
import { scenarios } from "./scenarios";

function run(world: World, days: number, recorder = new Recorder(world)): Recorder {
  for (let i = 0; i < days; i++) {
    runTick(world);
    recorder.sample();
  }
  return recorder;
}

/**
 * For every good that flows across an edge, the price gap above transport cost as a share of the buyer's price.
 * At steady state a buyer imports its whole use at a gap of 1 / (reserveDays × tradeGapSensitivity).
 */
function excessGaps(world: World) {
  const gaps: { key: string; excess: number; bound: number }[] = [];
  for (const edge of world.edges) {
    const a = world.areas[edge.areaA] as World["areas"][number];
    const b = world.areas[edge.areaB] as World["areas"][number];
    for (const good of world.goods) {
      if (good.isService) continue;
      const g = good.id;
      for (const [direction, seller, buyer] of [
        [0, a, b],
        [1, b, a],
      ] as const) {
        const rate = edge.tradeFlowPerDay[2 * g + direction] as number;
        const used = (buyer.demanded[g] as number) + (buyer.inputDemanded[g] as number);
        if (rate < 0.01 * used) continue;
        const excess =
          ((buyer.price[g] as number) - (seller.price[g] as number) - edge.transportCost * good.transportWeight) /
          (buyer.price[g] as number);
        gaps.push({
          key: good.key,
          excess,
          bound:
            3 / (reserveDaysOf(good, world.config) * world.config.economy.tradeGapSensitivity) +
            world.config.economy.tradeMargin,
        });
      }
    }
  }
  return gaps;
}

describe.each(CATALOG_NAMES)("with the %s catalog", (catalog) => {
  it("two areas with complementary resources settle near transport cost within 60 days", () => {
    const world = scenarios.twoAreas.build({ catalog: readCatalog(catalog) });
    const recorder = run(world, 60);
    expect(recorder.report().worstVolatility).toBeLessThan(0.01);
    const gaps = excessGaps(world);
    expect(gaps.length).toBeGreaterThan(0);
    for (const gap of gaps) {
      expect(gap.excess, gap.key).toBeGreaterThan(-0.005);
      expect(gap.excess, gap.key).toBeLessThan(gap.bound);
    }
    // Supply chains take longer than prices to settle, most of all in the large catalog.
    expect(run(world, 340, recorder).report().unmetNecessities).toBeLessThan(0.005);
  });

  it("a 10-area chain settles along a smooth gradient within 200 days", () => {
    const world = scenarios.chain10.build({ catalog: readCatalog(catalog) });
    const recorder = run(world, 200);
    expect(recorder.report().worstVolatility).toBeLessThan(0.015);
    // Each primary good is richest at one end; its price rises steadily toward the other end, give or take the
    // friction (transport and trade margin) within which neighbors do not trade.
    for (const [k, good] of world.goods.filter((g) => g.isPrimary).entries()) {
      const prices = world.areas.map((area) => area.price[good.id] as number);
      if (k % 2 === 1) prices.reverse();
      const transport = (world.edges[0]?.transportCost as number) * good.transportWeight;
      for (let i = 1; i < prices.length; i++) {
        const friction = transport + world.config.economy.tradeMargin * (prices[i - 1] as number);
        expect(prices[i], good.key).toBeGreaterThanOrEqual((prices[i - 1] as number) - friction);
      }
    }
    expect(run(world, 200, recorder).report().unmetNecessities).toBeLessThan(0.01);
  });

  it("runs 5,000 days with no NaN or negative value", () => {
    const world = scenarios.chain10.build({ catalog: readCatalog(catalog) });
    const check = () => {
      for (const area of world.areas) {
        for (const value of [area.population, area.savings, area.unemployedWorkers, area.wageLevel]) {
          expect(Number.isFinite(value)).toBe(true);
          expect(value).toBeGreaterThanOrEqual(0);
        }
        for (const array of [area.stock, area.price, area.smoothedPrice, area.privateWorkers, area.naturalCapacity]) {
          for (const value of array) {
            expect(Number.isFinite(value)).toBe(true);
            expect(value).toBeGreaterThanOrEqual(0);
          }
        }
      }
    };
    for (let i = 0; i < 50; i++) {
      for (let j = 0; j < 100; j++) runTick(world);
      check();
    }
    expect(world.gameDay).toBe(5000);
  });
});

it("is deterministic: the same seed gives the same world bit for bit", () => {
  const catalog = readCatalog("medium");
  const build = (seed: number) => {
    const world = scenarios.grid100.build({ catalog, seed });
    for (let i = 0; i < 200; i++) runTick(world);
    return hashWorld(world);
  };
  expect(build(7)).toBe(build(7));
  expect(build(7)).not.toBe(build(8));
});

it("substitutes bread for fish when fish runs short, keeping food satisfaction", () => {
  const catalog = readCatalog("small");
  const config = createConfig(catalog);
  const probe = createWorld(catalog, config, {
    areas: [{ name: "probe", position: { x: 0, y: 0 }, population: 1 }],
    edges: [],
    seed: 1,
  });
  const perPerson = referenceDemandPerPerson(probe);
  const capacity = Object.fromEntries(
    catalog.goods.filter((g) => g.isPrimary).map((g) => [g.key, 3 * (perPerson[g.id] as number) * 10_000]),
  );
  const world = createWorld(catalog, config, {
    areas: [{ name: "Island", position: { x: 0, y: 0 }, population: 10_000, naturalCapacity: capacity }],
    edges: [],
    seed: 1,
  });
  initializeWorld(world);
  const area = world.areas[0] as World["areas"][number];
  const fish = catalog.goods.findIndex((g) => g.key === "fish");
  const bread = catalog.goods.findIndex((g) => g.key === "bread");
  const breadShare = () => {
    const fromBread = (area.consumed[bread] as number) * 1.3;
    return fromBread / (fromBread + (area.consumed[fish] as number) * 6);
  };

  run(world, 300);
  const before = breadShare();
  area.naturalCapacity[fish] = (area.naturalCapacity[fish] as number) * 0.1;
  area.naturalCapacityMaximum[fish] = (area.naturalCapacityMaximum[fish] as number) * 0.1;
  let lowest = 1;
  for (let i = 0; i < 300; i++) {
    runTick(world);
    lowest = Math.min(lowest, area.necessitySatisfaction);
  }
  expect(breadShare()).toBeGreaterThan(before + 0.1);
  expect(lowest).toBeGreaterThan(0.95);
});

it("drains savings above target through imports", () => {
  const catalog = readCatalog("small");
  const settled = () => {
    const world = scenarios.twoAreas.build({ catalog });
    warmUp(world);
    run(world, 200);
    return world;
  };
  const rich = settled();
  const baseline = settled();
  const area = rich.areas[0] as World["areas"][number];
  const start = area.savings;
  area.savings *= 4;
  const importValue = (world: World) =>
    world.goods.reduce(
      (sum, good) => sum + (world.areas[0]?.imported[good.id] as number) * (world.areas[0]?.price[good.id] as number),
      0,
    );
  let richImports = 0;
  let baselineImports = 0;
  for (let i = 0; i < 200; i++) {
    runTick(rich);
    runTick(baseline);
    richImports += importValue(rich);
    baselineImports += importValue(baseline);
  }
  expect(richImports).toBeGreaterThan(1.3 * baselineImports);
  expect(area.savings).toBeLessThan(3 * start);
});
