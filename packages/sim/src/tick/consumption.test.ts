import { describe, expect, it } from "vitest";
import { WAGE_BAND_COUNT, wageBandOf } from "../bands";
import { goodId, realmWorld, send } from "../testing";
import type { Area, World } from "../types";
import { planDemand, runConsumption } from "./consumption";
import { laborTargets, wageBands } from "./labor";
import { runPopulation } from "./population";
import { runProduction } from "./production";
import { scratchOf } from "./scratch";
import { runTick } from "./tick";

const areaOf = (world: World, id: number) => world.areas[id] as Area;

/** Area 1 of the test realm with everyone out of work, so only the unemployed buy. */
function idleWorld(unemployedWageShare: number): { world: World; area: Area } {
  const world = realmWorld({ economy: { unemployedWageShare } });
  const area = areaOf(world, 1);
  area.privateWorkers.fill(0);
  area.unemployedWorkers = area.population * world.config.economy.workforceShare;
  return { world, area };
}

const bought = (world: World, area: Area, key: string) => area.demanded[goodId(world, key)] as number;

describe("wage bands", () => {
  it("sort hourly wages at the boundaries, under 0.5, 0.5 to 1, 1 to 2 and over 2 man-hours", () => {
    expect([0, 0.49, 0.5, 0.99, 1, 1.99, 2, 7].map(wageBandOf)).toEqual([0, 0, 1, 1, 2, 2, 3, 3]);
  });

  it("hold every paid worker of an area, each in the band of their wage", () => {
    const world = realmWorld();
    runProduction(world);
    const area = areaOf(world, 1);
    const scratch = scratchOf(world);
    wageBands(world, area, scratch);
    const start = area.id * WAGE_BAND_COUNT;
    const workers = scratch.bandWorkers.subarray(start, start + WAGE_BAND_COUNT).reduce((sum, w) => sum + w, 0);
    const state = world.governments[0]?.areaStates.get(area.id);
    const staff = state ? state.staff.reduce((sum, s) => sum + s, 0) : 0;
    const privateWorkers = area.privateWorkers.reduce((sum, w) => sum + w, 0);
    expect(workers).toBeCloseTo(privateWorkers + staff, 6);
    for (const good of world.goods) {
      if ((area.privateWorkers[good.id] as number) <= 0) continue;
      const band = wageBandOf(Math.max(scratch.jobWages[good.id] as number, 0));
      expect(scratch.bandWorkers[start + band]).toBeGreaterThanOrEqual(area.privateWorkers[good.id] as number);
    }
  });
});

describe("buying from one's own income", () => {
  it("leaves the unemployed buying nothing without income, and counts what they wanted as unmet", () => {
    const { world, area } = idleWorld(0);
    runConsumption(world);
    for (const good of world.goods) expect(area.demanded[good.id]).toBe(0);
    expect(area.needDemanded.every((wanted) => wanted > 0)).toBe(true);
    expect(area.necessitySatisfaction).toBe(0);
  });

  it("spends a small budget on necessities first", () => {
    const { world, area } = idleWorld(0.02);
    planDemand(world, area, scratchOf(world));
    expect(bought(world, area, "bread") + bought(world, area, "fish")).toBeGreaterThan(0);
    expect(bought(world, area, "tools")).toBe(0); // the comfort comes after food, and the money ran out
  });

  it("buys more with a benefit, and less with a head tax or a consumption tax on food", () => {
    const food = (world: World, area: Area) => {
      planDemand(world, area, scratchOf(world));
      return bought(world, area, "bread") + bought(world, area, "fish");
    };
    const base = idleWorld(0.02);
    const without = food(base.world, base.area);
    const benefit = idleWorld(0.02);
    send(benefit.world, { type: "setRealmPolicy", setting: { policy: "unemployedTaxPerDay", good: null, value: -1 } });
    expect(food(benefit.world, benefit.area)).toBeGreaterThan(without);
    const headTax = idleWorld(0.02);
    send(headTax.world, {
      type: "setRealmPolicy",
      setting: { policy: "headTaxPerPersonPerDay", good: null, value: 0.01 },
    });
    expect(food(headTax.world, headTax.area)).toBeLessThan(without);
    const taxed = idleWorld(0.02);
    for (const key of ["bread", "fish"]) {
      const good = goodId(taxed.world, key);
      send(taxed.world, { type: "setRealmPolicy", setting: { policy: "consumptionTaxRate", good, value: 0.5 } });
    }
    expect(food(taxed.world, taxed.area)).toBeLessThan(without);
  });

  it("taxes a band's income, so a high income tax leaves its workers buying less", () => {
    const comforts = (world: World) => {
      runProduction(world);
      planDemand(world, areaOf(world, 1), scratchOf(world));
      return bought(world, areaOf(world, 1), "tools");
    };
    const untaxed = comforts(realmWorld());
    const taxed = realmWorld();
    send(taxed, { type: "setRealmPolicy", setting: { policy: "incomeTaxRate", good: null, value: 0.9 } });
    expect(comforts(taxed)).toBeLessThan(untaxed);
  });
});

describe("the reservation wage", () => {
  it("rises with the benefit for the unemployed, so fewer take the jobs", () => {
    const unemployedTarget = (benefit: number) => {
      const world = realmWorld();
      runTick(world); // the trade phase records what each good is used for
      if (benefit > 0)
        send(world, {
          type: "setRealmPolicy",
          setting: { policy: "unemployedTaxPerDay", good: null, value: -benefit },
        });
      const area = areaOf(world, 1);
      const scratch = scratchOf(world);
      wageBands(world, area, scratch);
      let available = area.unemployedWorkers;
      for (const good of world.goods) available += area.privateWorkers[good.id] as number;
      return laborTargets(world, area, scratch, scratch.jobWages, available, new Float64Array(world.goods.length));
    };
    expect(unemployedTarget(8)).toBeGreaterThan(unemployedTarget(0));
  });
});

describe("population", () => {
  it("is born at a fixed rate and starves with the necessities not met, settling where the two match", () => {
    const flows = (satisfaction: number) => {
      const world = realmWorld();
      for (const area of world.areas) area.necessitySatisfaction = satisfaction;
      const before = world.areas[1]?.population as number;
      runPopulation(world);
      const scratch = scratchOf(world);
      return {
        births: scratch.births[1] as number,
        starvation: scratch.starvation[1] as number,
        change: (world.areas[1]?.population as number) - before,
        before,
      };
    };
    const { growthRatePerDay, starvationRatePerDay } = realmWorld().config.population;
    const days = realmWorld().config.pace.gameDaysPerTick;
    const settled = 1 - growthRatePerDay / starvationRatePerDay;
    const full = flows(1);
    expect(full.births).toBeCloseTo(full.before * growthRatePerDay * days, 3);
    expect(full.starvation).toBeCloseTo(0, 6);
    expect(flows(settled).change).toBeCloseTo(0, 6);
    const short = flows(settled / 2);
    expect(short.change).toBeLessThan(0);
    expect(short.births).toBeCloseTo(full.births, 2);
    expect(short.births - short.starvation).toBeCloseTo(short.change, 6);
  });
});
