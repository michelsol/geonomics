// Governments act on the economy through commands (specification §5).
import { type Command, createGovernment, hashWorld, runTick, type World, warmUp } from "@geonomics/sim";
import { describe, expect, it } from "vitest";
import { readCatalog } from "./catalogs";
import { Recorder } from "./diagnostics";
import { scenarios } from "./scenarios";

const PLAYER = "tester";
const small = readCatalog("small");
const goodId = (world: World, key: string) => world.goods.findIndex((good) => good.key === key);

/** twoAreas after warm-up, with a government owning the West area. */
function governedTwoAreas(): World {
  const world = scenarios.twoAreas.build({ catalog: small });
  warmUp(world);
  createGovernment(world, { capital: 0, controller: { kind: "human", player: PLAYER } });
  return world;
}

function command(world: World, ...commands: Command[]): void {
  const rejections = runTick(
    world,
    commands.map((c) => ({ player: PLAYER, government: 0, command: c })),
  );
  expect(rejections).toEqual([]);
}

/** Value of the goods an area imported over `days`, at its own prices. */
function importValue(world: World, area: number, days: number): number {
  let value = 0;
  for (let i = 0; i < days; i++) {
    runTick(world);
    const a = world.areas[area] as World["areas"][number];
    for (const good of world.goods) value += (a.imported[good.id] as number) * (a.price[good.id] as number);
  }
  return value;
}

describe("taxes", () => {
  it("drain savings and imports when nothing is spent", () => {
    const control = governedTwoAreas();
    const taxed = governedTwoAreas();
    command(taxed, {
      type: "setRealmPolicy",
      setting: { policy: "headTaxPerPersonPerDay", good: null, value: 1 },
    });
    for (let i = 0; i < 150; i++) {
      runTick(control);
      runTick(taxed);
    }
    const west = (world: World) => world.areas[0] as World["areas"][number];
    expect(west(taxed).savings).toBeLessThan(0.5 * west(control).savings);
    expect(importValue(taxed, 0, 30)).toBeLessThan(0.85 * importValue(control, 0, 30));
    expect(taxed.governments[0]?.treasury).toBeGreaterThan(control.governments[0]?.treasury as number);
  });
});

describe("market orders", () => {
  it("make buying in a glut and selling in a famine profitable", () => {
    const world = governedTwoAreas();
    const grain = goodId(world, "grain");
    const west = world.areas[0] as World["areas"][number];
    const capacity = west.naturalCapacityMaximum[grain] as number;
    const treasury = world.governments[0]?.treasury as number;
    const setCapacity = (multiple: number) => {
      west.naturalCapacity[grain] = capacity * multiple;
      west.naturalCapacityMaximum[grain] = capacity * multiple;
    };

    // A glut: grain gets cheap and the government stockpiles it.
    setCapacity(3);
    for (let i = 0; i < 60; i++) runTick(world);
    const glutPrice = west.price[grain] as number;
    const daily = west.produced[grain] as number;
    command(world, {
      type: "placeMarketOrder",
      order: {
        area: 0,
        good: grain,
        side: "buy",
        remainingQuantity: 30 * daily,
        limitPrice: glutPrice * 1.05,
        maximumQuantityPerDay: 0.3 * daily,
      },
    });
    for (let i = 0; i < 60; i++) runTick(world);
    const bought = world.governments[0]?.areaStates.get(0)?.depot[grain] as number;
    expect(bought).toBeGreaterThan(5 * daily);

    // A famine: grain gets dear and the government sells its stock back.
    command(world, { type: "cancelMarketOrder", orderId: world.governments[0]?.marketOrders[0]?.id as number });
    setCapacity(0.4);
    for (let i = 0; i < 100; i++) runTick(world);
    const faminePrice = west.price[grain] as number;
    expect(faminePrice).toBeGreaterThan(1.2 * glutPrice);
    command(world, {
      type: "placeMarketOrder",
      order: {
        area: 0,
        good: grain,
        side: "sell",
        remainingQuantity: bought,
        limitPrice: 1.2 * glutPrice, // well above what the grain cost
        maximumQuantityPerDay: 0.3 * daily,
      },
    });
    for (let i = 0; i < 120; i++) runTick(world);
    expect(world.governments[0]?.areaStates.get(0)?.depot[grain]).toBeLessThan(0.1 * bought);
    expect(world.governments[0]?.treasury).toBeGreaterThan(treasury);
  });
});

describe("founding on a generated map", () => {
  it("gives every capital a disjoint realm and leaves the economy stable", () => {
    const world = scenarios.map.build({ catalog: small, config: { map: { landAreaCount: 300 } } });
    expect(world.governments).toHaveLength(world.config.map.governmentCount);
    const owners = new Map<number, number>();
    for (const government of world.governments) {
      expect(government.ownedAreas).toContain(government.capital);
      expect(government.treasury).toBeGreaterThan(0);
      for (const area of government.ownedAreas) {
        expect(owners.has(area)).toBe(false);
        owners.set(area, government.id);
        expect(world.areas[area]?.owner).toBe(government.id);
      }
    }
    warmUp(world);
    const recorder = new Recorder(world);
    for (let i = 0; i < 30; i++) {
      runTick(world);
      recorder.sample();
    }
    expect(recorder.report().unmetNecessities).toBeLessThan(0.06);
  }, 60_000);
});

describe("determinism", () => {
  it("replays the same commands to the same world", () => {
    const run = () => {
      const world = governedTwoAreas();
      const grain = goodId(world, "grain");
      command(
        world,
        { type: "setRealmPolicy", setting: { policy: "consumptionTaxRate", good: grain, value: 0.1 } },
        { type: "setWageOffer", area: 0, wageOffer: 2 },
        { type: "setInfrastructureTarget", area: 0, kind: "roads", level: 2 },
        {
          type: "addStandingOrder",
          order: {
            areas: "all",
            rule: { kind: "keepDepotStock", good: grain, targetDaysOfDemand: 3, maximumBuyPrice: 10 },
          },
        },
      );
      for (let i = 0; i < 50; i++) runTick(world);
      return hashWorld(world);
    };
    expect(run()).toBe(run());
  });
});
