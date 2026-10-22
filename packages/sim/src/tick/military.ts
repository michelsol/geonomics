// Phases 3 and 8: army upkeep, marching, combat, sieges and captures (specification §7).
import { armyArea, canMarch, disbandArmy } from "../army";
import { transferArea } from "../government";
import { EPSILON, fractionPerTick } from "../math";
import type { Area, Army, Edge, GovernmentId, StandingOrder, World } from "../types";
import { changePopulation } from "./population";

/** Siege progress also falls by this much per day without attackers, so it reaches zero. */
const SIEGE_DECAY_PER_DAY = 0.005;

/**
 * Phase 3, after consumption: armies standing in their own areas refill from the depot as supplyArmies standing
 * orders ask, armies elsewhere forage, then every army eats its carried food. Unfed soldiers desert.
 */
export function runUpkeep(world: World): void {
  const m = world.config.military;
  const { gameDaysPerTick: days, militaryResponsiveness } = world.config.pace;
  const desertion = fractionPerTick(m.desertionRatePerDay, militaryResponsiveness, days);
  for (const army of [...world.armies.values()]) {
    const area = world.areas[armyArea(army)] as Area;
    const eating = m.foodPerSoldierPerDay * army.soldiers * days;
    if (army.location.kind === "area") {
      if (area.owner === army.owner) supplyFromDepot(world, army, area, eating);
      else {
        // Foraging takes what the army needs this tick, up to foragingShare of the area's food stock per day.
        const stock = area.stock[m.foodGood] as number;
        const taken = Math.min(Math.max(0, eating - army.food), stock * Math.min(1, m.foragingShare * days));
        area.stock[m.foodGood] = stock - taken;
        area.consumed[m.foodGood] = (area.consumed[m.foodGood] as number) + taken;
        army.food += taken;
      }
    }
    const eaten = Math.min(army.food, eating);
    army.food -= eaten;
    const unfed = eating > EPSILON ? 1 - eaten / eating : 0;
    if (unfed > EPSILON) {
      const deserters = army.soldiers * desertion * unfed;
      area.population += deserters;
      area.unemployedWorkers += deserters;
      army.soldiers -= deserters;
    }
    if (army.soldiers < 1) disbandArmy(world, army);
  }
}

/** Refills an army from its government's depot, as the supplyArmies standing orders for the area ask. */
function supplyFromDepot(world: World, army: Army, area: Area, eatingPerTick: number): void {
  const government = world.governments[army.owner];
  const depot = government?.areaStates.get(area.id)?.depot;
  if (!government || !depot) return;
  const { foodGood, weaponsGood } = world.config.military;
  const days = world.config.pace.gameDaysPerTick;
  for (const order of government.standingOrders) {
    const { rule } = order;
    if (rule.kind !== "supplyArmies" || !appliesTo(order, area.id)) continue;
    const isFood = rule.good === foodGood;
    const wanted = isFood ? (rule.daysOfSupply * eatingPerTick) / days + eatingPerTick : army.soldiers;
    const carried = isFood ? army.food : army.weapons;
    const loaded = Math.min(Math.max(0, wanted - carried), depot[rule.good] as number);
    depot[rule.good] = (depot[rule.good] as number) - loaded;
    if (rule.good === foodGood) army.food += loaded;
    else if (rule.good === weaponsGood) army.weapons += loaded;
  }
}

const appliesTo = (order: StandingOrder, area: number) => order.areas === "all" || order.areas.includes(area);

/** Phase 10: carried weapons wear out. */
export function wearWeapons(world: World): void {
  const keep = Math.exp(-world.config.military.weaponWearRatePerDay * world.config.pace.gameDaysPerTick);
  for (const army of world.armies.values()) army.weapons *= keep;
}

/** Phase 8: marching, then combat, sieges and captures in every area where armies stand. */
export function runMilitary(world: World): void {
  for (const army of world.armies.values()) march(world, army);

  const present = new Map<number, Army[]>();
  for (const army of world.armies.values()) {
    if (army.location.kind !== "area") continue;
    const list = present.get(army.location.area);
    if (list) list.push(army);
    else present.set(army.location.area, [army]);
  }

  const m = world.config.military;
  for (const area of world.areas) {
    const armies = present.get(area.id);
    const attackers = armies ? armies.filter((army) => attacks(world, army, area)) : undefined;
    if (!armies || !attackers || attackers.length === 0) {
      decaySiege(world, area);
      if (area.owner === null) area.militia = area.population * m.militiaShare;
      continue;
    }
    const defenders = armies.filter((army) => army.owner === area.owner);
    if (defenders.length > 0 || (area.owner === null && area.militia >= 1)) fight(world, area, attackers, defenders);
    else besiege(world, area, attackers);
  }
  for (const army of [...world.armies.values()]) if (army.soldiers < 1) disbandArmy(world, army);
}

/** An army attacks a neutral area, or one owned by a government it is at war with, when in attack stance. */
function attacks(world: World, army: Army, area: Area): boolean {
  if (army.stance !== "attack" || army.soldiers <= 0) return false;
  return area.owner === null || world.relations[army.owner]?.[area.owner] === "war";
}

/**
 * Moves an army along its path by days × militaryResponsiveness, carrying leftover days into the next edge. An army
 * stops when its path ends and when it can no longer embark. An attacking army stays in any area it attacks until
 * the area falls or the war ends, then marches on.
 */
function march(world: World, army: Army): void {
  let budget = world.config.pace.gameDaysPerTick * world.config.pace.militaryResponsiveness;
  while (budget > EPSILON) {
    const location = army.location;
    if (location.kind === "area") {
      const next = army.path[0];
      if (next === undefined || attacks(world, army, world.areas[location.area] as Area)) return;
      const edge = bestEdge(world, army.owner, location.area, next);
      if (!edge) {
        army.path = [];
        return;
      }
      army.location = { kind: "edge", edge: edge.id, from: location.area, daysTravelled: 0 };
      continue;
    }
    const edge = world.edges[location.edge] as Edge;
    const remaining = edge.travelDays - location.daysTravelled;
    if (budget < remaining) {
      location.daysTravelled += budget;
      return;
    }
    budget -= remaining;
    const arrived = edge.areaA === location.from ? edge.areaB : edge.areaA;
    army.location = { kind: "area", area: arrived };
    army.path.shift();
  }
}

/** The fastest edge an army may take between two neighboring areas. */
function bestEdge(world: World, owner: GovernmentId, from: number, to: number): Edge | undefined {
  let best: Edge | undefined;
  for (const id of (world.areas[from] as Area).edges) {
    const edge = world.edges[id] as Edge;
    if ((edge.areaA === to || edge.areaB === to) && canMarch(world, owner, edge, from)) {
      if (!best || edge.travelDays < best.travelDays) best = edge;
    }
  }
  return best;
}

const powerPerSoldier = (army: Army) => 1 + Math.min(1, army.weapons / Math.max(army.soldiers, EPSILON));

/** One tick of Lanchester combat between attackers and the area's defenders (armies of its owner, or militia). */
function fight(world: World, area: Area, attackers: Army[], defenders: Army[]): void {
  const m = world.config.military;
  const { gameDaysPerTick: days, militaryResponsiveness } = world.config.pace;
  const k = m.combatLethalityPerDay * militaryResponsiveness * days;

  let attackSoldiers = 0;
  let attackPower = 0;
  for (const army of attackers) {
    attackSoldiers += army.soldiers;
    attackPower += army.soldiers * powerPerSoldier(army);
  }
  const militia = area.owner === null ? area.militia : 0;
  let defendSoldiers = militia;
  let defendPower = militia; // militia has no equipment
  for (const army of defenders) {
    defendSoldiers += army.soldiers;
    defendPower += army.soldiers * powerPerSoldier(army);
  }
  const defensePower = defendPower * (1 + area.fortificationLevel);
  const attackersLost = Math.min(attackSoldiers, (k * defensePower) / (attackPower / attackSoldiers));
  const defendersLost = Math.min(defendSoldiers, (k * attackPower) / Math.max(defendPower / defendSoldiers, EPSILON));

  for (const army of attackers) army.soldiers -= (attackersLost * army.soldiers) / attackSoldiers;
  for (const army of defenders) army.soldiers -= (defendersLost * army.soldiers) / defendSoldiers;
  if (militia > 0) {
    const militiaLost = (defendersLost * militia) / defendSoldiers;
    area.militia = Math.max(0, militia - militiaLost);
    changePopulation(world, area, -militiaLost);
  }

  // The battle destroys stock and kills civilians.
  const destroyed = fractionPerTick(m.battleStockDestructionPerDay, 1, days);
  for (let g = 0; g < area.stock.length; g++) area.stock[g] = (area.stock[g] as number) * (1 - destroyed);
  changePopulation(world, area, -area.population * fractionPerTick(m.battleCivilianLossPerDay, 1, days));
}

/**
 * With no defender left, the government with the most attack power present besieges the area. Progress restarts
 * when another government takes the lead, and the area changes owner when it reaches 1.
 */
function besiege(world: World, area: Area, attackers: Army[]): void {
  const m = world.config.military;
  const { gameDaysPerTick: days, militaryResponsiveness } = world.config.pace;
  const power = new Map<GovernmentId, number>();
  for (const army of attackers) {
    power.set(army.owner, (power.get(army.owner) ?? 0) + army.soldiers * powerPerSoldier(army));
  }
  let leader = -1;
  let leaderPower = 0;
  for (const [government, value] of power) {
    if (value > leaderPower || (value === leaderPower && government < leader)) {
      leader = government;
      leaderPower = value;
    }
  }
  if (area.besiegingGovernment !== leader) {
    area.besiegingGovernment = leader;
    area.siegeProgress = 0;
  }
  area.siegeProgress +=
    (m.siegeRatePerDay * militaryResponsiveness * days * leaderPower) /
    ((1 + area.fortificationLevel) * Math.max(area.population, 1));
  if (area.siegeProgress >= 1) transferArea(world, area, leader);
}

function decaySiege(world: World, area: Area): void {
  if (area.besiegingGovernment === null) return;
  const { gameDaysPerTick: days, militaryResponsiveness } = world.config.pace;
  const decay = fractionPerTick(world.config.military.siegeDecayRatePerDay, militaryResponsiveness, days);
  area.siegeProgress = Math.max(0, area.siegeProgress * (1 - decay) - SIEGE_DECAY_PER_DAY * days);
  if (area.siegeProgress === 0) area.besiegingGovernment = null;
}
