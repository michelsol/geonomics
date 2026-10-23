// Values derived from static data, snapshots and the price table.
import { type AreaDetail, decodePrice, type GovernmentView, type Snapshot, type StaticData } from "@geonomics/sim";

/** Price of a good in an area from the public price table. */
export function priceOf(data: StaticData, table: Uint16Array, area: number, good: number): number {
  const goods = data.goods.length;
  return decodePrice(
    table[area * goods + good] as number,
    (data.goods[good] as StaticData["goods"][number]).laborValue,
    data.config,
  );
}

export interface PricePoint {
  area: number;
  price: number;
}

export interface PriceExtremes {
  low: PricePoint;
  median: PricePoint;
  high: PricePoint;
}

/** Lowest, median and highest price of a good across all areas, with the areas where they occur. */
export function priceExtremes(data: StaticData, table: Uint16Array, good: number): PriceExtremes {
  const goods = data.goods.length;
  const areas = data.areas.length;
  const order = Array.from({ length: areas }, (_, i) => i);
  order.sort((a, b) => (table[a * goods + good] as number) - (table[b * goods + good] as number) || a - b);
  const point = (area: number): PricePoint => ({ area, price: priceOf(data, table, area, good) });
  return {
    low: point(order[0] as number),
    median: point(order[Math.floor((areas - 1) / 2)] as number),
    high: point(order[areas - 1] as number),
  };
}

/** Stocks and flows of an area, when the snapshot carries them (own areas and their neighbors). */
export function detailOf(snapshot: Snapshot | null, area: number): AreaDetail | undefined {
  return snapshot?.detail.find((detail) => detail.area === area);
}

/** Population of the player's realm. */
export function realmPopulation(snapshot: Snapshot): number {
  let population = 0;
  for (const area of snapshot.government?.ownedAreas ?? []) population += snapshot.areas.population[area] as number;
  return population;
}

/** Average wage level of the player's realm, weighted by population, as the sim's soldier desertion rule uses it. */
export function realmWageLevel(snapshot: Snapshot): number {
  let weighted = 0;
  let population = 0;
  for (const area of snapshot.government?.ownedAreas ?? []) {
    const people = snapshot.areas.population[area] as number;
    weighted += (snapshot.areas.wageLevel[area] as number) * people;
    population += people;
  }
  return population > 0 ? weighted / population : 1;
}

/** Natural capacity of a good in an area at its fullest, in units per day (static data). */
export function capacityMaximum(data: StaticData, area: number, good: number): number {
  return data.naturalCapacityMaximum[area * data.goods.length + good] as number;
}

export interface ConquestEstimate {
  militia: number; // the area's militia, unequipped (power 1 each)
  armyPower: number; // power of the owner's armies standing in the area
  fortification: number;
  defensePower: number; // (militia + army power) × (1 + fortification)
  equippedNeeded: number; // equipped soldiers (power 2) whose power just matches the defense
  unequippedNeeded: number; // unequipped soldiers (power 1) whose power just matches the defense
  siegeDaysPer1000Equipped: number; // days a siege takes with 1,000 equipped soldiers, once the defenders fall
}

/**
 * What it takes to conquer an area (specification §7, Power, Combat and Siege). Combat follows Lanchester's square
 * law: losses of each side scale with the other's total power over its own power per soldier, so (a/d)·A² − (d/a)·D²
 * stays constant and the attackers win exactly when their total power exceeds the defense power.
 */
export function conquestEstimate(data: StaticData, snapshot: Snapshot, area: number): ConquestEstimate {
  const owner = snapshot.areas.owner[area] as number;
  const fortification = snapshot.areas.fortificationLevel[area] as number;
  const militia = snapshot.areas.militia[area] as number;
  let armyPower = 0;
  for (const army of snapshot.armies) {
    if (army.owner !== owner || army.location.kind !== "area" || army.location.area !== area) continue;
    armyPower += army.soldiers * (1 + Math.min(1, army.weapons / Math.max(army.soldiers, 1e-9)));
  }
  const defensePower = (militia + armyPower) * (1 + fortification);
  const { siegeRatePerDay } = data.config.military;
  const { militaryResponsiveness } = data.config.pace;
  const population = Math.max(snapshot.areas.population[area] as number, 1);
  return {
    militia,
    armyPower,
    fortification,
    defensePower,
    equippedNeeded: defensePower / 2,
    unequippedNeeded: defensePower,
    siegeDaysPer1000Equipped: ((1 + fortification) * population) / (siegeRatePerDay * militaryResponsiveness * 2000),
  };
}

export interface Employment {
  privateWorkers: Float64Array; // per good
  producedPerDay: Float64Array; // per good, private and government output
  privateTotal: number;
  government: number;
  unemployed: number;
}

/** Who works at what in some of the player's areas, from the snapshot's area details and government jobs. */
export function employmentOf(
  data: StaticData,
  snapshot: Snapshot,
  government: GovernmentView,
  areas: readonly number[],
): Employment {
  const goods = data.goods.length;
  const result: Employment = {
    privateWorkers: new Float64Array(goods),
    producedPerDay: new Float64Array(goods),
    privateTotal: 0,
    government: 0,
    unemployed: 0,
  };
  const days = data.config.pace.gameDaysPerTick;
  for (const area of areas) {
    const detail = detailOf(snapshot, area);
    if (detail) {
      for (let g = 0; g < goods; g++) {
        const workers = detail.privateWorkers[g] as number;
        result.privateWorkers[g] = (result.privateWorkers[g] as number) + workers;
        result.privateTotal += workers;
        result.producedPerDay[g] = (result.producedPerDay[g] as number) + (detail.produced[g] as number) / days;
      }
      result.unemployed += detail.unemployedWorkers;
    }
    const state = government.areaStates.find((s) => s.area === area);
    for (const job of state?.jobs ?? []) result.government += job.workers;
  }
  return result;
}

/** Smallest and largest population of an inhabited area on the map. */
export function populationRange(snapshot: Snapshot): { smallest: number; largest: number } {
  let smallest = Number.POSITIVE_INFINITY;
  let largest = 0;
  for (const population of snapshot.areas.population) {
    if (population <= 0) continue;
    smallest = Math.min(smallest, population);
    largest = Math.max(largest, population);
  }
  return { smallest: Number.isFinite(smallest) ? smallest : 0, largest };
}

/** Largest flow in an array of edge flows, whatever its sign. */
export function flowMaximum(flows: ArrayLike<number>): number {
  let maximum = 0;
  for (let i = 0; i < flows.length; i++) maximum = Math.max(maximum, Math.abs(flows[i] as number));
  return maximum;
}

/** What the transport layer shows: one good's units per day, or every good's tonnes per day. */
export function transportFlows(state: {
  snapshot: Snapshot | null;
  transportAllGoods: boolean;
  selectedGood: number;
}): { flows: Float32Array | null; good: number | null } {
  const edges = state.snapshot?.edges;
  if (!edges) return { flows: null, good: null };
  if (state.transportAllGoods) return { flows: edges.tonnage, good: null };
  return { flows: edges.goodFlow, good: state.selectedGood };
}
