import { describe, expect, it } from "vitest";
import { reserveDaysOf } from "../math";
import { goodId, realmWorld, send, totalMoney } from "../testing";
import type { GovernmentAreaState, JobAssignment, World } from "../types";
import { runHiring } from "./hiring";
import { advanceInfrastructure } from "./infrastructure";
import { buildInfrastructure, runJobs } from "./jobs";
import { evaluateStandingOrders, runMarket } from "./market";
import { hourlyOutputPerWorker, runProduction } from "./production";
import { privateUsedPerTick, scratchOf } from "./scratch";
import { runTaxes } from "./taxes";
import { runTick } from "./tick";

type Area = World["areas"][number];
const stateOf = (world: World, area: number, government = 0) =>
  world.governments[government]?.areaStates.get(area) as GovernmentAreaState;
const government = (world: World, id = 0) => world.governments[id] as World["governments"][number];
const areaOf = (world: World, id: number) => world.areas[id] as Area;
const governmentWorkers = (state: GovernmentAreaState) => state.jobs.reduce((sum, job) => sum + job.workers, 0);

describe("market orders (phase 2)", () => {
  it("buys only stock above the reserve, paced per day, moving goods and money", () => {
    const world = realmWorld();
    const area = areaOf(world, 0);
    const grain = goodId(world, "grain");
    const reserve = (reserveDaysOf(world.goods[grain] as never, world.config) * privateUsedPerTick(area, grain)) / 1;
    area.stock[grain] = reserve + 500;
    const price = area.price[grain] as number;
    const treasury = government(world).treasury;
    const savings = area.savings;
    send(world, {
      type: "placeMarketOrder",
      order: {
        area: 0,
        good: grain,
        side: "buy",
        remainingQuantity: 1000,
        limitPrice: price,
        maximumQuantityPerDay: 300,
      },
    });
    runMarket(world);
    expect(stateOf(world, 0).depot[grain]).toBeCloseTo(300, 9);
    expect(government(world).treasury).toBeCloseTo(treasury - 300 * price, 6);
    expect(area.savings).toBeCloseTo(savings + 300 * price, 6);
    runMarket(world);
    expect(stateOf(world, 0).depot[grain]).toBeCloseTo(500, 9); // stopped at the reserve
    expect(government(world).marketOrders[0]?.remainingQuantity).toBeCloseTo(500, 9);
    area.price[grain] = price * 1.01;
    area.stock[grain] = reserve + 500;
    runMarket(world);
    expect(stateOf(world, 0).depot[grain]).toBeCloseTo(500, 9); // above the limit price
  });

  it("sells from the depot as far as the inhabitants can pay, then completes", () => {
    const world = realmWorld();
    const area = areaOf(world, 1);
    const grain = goodId(world, "grain");
    const price = area.price[grain] as number;
    stateOf(world, 1).depot[grain] = 100;
    area.savings = 30 * price;
    send(world, {
      type: "placeMarketOrder",
      order: { area: 1, good: grain, side: "sell", remainingQuantity: 80, limitPrice: 0, maximumQuantityPerDay: 1000 },
    });
    runMarket(world);
    expect(stateOf(world, 1).depot[grain]).toBeCloseTo(70, 9);
    area.savings = 1e9;
    runMarket(world);
    expect(stateOf(world, 1).depot[grain]).toBeCloseTo(20, 9);
    expect(government(world).marketOrders).toHaveLength(0);
  });

  it("delivers a depot transfer after the summed travel days, spoiled on the way", () => {
    const world = realmWorld();
    const bread = goodId(world, "bread");
    stateOf(world, 1).depot[bread] = 50;
    expect(send(world, { type: "transferGoods", from: 1, to: 2, good: bread, quantity: 50 })).toBeNull();
    const days = government(world).depotTransfers[0]?.daysRemaining as number;
    expect(days).toBe(9); // 4 days over land, 5 by sea
    for (let i = 0; i < days - 1; i++) runTick(world);
    expect(stateOf(world, 2).depot[bread]).toBe(0);
    runTick(world);
    const spoilage = world.goods[bread]?.spoilageRatePerDay as number;
    expect(stateOf(world, 2).depot[bread]).toBeCloseTo(50 * Math.exp(-spoilage * days), 6);
    expect(government(world).depotTransfers).toHaveLength(0);
  });

  it("standing orders keep a depot stocked from the market", () => {
    const world = realmWorld();
    const grain = goodId(world, "grain");
    send(world, {
      type: "addStandingOrder",
      order: { areas: [1], rule: { kind: "keepDepotStock", good: grain, targetDaysOfDemand: 3, maximumBuyPrice: 100 } },
    });
    for (let i = 0; i < 150; i++) runTick(world);
    const target = (3 * privateUsedPerTick(areaOf(world, 1), grain)) / world.config.pace.gameDaysPerTick;
    expect(stateOf(world, 1).depot[grain]).toBeGreaterThan(0.8 * target);
    expect(stateOf(world, 1).depot[grain]).toBeLessThan(1.1 * target);
  });

  it("paces standing trades by their own size when nobody else uses the good", () => {
    const world = realmWorld();
    const tools = goodId(world, "tools");
    const area = areaOf(world, 1);
    for (const flow of [area.demanded, area.consumed, area.inputDemanded, area.produced]) flow[tools] = 0;
    send(world, {
      type: "addStandingOrder",
      order: { areas: [1], rule: { kind: "buyBelowPrice", good: tools, maximumPrice: 100, maximumDepotQuantity: 50 } },
    });
    evaluateStandingOrders(world);
    const [trade] = scratchOf(world).standingTrades;
    expect(trade).toMatchObject({ area: 1, good: tools, side: "buy", quantity: 50 });
    expect(trade?.maximumQuantityPerDay).toBeCloseTo(50 * world.config.government.standingOrderShareOfDemandPerDay, 12);
  });
});

describe("policies", () => {
  it("apply a setting for every good before the settings for one good, realm first, then area", () => {
    const world = realmWorld();
    const [grain, tools] = [goodId(world, "grain"), goodId(world, "tools")];
    const set = (good: number | null, value: number, area?: number) =>
      send(
        world,
        area === undefined
          ? { type: "setRealmPolicy", setting: { policy: "productionTaxRate", good, value } }
          : { type: "setAreaPolicy", area, setting: { policy: "productionTaxRate", good, value } },
      );
    expect(set(grain, 0.3)).toBeNull();
    expect(set(null, 0.1)).toBeNull(); // sent after, yet the grain rate stays more specific
    expect(set(null, 0.2, 1)).toBeNull();
    expect(set(tools, 0.05, 1)).toBeNull();
    const rates = (area: number) => Array.from(stateOf(world, area).resolvedPolicies.productionTaxRate);
    expect(rates(0)[grain]).toBeCloseTo(0.3, 12);
    expect(rates(0)[tools]).toBeCloseTo(0.1, 12);
    // The area's setting for every good overrides the realm's, even the realm's setting for grain.
    expect(rates(1)[grain]).toBeCloseTo(0.2, 12);
    expect(rates(1)[tools]).toBeCloseTo(0.05, 12);
    expect(send(world, { type: "setRealmPolicy", setting: { policy: "priceFloor", good: 99, value: 1 } })).toMatch(
      /unknown good/,
    );
  });
});

describe("taxes, subsidies and wages (phase 5)", () => {
  it("collects head tax from savings into the treasury", () => {
    const world = realmWorld();
    send(world, { type: "setRealmPolicy", setting: { policy: "headTaxPerPersonPerDay", good: null, value: 0.1 } });
    const treasury = government(world).treasury;
    scratchOf(world);
    runTaxes(world);
    expect(government(world).treasury).toBeCloseTo(treasury + 3 * 0.1 * 10_000, 6);
  });

  it("takes what savings cannot pay in kind, most valuable goods first", () => {
    const world = realmWorld();
    send(world, {
      type: "setAreaPolicy",
      area: 1,
      setting: { policy: "headTaxPerPersonPerDay", good: null, value: 0.1 },
    });
    const area = areaOf(world, 1);
    area.savings = 0;
    const tools = goodId(world, "tools");
    const toolsStock = area.stock[tools] as number;
    runTaxes(world);
    const due = 0.1 * area.population;
    const mostValuable = world.goods.reduce((best, good) =>
      (area.price[good.id] as number) > (area.price[best.id] as number) ? good : best,
    );
    expect(mostValuable.id).toBe(tools);
    expect(stateOf(world, 1).depot[tools]).toBeCloseTo(Math.min(toolsStock, due / (area.price[tools] as number)), 9);
    let collected = 0;
    for (const good of world.goods)
      collected += (stateOf(world, 1).depot[good.id] as number) * (area.price[good.id] as number);
    expect(collected).toBeCloseTo(due, 6);
  });

  it("scales wages down together when the treasury runs short", () => {
    const world = realmWorld();
    for (const id of [0, 1])
      stateOf(world, id).jobs.push({ job: { kind: "research" }, targetWorkers: 100, workers: 100 });
    const bill = 2 * 100 * world.config.economy.hoursPerWorkerDay;
    government(world).treasury = bill / 4;
    const savings = [areaOf(world, 0).savings, areaOf(world, 1).savings];
    runTaxes(world);
    expect(government(world).treasury).toBeCloseTo(0, 9);
    expect(areaOf(world, 0).savings - (savings[0] as number)).toBeCloseTo(bill / 8, 9);
    expect(scratchOf(world).paidShare[0]).toBeCloseTo(0.25, 12);
  });

  it("pays production subsidies and collects production taxes", () => {
    const world = realmWorld();
    const grain = goodId(world, "grain");
    send(world, { type: "setAreaPolicy", area: 0, setting: { policy: "productionTaxRate", good: grain, value: -0.5 } });
    send(world, { type: "setAreaPolicy", area: 1, setting: { policy: "productionTaxRate", good: grain, value: 0.5 } });
    const before = [areaOf(world, 0).savings, areaOf(world, 1).savings];
    runProduction(world);
    const subsidy = 0.5 * (areaOf(world, 0).produced[grain] as number) * (areaOf(world, 0).price[grain] as number);
    const tax = 0.5 * (areaOf(world, 1).produced[grain] as number) * (areaOf(world, 1).price[grain] as number);
    runTaxes(world);
    expect(areaOf(world, 0).savings - (before[0] as number)).toBeCloseTo(subsidy, 6);
    expect((before[1] as number) - areaOf(world, 1).savings).toBeCloseTo(tax, 6);
  });
});

describe("hiring, quitting and firing (phase 7)", () => {
  it("hires from the unemployed when the wage beats private jobs, and fires instantly", () => {
    const world = realmWorld();
    const area = areaOf(world, 1);
    send(world, { type: "setWageOffer", area: 1, wageOffer: 3 });
    send(world, { type: "setJobTarget", area: 1, job: { kind: "fortify" }, targetWorkers: 200 });
    const unemployed = area.unemployedWorkers;
    runHiring(world);
    const job = stateOf(world, 1).jobs[0] as JobAssignment;
    expect(job.workers).toBeCloseTo(200 * (1 - Math.exp(-0.1)), 9);
    expect(area.unemployedWorkers).toBeCloseTo(unemployed - job.workers, 6);
    send(world, { type: "setJobTarget", area: 1, job: { kind: "fortify" }, targetWorkers: 0 });
    runHiring(world);
    expect(stateOf(world, 1).jobs).toHaveLength(0);
    expect(area.unemployedWorkers).toBeCloseTo(unemployed, 6);
  });

  it("does not hire below the wage level, and workers quit an underpaying job", () => {
    const world = realmWorld();
    send(world, { type: "setWageOffer", area: 1, wageOffer: 0.5 });
    send(world, { type: "setJobTarget", area: 1, job: { kind: "fortify" }, targetWorkers: 200 });
    runHiring(world);
    expect(governmentWorkers(stateOf(world, 1))).toBe(0);
    (stateOf(world, 1).jobs[0] as JobAssignment).workers = 100;
    runHiring(world);
    expect(governmentWorkers(stateOf(world, 1))).toBeLessThan(100);
  });

  it("keeps the workforce whole: private, government and unemployed workers", () => {
    const world = realmWorld();
    for (const id of [0, 1, 2]) {
      send(world, { type: "setWageOffer", area: id, wageOffer: 2 });
      send(world, { type: "setJobTarget", area: id, job: { kind: "research" }, targetWorkers: 300 });
    }
    for (let i = 0; i < 100; i++) runTick(world);
    for (const id of [0, 1, 2]) {
      const area = areaOf(world, id);
      let workers = area.unemployedWorkers + governmentWorkers(stateOf(world, id));
      for (const good of world.goods) workers += area.privateWorkers[good.id] as number;
      expect(workers).toBeCloseTo(area.population * world.config.economy.workforceShare, 6);
      expect(governmentWorkers(stateOf(world, id))).toBeGreaterThan(250);
    }
  });
});

describe("government production (phase 1)", () => {
  it("shares natural capacity with private workers and sends its share to the depot", () => {
    const world = realmWorld();
    const area = areaOf(world, 1);
    const grain = goodId(world, "grain");
    const privateWorkers = area.privateWorkers[grain] as number;
    stateOf(world, 1).jobs.push({
      job: { kind: "produce", good: grain },
      targetWorkers: privateWorkers,
      workers: privateWorkers,
    });
    const capacity = area.naturalCapacity[grain] as number;
    const hourly = hourlyOutputPerWorker(world, area, world.goods[grain] as never);
    const stock = area.stock[grain] as number;
    runProduction(world);
    const total = capacity * (1 - Math.exp(-(2 * privateWorkers * hourly) / capacity));
    expect(area.produced[grain]).toBeCloseTo(total, 9);
    expect(stateOf(world, 1).depot[grain]).toBeCloseTo(total / 2, 9);
    expect((area.stock[grain] as number) - stock).toBeLessThan(total / 2 + 1e-9); // bread also drew grain
  });

  it("crafts from depot inputs only, rationed by what the depot holds", () => {
    const world = realmWorld();
    const area = areaOf(world, 1);
    const bread = goodId(world, "bread");
    const grain = goodId(world, "grain");
    const depot = stateOf(world, 1).depot;
    stateOf(world, 1).jobs.push({ job: { kind: "produce", good: bread }, targetWorkers: 10, workers: 10 });
    const maximum = 10 * hourlyOutputPerWorker(world, area, world.goods[bread] as never);
    const perBread = world.goods[bread]?.inputs[0]?.quantity as number;
    runProduction(world);
    expect(depot[bread]).toBe(0); // no grain in the depot
    depot[grain] = (maximum * perBread) / 2;
    runProduction(world);
    expect(depot[bread]).toBeCloseTo(maximum / 2, 9);
    expect(depot[grain]).toBeCloseTo(0, 9);
  });
});

describe("government jobs (phase 10)", () => {
  it("lowers transport cost step by step down to the floor", () => {
    const world = realmWorld();
    const edge = world.edges[0] as World["edges"][number];
    const g = world.config.government;
    const costs: number[] = [];
    for (let step = 0; step < 15; step++) {
      buildInfrastructure(world, edge, g.infrastructureWorkerDaysPerStep);
      costs.push(edge.transportCost / edge.baseTransportCost);
    }
    expect(costs[0]).toBeCloseTo(0.9, 12);
    expect(costs[1]).toBeCloseTo(0.81, 12);
    expect(costs[2]).toBeCloseTo(0.729, 12);
    for (let i = 1; i < costs.length; i++) expect(costs[i]).toBeLessThanOrEqual(costs[i - 1] as number);
    expect(costs.at(-1)).toBe(g.minimumTransportCostFactor);
  });

  it("builds roads, fortifications, ports, airports and research with worker-days", () => {
    const world = realmWorld();
    const g = world.config.government;
    const t = world.config.transport;
    const assign = (area: number, job: JobAssignment["job"], workerDays: number) =>
      stateOf(world, area).jobs.push({ job, targetWorkers: workerDays, workers: workerDays });
    assign(1, { kind: "buildInfrastructure", edge: 0 }, g.infrastructureWorkerDaysPerStep);
    assign(1, { kind: "fortify" }, g.fortificationWorkerDaysPerLevel);
    assign(0, { kind: "buildPort" }, t.portWorkerDaysPerLevel);
    assign(1, { kind: "buildAirport" }, t.airportWorkerDaysPerLevel);
    assign(2, { kind: "research" }, g.researchWorkerDaysPerLevel);
    const sea = world.edges[2] as World["edges"][number];
    const seaCapacity = sea.capacityPerDay;
    runJobs(world);
    advanceInfrastructure(world);
    expect((world.edges[0] as World["edges"][number]).transportCost).toBeCloseTo(
      0.9 * (world.edges[0] as World["edges"][number]).baseTransportCost,
      12,
    );
    expect(areaOf(world, 1).fortificationLevel).toBe(1);
    expect(areaOf(world, 0).portLevel).toBe(2);
    expect(sea.capacityPerDay).toBe(seaCapacity); // the isle's port is still level 1
    expect(areaOf(world, 1).airportLevel).toBe(1);
    expect(world.edges.some((edge) => edge.mode === "air" && (edge.areaA === 1 || edge.areaB === 1))).toBe(true);
    expect(government(world).researchLevel).toBe(1);
  });
});

describe("money", () => {
  it("is conserved between savings and treasuries under taxes, tariffs, wages, orders and transfers", () => {
    const world = realmWorld();
    const grain = goodId(world, "grain");
    send(world, { type: "setRealmPolicy", setting: { policy: "headTaxPerPersonPerDay", good: null, value: 0.2 } });
    send(world, { type: "setRealmPolicy", setting: { policy: "consumptionTaxRate", good: grain, value: 0.3 } });
    send(world, { type: "setRealmPolicy", setting: { policy: "productionTaxRate", good: grain, value: -0.2 } });
    send(world, { type: "setRealmPolicy", setting: { policy: "exportTariffRate", good: grain, value: 0.2 } });
    send(world, { type: "setWageOffer", area: 1, wageOffer: 2 });
    send(world, { type: "setJobTarget", area: 1, job: { kind: "research" }, targetWorkers: 300 });
    send(world, {
      type: "addStandingOrder",
      order: {
        areas: "all",
        rule: { kind: "keepDepotStock", good: grain, targetDaysOfDemand: 2, maximumBuyPrice: 100 },
      },
    });
    const money = totalMoney(world);
    for (let i = 0; i < 50; i++) runTick(world);
    stateOf(world, 1).depot[grain] = 10;
    runTick(world, [
      { player: "p1", government: 0, command: { type: "transferGoods", from: 1, to: 2, good: grain, quantity: 10 } },
    ]);
    for (let i = 0; i < 20; i++) runTick(world);
    expect(totalMoney(world)).toBeCloseTo(money, 3);
    expect(government(world).researchProgress).toBeGreaterThan(0);
  });
});
