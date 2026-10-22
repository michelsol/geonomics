import { describe, expect, it } from "vitest";
import { AI_PLAYER, MAXIMUM_MARKET_ORDERS, MAXIMUM_STANDING_ORDERS, transferPath } from "./commands";
import { foundGovernments } from "./government";
import { goodId, PLAYER, realmWorld, send } from "./testing";
import type { Command, GovernmentAreaState, World } from "./types";

const stateOf = (world: World, area: number, government = 0) =>
  world.governments[government]?.areaStates.get(area) as GovernmentAreaState;

describe("command senders", () => {
  it("accepts the controlling player and the AI sender for AI governments", () => {
    const world = realmWorld();
    const command: Command = { type: "setWageOffer", area: 3, wageOffer: 2 };
    expect(send(world, command, AI_PLAYER, 1)).toBeNull();
    expect(stateOf(world, 3, 1).wageOffer).toBe(2);
  });

  it("rejects other senders, unknown governments and eliminated governments", () => {
    const world = realmWorld();
    const command: Command = { type: "setWageOffer", area: 0, wageOffer: 2 };
    expect(send(world, command, "intruder")).toMatch(/sender/);
    expect(send(world, command, AI_PLAYER)).toMatch(/sender/);
    expect(send(world, { type: "setWageOffer", area: 3, wageOffer: 2 }, PLAYER, 1)).toMatch(/sender/);
    expect(send(world, command, PLAYER, 7)).toMatch(/unknown government/);
    (world.governments[0] as World["governments"][number]).isEliminated = true;
    expect(send(world, command)).toMatch(/eliminated/);
    expect(stateOf(world, 0).wageOffer).toBe(1);
  });

  it("rejects unknown commands", () => {
    const world = realmWorld();
    expect(send(world, { type: "bribe" } as unknown as Command)).toMatch(/unknown command/);
  });
});

describe("policies", () => {
  const grain = 0;

  it("applies realm defaults to every owned area and lets an override win in one area", () => {
    const world = realmWorld();
    expect(
      send(world, { type: "setRealmPolicy", setting: { policy: "productionTaxRate", good: grain, value: 0.2 } }),
    ).toBeNull();
    for (const area of [0, 1, 2]) expect(stateOf(world, area).resolvedPolicies.productionTaxRate[grain]).toBe(0.2);
    expect(
      send(world, {
        type: "setAreaPolicy",
        area: 1,
        setting: { policy: "productionTaxRate", good: grain, value: -0.1 },
      }),
    ).toBeNull();
    expect(stateOf(world, 1).resolvedPolicies.productionTaxRate[grain]).toBe(-0.1);
    expect(stateOf(world, 0).resolvedPolicies.productionTaxRate[grain]).toBe(0.2);
    expect(send(world, { type: "clearAreaPolicy", area: 1, policy: "productionTaxRate", good: grain })).toBeNull();
    expect(stateOf(world, 1).resolvedPolicies.productionTaxRate[grain]).toBe(0.2);
    // The other government's area is untouched.
    expect(stateOf(world, 3, 1).resolvedPolicies.productionTaxRate[grain]).toBe(0);
  });

  it("sets head tax per area and removes a ceiling with a null value", () => {
    const world = realmWorld();
    send(world, { type: "setRealmPolicy", setting: { policy: "headTaxPerPersonPerDay", good: null, value: 0.5 } });
    expect(stateOf(world, 2).resolvedPolicies.headTaxPerPersonPerDay).toBe(0.5);
    send(world, { type: "setRealmPolicy", setting: { policy: "priceCeiling", good: grain, value: 3 } });
    expect(stateOf(world, 0).resolvedPolicies.priceCeiling[grain]).toBe(3);
    send(world, { type: "setAreaPolicy", area: 0, setting: { policy: "priceCeiling", good: grain, value: null } });
    expect(stateOf(world, 0).resolvedPolicies.priceCeiling[grain]).toBe(Number.POSITIVE_INFINITY);
    expect(stateOf(world, 1).resolvedPolicies.priceCeiling[grain]).toBe(3);
  });

  it("rejects out-of-range rates, malformed settings and foreign areas", () => {
    const world = realmWorld();
    const set = (policy: string, good: number | null, value: number | null) =>
      send(world, { type: "setRealmPolicy", setting: { policy, good, value } as never });
    expect(set("productionTaxRate", grain, 6)).toMatch(/within/);
    expect(set("importTariffRate", grain, -1.5)).toMatch(/within/);
    expect(set("consumptionTaxRate", grain, Number.NaN)).toMatch(/finite/);
    expect(set("headTaxPerPersonPerDay", grain, 1)).toMatch(/not a good/);
    expect(set("headTaxPerPersonPerDay", null, -1)).toMatch(/non-negative/);
    expect(set("priceFloor", grain, -1)).toMatch(/non-negative/);
    expect(set("priceFloor", 99, 1)).toMatch(/unknown good/);
    expect(set("lowerTaxes", grain, 0)).toMatch(/unknown policy/);
    expect(
      send(world, { type: "setAreaPolicy", area: 3, setting: { policy: "productionTaxRate", good: grain, value: 0 } }),
    ).toMatch(/not owned/);
    expect(send(world, { type: "clearAreaPolicy", area: 42, policy: "priceFloor", good: grain })).toMatch(
      /unknown area/,
    );
    expect(world.governments[0]?.realmPolicies).toEqual([]);
  });
});

describe("market orders", () => {
  const order = (overrides: object = {}) =>
    ({
      type: "placeMarketOrder",
      order: {
        area: 0,
        good: 0,
        side: "buy",
        remainingQuantity: 100,
        limitPrice: 5,
        maximumQuantityPerDay: 10,
        ...overrides,
      },
    }) as Command;

  it("places orders with fresh ids and cancels them", () => {
    const world = realmWorld();
    expect(send(world, order())).toBeNull();
    expect(send(world, order({ side: "sell" }))).toBeNull();
    const [first, second] = world.governments[0]?.marketOrders ?? [];
    expect(first?.id).not.toBe(second?.id);
    expect(send(world, { type: "cancelMarketOrder", orderId: first?.id as number })).toBeNull();
    expect(world.governments[0]?.marketOrders).toHaveLength(1);
    expect(send(world, { type: "cancelMarketOrder", orderId: first?.id as number })).toMatch(/no such/);
  });

  it("rejects foreign areas, services, bad sides, negative numbers and too many orders", () => {
    const world = realmWorld();
    expect(send(world, order({ area: 3 }))).toMatch(/not owned/);
    expect(send(world, order({ good: 99 }))).toMatch(/unknown good/);
    expect(send(world, order({ side: "short" }))).toMatch(/side/);
    expect(send(world, order({ limitPrice: -1 }))).toMatch(/non-negative/);
    expect(send(world, order({ remainingQuantity: Number.POSITIVE_INFINITY }))).toMatch(/finite/);
    const government = world.governments[0] as World["governments"][number];
    for (let i = 0; i < MAXIMUM_MARKET_ORDERS; i++)
      government.marketOrders.push({
        id: 10_000 + i,
        area: 0,
        good: 0,
        side: "buy",
        remainingQuantity: 1,
        limitPrice: 1,
        maximumQuantityPerDay: 1,
      });
    expect(send(world, order())).toMatch(/too many/);
  });
});

describe("depot transfers", () => {
  const grain = 0;

  it("finds the cheapest open path across land, sea and air", () => {
    const world = realmWorld();
    expect(transferPath(world, 1, 2)?.steps.map((s) => world.edges[s.edge]?.mode)).toEqual(["land", "sea"]);
    (world.edges[2] as World["edges"][number]).isBlocked = true; // the sea route
    expect(transferPath(world, 1, 2)?.steps.map((s) => world.edges[s.edge]?.mode)).toEqual(["land", "air"]);
    (world.edges[3] as World["edges"][number]).isActive = false; // the air route
    expect(transferPath(world, 1, 2)).toBeNull();
  });

  it("takes goods from the source depot, pays transport upfront and schedules the arrival", () => {
    const world = realmWorld();
    stateOf(world, 1).depot[grain] = 100;
    const treasury = world.governments[0]?.treasury as number;
    expect(send(world, { type: "transferGoods", from: 1, to: 2, good: grain, quantity: 60 })).toBeNull();
    expect(stateOf(world, 1).depot[grain]).toBe(40);
    const land = world.edges[0] as World["edges"][number];
    const sea = world.edges[2] as World["edges"][number];
    const cost = (land.transportCost + sea.transportCost) * (world.goods[grain]?.transportWeight as number) * 60;
    expect(world.governments[0]?.treasury).toBeCloseTo(treasury - cost, 9);
    expect(world.governments[0]?.depotTransfers).toEqual([
      { good: grain, quantity: 60, destination: 2, daysRemaining: land.travelDays + sea.travelDays },
    ]);
  });

  it("rejects transfers beyond the depot, without a path, to the same or foreign areas, or unpaid", () => {
    const world = realmWorld();
    stateOf(world, 1).depot[grain] = 10;
    const transfer = (overrides: object) =>
      send(world, { type: "transferGoods", from: 1, to: 2, good: grain, quantity: 5, ...overrides } as Command);
    expect(transfer({ quantity: 11 })).toMatch(/not enough/);
    expect(transfer({ quantity: -1 })).toMatch(/non-negative/);
    expect(transfer({ to: 1 })).toMatch(/same area/);
    expect(transfer({ to: 3 })).toMatch(/not owned/);
    (world.governments[0] as World["governments"][number]).treasury = 0;
    expect(transfer({})).toMatch(/treasury/);
    (world.governments[0] as World["governments"][number]).treasury = 1e6;
    for (const edge of world.edges) edge.isBlocked = true;
    expect(transfer({})).toMatch(/no open path/);
    expect(stateOf(world, 1).depot[grain]).toBe(10);
  });
});

describe("jobs and wages", () => {
  it("creates, updates and validates job targets", () => {
    const world = realmWorld();
    const bread = goodId(world, "bread");
    expect(
      send(world, { type: "setJobTarget", area: 1, job: { kind: "produce", good: bread }, targetWorkers: 50 }),
    ).toBeNull();
    expect(
      send(world, { type: "setJobTarget", area: 1, job: { kind: "produce", good: bread }, targetWorkers: 80 }),
    ).toBeNull();
    expect(send(world, { type: "setJobTarget", area: 1, job: { kind: "fortify" }, targetWorkers: 10 })).toBeNull();
    expect(stateOf(world, 1).jobs).toEqual([
      { job: { kind: "produce", good: bread }, targetWorkers: 80, workers: 0 },
      { job: { kind: "fortify" }, targetWorkers: 10, workers: 0 },
    ]);
    expect(
      send(world, { type: "setJobTarget", area: 0, job: { kind: "buildInfrastructure", edge: 0 }, targetWorkers: 5 }),
    ).toBeNull();
    expect(send(world, { type: "setJobTarget", area: 0, job: { kind: "buildPort" }, targetWorkers: 5 })).toBeNull();
    expect(send(world, { type: "setJobTarget", area: 1, job: { kind: "buildAirport" }, targetWorkers: 5 })).toBeNull();
    expect(send(world, { type: "setJobTarget", area: 1, job: { kind: "research" }, targetWorkers: 5 })).toBeNull();
  });

  it("rejects ports inland, roads on routes or far edges, services, missing resources and bad numbers", () => {
    const world = realmWorld();
    const job = (area: number, job: object, targetWorkers = 5) =>
      send(world, { type: "setJobTarget", area, job, targetWorkers } as Command);
    expect(job(1, { kind: "buildPort" })).toMatch(/coastal/);
    expect(job(0, { kind: "buildInfrastructure", edge: 2 })).toMatch(/land edges/);
    expect(job(0, { kind: "buildInfrastructure", edge: 1 })).toMatch(/does not touch/);
    expect(job(0, { kind: "buildInfrastructure", edge: 99 })).toMatch(/unknown edge/);
    (world.areas[1] as World["areas"][number]).naturalCapacityMaximum[goodId(world, "fish")] = 0;
    expect(job(1, { kind: "produce", good: goodId(world, "fish") })).toMatch(/natural capacity/);
    expect(job(1, { kind: "produce", good: 99 })).toMatch(/unknown good/);
    expect(job(1, { kind: "dig" })).toMatch(/unknown job/);
    expect(job(1, { kind: "fortify" }, -3)).toMatch(/non-negative/);
    expect(job(3, { kind: "fortify" })).toMatch(/not owned/);
  });

  it("sets wage offers within [0, 10]", () => {
    const world = realmWorld();
    expect(send(world, { type: "setWageOffer", area: 2, wageOffer: 1.5 })).toBeNull();
    expect(stateOf(world, 2).wageOffer).toBe(1.5);
    expect(send(world, { type: "setWageOffer", area: 2, wageOffer: 11 })).toMatch(/wage/);
    expect(send(world, { type: "setWageOffer", area: 2, wageOffer: -1 })).toMatch(/wage/);
  });
});

describe("standing orders", () => {
  const keep: Command = {
    type: "addStandingOrder",
    order: { areas: "all", rule: { kind: "keepDepotStock", good: 0, targetDaysOfDemand: 10, maximumBuyPrice: 5 } },
  };

  it("adds and removes standing orders", () => {
    const world = realmWorld();
    expect(send(world, keep)).toBeNull();
    expect(
      send(world, {
        type: "addStandingOrder",
        order: { areas: [0, 2], rule: { kind: "sellAbovePrice", good: 0, minimumPrice: 3, keepDaysOfDemand: 5 } },
      }),
    ).toBeNull();
    expect(
      send(world, {
        type: "addStandingOrder",
        order: { areas: [1], rule: { kind: "buyBelowPrice", good: 0, maximumPrice: 1, maximumDepotQuantity: 500 } },
      }),
    ).toBeNull();
    const orders = world.governments[0]?.standingOrders ?? [];
    expect(orders).toHaveLength(3);
    expect(send(world, { type: "removeStandingOrder", orderId: orders[0]?.id as number })).toBeNull();
    expect(world.governments[0]?.standingOrders).toHaveLength(2);
    expect(send(world, { type: "removeStandingOrder", orderId: 999 })).toMatch(/no such/);
  });

  it("rejects foreign areas, bad rules and too many orders", () => {
    const world = realmWorld();
    const add = (areas: unknown, rule: object) =>
      send(world, { type: "addStandingOrder", order: { areas, rule } } as Command);
    expect(add([3], { kind: "keepDepotStock", good: 0, targetDaysOfDemand: 1, maximumBuyPrice: 1 })).toMatch(
      /not owned/,
    );
    expect(add("some", { kind: "keepDepotStock", good: 0, targetDaysOfDemand: 1, maximumBuyPrice: 1 })).toMatch(/list/);
    expect(add("all", { kind: "keepDepotStock", good: 0, targetDaysOfDemand: -1, maximumBuyPrice: 1 })).toMatch(
      /non-negative/,
    );
    expect(add("all", { kind: "hoard", good: 0 })).toMatch(/unknown rule/);
    const government = world.governments[0] as World["governments"][number];
    for (let i = 0; i < MAXIMUM_STANDING_ORDERS; i++)
      government.standingOrders.push({
        id: 10_000 + i,
        areas: "all",
        rule: { kind: "buyBelowPrice", good: 0, maximumPrice: 1, maximumDepotQuantity: 1 },
      });
    expect(send(world, keep)).toMatch(/too many/);
  });
});

describe("founding", () => {
  it("gives each capital its unclaimed land neighbors and a treasury", () => {
    const world = realmWorld();
    world.governments.length = 0;
    world.relations.length = 0;
    for (const area of world.areas) area.owner = null;
    const [west, east] = foundGovernments(world, [0, 3]);
    expect(west?.ownedAreas).toEqual([0, 1]); // the isle is reached by sea only
    expect(east?.ownedAreas).toEqual([3]); // the valley was claimed first
    expect(west?.treasury).toBeGreaterThan(0);
    expect(world.relations).toEqual([
      ["peace", "peace"],
      ["peace", "peace"],
    ]);
  });
});
