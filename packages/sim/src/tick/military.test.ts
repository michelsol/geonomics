import { describe, expect, it } from "vitest";
import { armyPath } from "../army";
import { AI_PLAYER } from "../commands";
import { realmWorld, send } from "../testing";
import type { Army, GovernmentAreaState, World } from "../types";
import { runMilitary, runUpkeep, wearWeapons } from "./military";
import { runPopulation } from "./population";
import { updateBlockedEdges } from "./tick";

type Area = World["areas"][number];
const areaOf = (world: World, id: number) => world.areas[id] as Area;
const stateOf = (world: World, area: number, government = 0) =>
  world.governments[government]?.areaStates.get(area) as GovernmentAreaState;

/** Recruits an army for a government in one of its areas and returns it. */
function raise(world: World, area: number, soldiers: number, government = 0): Army {
  const player = government === 0 ? "p1" : AI_PLAYER;
  expect(send(world, { type: "recruitArmy", area, soldiers }, player, government)).toBeNull();
  return [...world.armies.values()].at(-1) as Army;
}

describe("marching", () => {
  it("crosses edges in their travel days, carrying leftover days into the next edge", () => {
    const world = realmWorld();
    const army = raise(world, 1, 100);
    send(world, { type: "moveArmy", army: army.id, destination: 2 });
    // Valley → Harbor takes 4 days over land, Harbor → Isle 5 days by sea.
    for (let day = 1; day <= 3; day++) runMilitary(world);
    expect(army.location).toMatchObject({ kind: "edge", from: 1, daysTravelled: 3 });
    runMilitary(world);
    expect(army.location).toEqual({ kind: "area", area: 0 });
    for (let day = 1; day <= 5; day++) runMilitary(world);
    expect(army.location).toEqual({ kind: "area", area: 2 });
    expect(army.path).toEqual([]);
  });

  it("embarks only from its own ports and never flies", () => {
    const world = realmWorld();
    expect(armyPath(world, 1, 0, 2)).toBeNull(); // government 1 holds no port
    expect(armyPath(world, 0, 0, 2)?.steps.map((s) => world.edges[s.edge]?.mode)).toEqual(["sea"]);
    (world.edges[2] as World["edges"][number]).isActive = false; // close the sea route; the air route stays
    expect(armyPath(world, 0, 0, 2)).toBeNull();
  });

  it("stops on entering an area it attacks", () => {
    const world = realmWorld();
    send(world, { type: "declareWar", target: 0 }, AI_PLAYER, 1);
    const army = raise(world, 3, 100, 1);
    send(world, { type: "setArmyStance", army: army.id, stance: "attack" }, AI_PLAYER, 1);
    send(world, { type: "moveArmy", army: army.id, destination: 0 }, AI_PLAYER, 1);
    world.config.pace.militaryResponsiveness = 20; // the whole march would fit in one tick
    runMilitary(world);
    expect(army.location).toEqual({ kind: "area", area: 1 });
    expect(army.path).toEqual([0]);
  });
});

describe("upkeep", () => {
  it("eats carried food and deserts when it runs out", () => {
    const world = realmWorld();
    const army = raise(world, 1, 1000);
    const m = world.config.military;
    army.food = 1000 * m.foodPerSoldierPerDay * 1.5;
    runUpkeep(world);
    expect(army.food).toBeCloseTo(1000 * m.foodPerSoldierPerDay * 0.5, 9);
    expect(army.soldiers).toBe(1000);
    const population = areaOf(world, 1).population;
    runUpkeep(world); // half fed
    const deserters = 1000 * (1 - Math.exp(-m.desertionRatePerDay)) * 0.5;
    expect(army.soldiers).toBeCloseTo(1000 - deserters, 6);
    expect(areaOf(world, 1).population).toBeCloseTo(population + deserters, 6);
  });

  it("refills from the depot under a supplyArmies order at home, forages abroad", () => {
    const world = realmWorld();
    const { foodGood, weaponsGood, foodPerSoldierPerDay, foragingShare } = world.config.military;
    const army = raise(world, 1, 100);
    send(world, {
      type: "addStandingOrder",
      order: { areas: "all", rule: { kind: "supplyArmies", good: foodGood, daysOfSupply: 10 } },
    });
    send(world, {
      type: "addStandingOrder",
      order: { areas: [1], rule: { kind: "supplyArmies", good: weaponsGood, daysOfSupply: 0 } },
    });
    stateOf(world, 1).depot[foodGood] = 1e6;
    stateOf(world, 1).depot[weaponsGood] = 1e6;
    runUpkeep(world);
    expect(army.food).toBeCloseTo(10 * 100 * foodPerSoldierPerDay, 6);
    expect(army.weapons).toBe(100);

    // Abroad, the army takes what it eats from private stock, within the foraging share.
    army.location = { kind: "area", area: 3 };
    army.food = 0;
    const march = areaOf(world, 3);
    march.stock[foodGood] = 1;
    runUpkeep(world);
    expect(march.stock[foodGood]).toBeCloseTo(1 - foragingShare, 12);
  });

  it("wears weapons out", () => {
    const world = realmWorld();
    const army = raise(world, 1, 100);
    army.weapons = 100;
    wearWeapons(world);
    expect(army.weapons).toBeCloseTo(100 * Math.exp(-world.config.military.weaponWearRatePerDay), 12);
  });
});

describe("combat and sieges", () => {
  /** Government 0 at war with 1, with an attacking army of `soldiers`, half equipped, standing in March. */
  function invasion(soldiers: number) {
    const world = realmWorld();
    send(world, { type: "declareWar", target: 1 });
    const attacker = raise(world, 1, soldiers);
    attacker.weapons = soldiers / 2;
    attacker.food = 1e9;
    attacker.stance = "attack";
    attacker.location = { kind: "area", area: 3 };
    return { world, attacker, march: areaOf(world, 3) };
  }

  it("follows the Lanchester losses for one tick", () => {
    const { world, attacker } = invasion(1000);
    const defender = raise(world, 3, 400, 1);
    defender.weapons = 400;
    areaOf(world, 3).fortificationLevel = 1;
    const k = world.config.military.combatLethalityPerDay;
    const attackPower = 1000 * 1.5;
    const defensePower = 400 * 2 * 2;
    runMilitary(world);
    expect(attacker.soldiers).toBeCloseTo(1000 - (k * defensePower) / 1.5, 9);
    expect(defender.soldiers).toBeCloseTo(400 - (k * attackPower) / 2, 9);
  });

  it("besieges an undefended area, and the siege decays once the attackers leave", () => {
    const { world, attacker, march } = invasion(1000);
    runMilitary(world);
    const expected = (world.config.military.siegeRatePerDay * 1500) / march.population;
    expect(march.besiegingGovernment).toBe(0);
    expect(march.siegeProgress).toBeCloseTo(expected, 12);
    updateBlockedEdges(world);
    expect(world.edges[1]?.isBlocked).toBe(true);
    attacker.location = { kind: "area", area: 1 };
    for (let i = 0; i < 100; i++) runMilitary(world);
    expect(march.siegeProgress).toBe(0);
    expect(march.besiegingGovernment).toBeNull();
  });

  it("captures an area with all its consequences, and eliminates a government with no area left", () => {
    const { world, attacker, march } = invasion(1000);
    const defender = world.governments[1] as World["governments"][number];
    const state = stateOf(world, 3, 1);
    state.depot[0] = 50;
    state.jobs.push({ job: { kind: "fortify" }, targetWorkers: 30, workers: 30 });
    defender.marketOrders.push({
      id: 99,
      area: 3,
      good: 0,
      side: "buy",
      remainingQuantity: 1,
      limitPrice: 1,
      maximumQuantityPerDay: 1,
    });
    march.fortificationLevel = 1;
    const unemployed = march.unemployedWorkers;
    const away = raise(world, 3, 10, 1);
    away.location = { kind: "edge", edge: 1, from: 3, daysTravelled: 1 }; // not defending
    march.siegeProgress = 0.99;
    march.besiegingGovernment = 0;
    runMilitary(world);
    expect(march.owner).toBe(0);
    expect(march.fortificationLevel).toBe(0);
    expect(stateOf(world, 3).depot[0]).toBe(50);
    expect(march.unemployedWorkers).toBeGreaterThanOrEqual(unemployed + 30 - 1e-9);
    expect(defender.isEliminated).toBe(true);
    expect(defender.capital).toBeNull();
    expect(defender.marketOrders).toEqual([]);
    expect(world.armies.has(away.id)).toBe(false);
    expect(world.armies.has(attacker.id)).toBe(true);
  });

  it("moves the capital to the most populous remaining area", () => {
    const world = realmWorld();
    send(world, { type: "declareWar", target: 0 }, AI_PLAYER, 1);
    const attacker = raise(world, 3, 1000, 1);
    attacker.stance = "attack";
    attacker.location = { kind: "area", area: 0 };
    areaOf(world, 2).population = 20_000;
    areaOf(world, 0).siegeProgress = 0.999;
    areaOf(world, 0).besiegingGovernment = 1;
    areaOf(world, 0).militia = 0;
    runMilitary(world);
    expect(areaOf(world, 0).owner).toBe(1);
    expect(world.governments[0]?.capital).toBe(2);
  });

  it("fights the militia of a neutral area before besieging it", () => {
    const world = realmWorld();
    const attacker = raise(world, 1, 1000);
    attacker.weapons = 1000;
    attacker.stance = "attack";
    const neutral = areaOf(world, 3);
    world.governments[1]?.ownedAreas.splice(0);
    world.governments[1]?.areaStates.clear();
    neutral.owner = null;
    neutral.militia = neutral.population * world.config.military.militiaShare;
    attacker.location = { kind: "area", area: 3 };
    const population = neutral.population;
    runMilitary(world);
    expect(neutral.militia).toBeLessThan(200);
    expect(neutral.population).toBeLessThan(population);
    expect(neutral.siegeProgress).toBe(0);
  });
});

describe("blocked edges", () => {
  it("stop migration between governments at war", () => {
    const migrateToMarch = (war: boolean) => {
      const world = realmWorld({ population: { growthRatePerDay: 0, starvationRatePerDay: 0 } });
      areaOf(world, 1).satisfaction = 0.2; // the Valley is much less attractive than March
      if (war) send(world, { type: "declareWar", target: 1 });
      updateBlockedEdges(world);
      const before = areaOf(world, 3).population;
      runPopulation(world);
      return areaOf(world, 3).population - before;
    };
    expect(migrateToMarch(false)).toBeGreaterThan(1);
    expect(migrateToMarch(true)).toBe(0);
  });
});
