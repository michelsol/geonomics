import { describe, expect, it } from "vitest";
import { AI_PLAYER, MAXIMUM_MARKET_ORDERS, MAXIMUM_STANDING_ORDERS, transferPath } from "./commands";
import { foundGovernments } from "./government";
import { goodId, PLAYER, realmWorld, send } from "./testing";
import { runTick } from "./tick/tick";
import type { Army, Command, GovernmentAreaState, StandingRule, World } from "./types";

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
  function unowned() {
    const world = realmWorld();
    world.governments.length = 0;
    world.relations.length = 0;
    for (const area of world.areas) area.owner = null;
    return world;
  }

  it("gives an area with no land or sea path to the capital nearest in a straight line", () => {
    const world = unowned();
    for (const edge of world.edges) if (edge.mode === "sea") edge.isActive = false; // the isle is cut off
    const [, east] = foundGovernments(world, [1, 3]); // the isle (0, 500) is nearer the Valley (100, 0)
    expect(world.areas.every((area) => area.owner !== null)).toBe(true);
    expect(world.areas[2]?.owner).toBe(0);
    expect(east?.ownedAreas).toEqual([3]);
  });

  it("splits every area between the nearest capitals, and gives each a treasury", () => {
    const world = realmWorld();
    world.governments.length = 0;
    world.relations.length = 0;
    for (const area of world.areas) area.owner = null;
    const [west, east] = foundGovernments(world, [0, 3]);
    // The valley is 100 away from both capitals: the tie goes to the first. The isle is reached by sea.
    expect(west?.ownedAreas).toEqual([0, 1, 2]);
    expect(east?.ownedAreas).toEqual([3]);
    expect(west?.color).not.toBe(east?.color);
    expect(west?.treasury).toBeGreaterThan(0);
    expect(world.relations).toEqual([
      ["peace", "peace"],
      ["peace", "peace"],
    ]);
  });
});

describe("armies", () => {
  const recruit = (world: World, area = 1, soldiers = 100, player = PLAYER, government = 0) =>
    send(world, { type: "recruitArmy", area, soldiers }, player, government);
  const onlyArmy = (world: World) => [...world.armies.values()][0] as Army;

  it("recruits from the workforce and the population", () => {
    const world = realmWorld();
    const area = world.areas[1] as World["areas"][number];
    const before = { population: area.population, unemployed: area.unemployedWorkers };
    expect(recruit(world)).toBeNull();
    const army = onlyArmy(world);
    expect(army).toMatchObject({ owner: 0, soldiers: 100, weapons: 0, stance: "hold" });
    expect(army.location).toEqual({ kind: "area", area: 1 });
    expect(area.population).toBeCloseTo(before.population - 100, 9);
    expect(area.unemployedWorkers).toBeCloseTo(before.unemployed - 100, 9);
  });

  it("rejects recruiting in foreign areas, empty armies and more than the workforce", () => {
    const world = realmWorld();
    expect(recruit(world, 3)).toMatch(/not owned/);
    expect(recruit(world, 1, 0)).toMatch(/at least one/);
    expect(recruit(world, 1, 6000)).toMatch(/not enough/);
    expect(world.armies.size).toBe(0);
  });

  it("disbands part or all of an army, never someone else's", () => {
    const world = realmWorld();
    recruit(world);
    recruit(world, 3, 50, AI_PLAYER, 1);
    const [own, foreign] = [...world.armies.values()] as [Army, Army];
    expect(send(world, { type: "disbandArmy", army: own.id, soldiers: 101 })).toMatch(/size/);
    expect(send(world, { type: "disbandArmy", army: foreign.id, soldiers: 1 })).toMatch(/does not belong/);
    expect(send(world, { type: "disbandArmy", army: own.id, soldiers: 40 })).toBeNull();
    expect(own.soldiers).toBe(60);
    expect(send(world, { type: "disbandArmy", army: own.id, soldiers: 60 })).toBeNull();
    expect(world.armies.has(own.id)).toBe(false);
  });

  it("plans marches over land and by sea from its own ports only", () => {
    const world = realmWorld();
    recruit(world);
    recruit(world, 3, 50, AI_PLAYER, 1);
    const [own, foreign] = [...world.armies.values()] as [Army, Army];
    expect(send(world, { type: "moveArmy", army: own.id, destination: 2 })).toBeNull();
    expect(own.path).toEqual([0, 2]);
    expect(send(world, { type: "moveArmy", army: foreign.id, destination: 0 }, AI_PLAYER, 1)).toBeNull();
    expect(send(world, { type: "moveArmy", army: foreign.id, destination: 2 }, AI_PLAYER, 1)).toMatch(/cannot reach/);
    expect(send(world, { type: "moveArmy", army: own.id, destination: 9 })).toMatch(/unknown area/);
  });

  it("sets stances and the soldier wage", () => {
    const world = realmWorld();
    recruit(world);
    const army = onlyArmy(world);
    expect(send(world, { type: "setArmyStance", army: army.id, stance: "attack" })).toBeNull();
    expect(army.stance).toBe("attack");
    expect(send(world, { type: "setArmyStance", army: army.id, stance: "flee" } as unknown as Command)).toMatch(
      /stance/,
    );
    expect(world.governments[0]?.soldierWage).toBe(world.config.military.soldierWage);
    expect(send(world, { type: "setSoldierWage", wage: 1.5 })).toBeNull();
    expect(world.governments[0]?.soldierWage).toBe(1.5);
    expect(send(world, { type: "setSoldierWage", wage: -1 })).toMatch(/soldier wage/);
    expect(send(world, { type: "setSoldierWage", wage: Number.NaN })).toMatch(/soldier wage/);
  });

  it("no longer knows army supply commands and rules", () => {
    const world = realmWorld();
    recruit(world);
    const army = onlyArmy(world);
    expect(send(world, { type: "supplyArmy", army: army.id, food: 1, weapons: 1 } as unknown as Command)).toMatch(
      /unknown command/,
    );
    const rule = { kind: "supplyArmies", good: 0, daysOfSupply: 5 } as unknown as StandingRule;
    expect(send(world, { type: "addStandingOrder", order: { areas: "all", rule } })).toMatch(/unknown rule/);
  });
});

describe("diplomacy", () => {
  const war = (world: World) => send(world, { type: "declareWar", target: 1 });
  const proposal = (world: World, overrides: object = {}) =>
    ({
      type: "proposePeace",
      proposal: {
        from: 0,
        to: 1,
        areaTransfers: [{ area: 3, newOwner: 0 }],
        payment: 500,
        expiresAtDay: world.gameDay + 30,
        ...overrides,
      },
    }) as Command;

  it("declares war on both sides, once", () => {
    const world = realmWorld();
    expect(war(world)).toBeNull();
    expect(world.relations[0]?.[1]).toBe("war");
    expect(world.relations[1]?.[0]).toBe("war");
    expect(war(world)).toMatch(/already/);
    expect(send(world, { type: "declareWar", target: 0 })).toMatch(/itself/);
    expect(send(world, { type: "declareWar", target: 5 })).toMatch(/unknown/);
  });

  it("validates peace proposals", () => {
    const world = realmWorld();
    expect(send(world, proposal(world))).toMatch(/at war/);
    war(world);
    expect(send(world, proposal(world, { from: 1 }))).toMatch(/sending government/);
    expect(send(world, proposal(world, { expiresAtDay: world.gameDay }))).toMatch(/future/);
    expect(send(world, proposal(world, { payment: Number.NaN }))).toMatch(/finite/);
    expect(send(world, proposal(world, { areaTransfers: [{ area: 3, newOwner: 1 }] }))).toMatch(/other side/);
    expect(
      send(
        world,
        proposal(world, {
          areaTransfers: [
            { area: 3, newOwner: 0 },
            { area: 3, newOwner: 0 },
          ],
        }),
      ),
    ).toMatch(/twice/);
    expect(send(world, proposal(world))).toBeNull();
    expect(world.peaceProposals).toHaveLength(1);
  });

  it("makes peace: areas change hands, the payment moves and the relation is restored", () => {
    const world = realmWorld();
    war(world);
    send(world, { type: "setRealmPolicy", setting: { policy: "consumptionTaxRate", good: 0, value: 0.1 } });
    // Give government 1 a second area so it survives the treaty.
    (world.governments[0] as World["governments"][number]).treasury = 1000;
    send(
      world,
      proposal(world, {
        areaTransfers: [
          { area: 3, newOwner: 0 },
          { area: 2, newOwner: 1 },
        ],
      }),
    );
    const id = world.peaceProposals[0]?.id as number;
    expect(send(world, { type: "answerPeace", proposalId: id, accept: true })).toMatch(/no such/); // not addressed to 0
    const treasury1 = world.governments[1]?.treasury as number;
    expect(send(world, { type: "answerPeace", proposalId: id, accept: true }, AI_PLAYER, 1)).toBeNull();
    expect(world.relations[0]?.[1]).toBe("peace");
    expect(world.areas[3]?.owner).toBe(0);
    expect(world.areas[2]?.owner).toBe(1);
    expect(stateOf(world, 3).resolvedPolicies.consumptionTaxRate[0]).toBe(0.1);
    expect(world.governments[0]?.treasury).toBe(500);
    expect(world.governments[1]?.treasury).toBe(treasury1 + 500);
    expect(world.governments[1]?.capital).toBe(2);
    expect(world.peaceProposals).toHaveLength(0);
  });

  it("rejects an acceptance the payer cannot afford, and drops refused or expired proposals", () => {
    const world = realmWorld();
    war(world);
    send(world, proposal(world, { payment: 1e12 }));
    const id = world.peaceProposals[0]?.id as number;
    expect(send(world, { type: "answerPeace", proposalId: id, accept: true }, AI_PLAYER, 1)).toMatch(/cannot cover/);
    expect(send(world, { type: "answerPeace", proposalId: id, accept: false }, AI_PLAYER, 1)).toBeNull();
    expect(world.peaceProposals).toHaveLength(0);
    send(world, proposal(world, { expiresAtDay: world.gameDay + 2 }));
    for (let i = 0; i < 4; i++) runTick(world);
    expect(world.peaceProposals).toHaveLength(0);
    expect(world.relations[0]?.[1]).toBe("war");
  });
});
