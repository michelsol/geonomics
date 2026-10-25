import { describe, expect, it } from "vitest";
import { armyPath } from "../army";
import { AI_PLAYER } from "../commands";
import { realmWorld, send } from "../testing";
import type { Army, GovernmentAreaState, World } from "../types";
import { realmAverageWage, runDesertion, runEquipment, runMilitary, wearWeapons } from "./military";
import { runPopulation } from "./population";
import { scratchOf } from "./scratch";
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

describe("equipment and desertion", () => {
  it("takes weapons from the local depot at home, up to one per soldier", () => {
    const world = realmWorld();
    const { weaponsGood } = world.config.military;
    const army = raise(world, 1, 100);
    stateOf(world, 1).depot[weaponsGood] = 60;
    runEquipment(world);
    expect(army.weapons).toBe(60);
    stateOf(world, 1).depot[weaponsGood] = 1000;
    runEquipment(world);
    expect(army.weapons).toBe(100);
    expect(stateOf(world, 1).depot[weaponsGood]).toBe(960);

    // Abroad, nothing is taken.
    army.location = { kind: "area", area: 3 };
    army.weapons = 0;
    areaOf(world, 3).stock[weaponsGood] = 1000;
    runEquipment(world);
    expect(army.weapons).toBe(0);
  });

  /** Gives government 0's areas an average wage, pays its soldiers `soldierWage` and returns an army of 1,000. */
  function paidArmy(averageWage: number, soldierWage: number) {
    const world = realmWorld();
    const army = raise(world, 1, 1000);
    const government = world.governments[0] as World["governments"][number];
    for (const id of government.ownedAreas) areaOf(world, id).averageWage = averageWage;
    government.soldierWage = soldierWage;
    return { world, government, army, rate: 1 - Math.exp(-world.config.military.desertionRatePerDay) };
  }

  it("keeps soldiers paid at least the realm's average wage", () => {
    const { world, government, army } = paidArmy(1.2, 1.2);
    expect(realmAverageWage(world, government)).toBeCloseTo(1.2, 12);
    runDesertion(world);
    expect(army.soldiers).toBe(1000);
  });

  it("loses underpaid soldiers in proportion to the wage shortfall", () => {
    const { world, army, rate } = paidArmy(2, 1);
    const population = areaOf(world, 1).population;
    runDesertion(world);
    expect(army.soldiers).toBeCloseTo(1000 - 1000 * rate * 0.5, 6);
    expect(areaOf(world, 1).population).toBeCloseTo(population + 1000 * rate * 0.5, 6);
  });

  it("loses soldiers left unpaid by a short treasury", () => {
    const { world, army, rate } = paidArmy(1, 3);
    scratchOf(world).paidShare[0] = 0.25;
    runDesertion(world);
    expect(army.soldiers).toBeCloseTo(1000 - 1000 * rate * 0.75, 6);
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
  /**
   * Government 0 at war with 1, with an attacking army of `soldiers`, half equipped, standing in March. The March's
   * militia is left out unless `militia` is set, so armies and sieges are tested alone.
   */
  function invasion(soldiers: number, militia = 0) {
    const world = realmWorld();
    send(world, { type: "declareWar", target: 1 });
    const attacker = raise(world, 1, soldiers);
    attacker.weapons = soldiers / 2;
    attacker.stance = "attack";
    attacker.location = { kind: "area", area: 3 };
    areaOf(world, 3).militia = militia;
    return { world, attacker, march: areaOf(world, 3) };
  }

  it("fights an owned area's militia beside its armies, and besieges only once both fall", () => {
    const { world, attacker, march } = invasion(1000, 200);
    const defender = raise(world, 3, 100, 1);
    defender.weapons = 100;
    const k = world.config.military.combatLethalityPerDay;
    const population = march.population;
    runMilitary(world);
    // Defense: 200 militia (power 1) + 100 equipped soldiers (power 2) = 400 over 300 soldiers.
    expect(attacker.soldiers).toBeCloseTo(1000 - (k * 400) / 1.5, 9);
    const defendersLost = (k * 1500) / (400 / 300);
    expect(march.militia).toBeCloseTo(200 - (defendersLost * 200) / 300, 9);
    expect(defender.soldiers).toBeCloseTo(100 - (defendersLost * 100) / 300, 9);
    expect(march.population).toBeLessThan(population);
    expect(march.besiegingGovernment).toBeNull();

    // Without armies, the militia alone holds the siege off until it falls.
    defender.soldiers = 0.5;
    runMilitary(world); // the army dissolves below one soldier
    expect(march.besiegingGovernment).toBeNull();
    march.militia = 0.5;
    runMilitary(world);
    expect(march.besiegingGovernment).toBe(0);
  });

  it("refills the militia of every area without attackers", () => {
    const world = realmWorld();
    for (const area of world.areas) area.militia = 0;
    runMilitary(world);
    for (const area of world.areas)
      expect(area.militia).toBeCloseTo(area.population * world.config.military.militiaShare, 9);
  });

  it("follows the Lanchester losses for one tick", () => {
    const { world, attacker } = invasion(1000);
    const defender = raise(world, 3, 400, 1);
    defender.weapons = 400;
    areaOf(world, 3).fortificationLevel = 1;
    areaOf(world, 3).staffing[3] = 1; // the fort runs fully staffed
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
    state.staff[3] = 30; // the fort's staff
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
    expect(Array.from(march.staffing)).toEqual([0, 0, 0, 0]); // idle until the new owner hires staff
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
