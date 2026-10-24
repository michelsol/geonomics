// Values derived from static data, snapshots and the price table.
import {
  type AreaDetail,
  decodePrice,
  type GovernmentView,
  neutralPolicies,
  type ResolvedPolicies,
  resolveSettings,
  type Snapshot,
  type StaticData,
  type StaticEdge,
} from "@geonomics/sim";

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

/** Population of the most populous area on the map. */
export function largestPopulation(snapshot: Snapshot): number {
  let largest = 0;
  for (const population of snapshot.areas.population) largest = Math.max(largest, population);
  return largest;
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

/** Policies in force in one of the government's areas, resolved from its settings as the host does. */
export function policiesInForce(government: GovernmentView, area: number, goodCount: number): ResolvedPolicies | null {
  const state = government.areaStates.find((s) => s.area === area);
  if (!state) return null;
  const resolved = neutralPolicies(goodCount);
  resolveSettings(resolved, government.realmPolicies, state.policyOverrides);
  return resolved;
}

export interface Point {
  x: number;
  y: number;
}

/** Areas whose center lies within `radius` of a point, in map units. */
export function areasNear(data: StaticData, point: Point, radius: number): number[] {
  const near: number[] = [];
  for (const [id, area] of data.areas.entries()) {
    if ((area.x - point.x) ** 2 + (area.y - point.y) ** 2 <= radius * radius) near.push(id);
  }
  return near;
}

/** What the player's actions apply to (specification §10, Selection). */
export interface ActionTarget {
  /** True when none or all of the player's areas are selected: the actions are realm-wide. */
  realm: boolean;
  /** The player's selected areas, or all of them for the realm. */
  areas: number[];
}

export function actionTarget(government: GovernmentView, selection: readonly number[]): ActionTarget {
  const owned = new Set(government.ownedAreas);
  const own = selection.filter((area) => owned.has(area));
  const realm = own.length === 0 || own.length === owned.size;
  return { realm, areas: realm ? [...government.ownedAreas] : own };
}

/**
 * Splits a whole number over areas in proportion to their population, by largest remainder, so the parts sum to the
 * total exactly. Areas without people get a share only when nobody lives in any of them (then evenly).
 */
export function splitByPopulation(total: number, areas: readonly number[], population: ArrayLike<number>): number[] {
  const whole = Math.max(0, Math.round(total));
  if (areas.length === 0) return [];
  const people = areas.map((area) => Math.max(0, population[area] ?? 0));
  const sum = people.reduce((a, b) => a + b, 0);
  const weights = sum > 0 ? people : areas.map(() => 1);
  const weightSum = sum > 0 ? sum : areas.length;
  const exact = weights.map((w) => (whole * w) / weightSum);
  const parts = exact.map(Math.floor);
  let left = whole - parts.reduce((a, b) => a + b, 0);
  const order = exact.map((value, i) => ({ i, rest: value - Math.floor(value) })).sort((a, b) => b.rest - a.rest);
  for (const { i } of order) {
    if (left <= 0) break;
    parts[i] = (parts[i] as number) + 1;
    left--;
  }
  return parts;
}

export interface MarketRow {
  price: number; // mean price over the areas
  stock: number; // the rest are sums over the areas whose detail the snapshot carries
  made: number;
  used: number;
  trade: number; // net imports: trade between two of the areas cancels out
}

export interface SelectionSummary {
  areas: number;
  owners: { owner: number; areas: number }[]; // -1: neutral; most areas first
  population: number;
  wageLevel: number; // means weighted by population
  satisfaction: number;
  necessitySatisfaction: number;
  militia: number;
  withDetail: number; // areas whose stocks and flows the snapshot carries
  detailPopulation: number; // people in the areas with detail
  savings: number; // over the areas with detail
  unemployed: number;
  capacity: Float64Array; // per good: maximum natural capacity, summed
  capacityNow: Float64Array; // per good: natural capacity left after depletion, over the areas with detail
  extracted: Float64Array; // per good: primary output per day, over the areas with detail
  market: MarketRow[]; // per good
}

/** Totals and population-weighted means over several areas (specification §10, Selection). */
export function selectionSummary(
  data: StaticData,
  snapshot: Snapshot,
  table: Uint16Array | null,
  areas: readonly number[],
): SelectionSummary {
  const goods = data.goods.length;
  const owners = new Map<number, number>();
  const capacity = new Float64Array(goods);
  const capacityNow = new Float64Array(goods);
  const extracted = new Float64Array(goods);
  const days = data.config.pace.gameDaysPerTick;
  const market: MarketRow[] = data.goods.map(() => ({ price: 0, stock: 0, made: 0, used: 0, trade: 0 }));
  let population = 0;
  let wage = 0;
  let satisfaction = 0;
  let necessities = 0;
  let militia = 0;
  let withDetail = 0;
  let detailPopulation = 0;
  let savings = 0;
  let unemployed = 0;
  for (const area of areas) {
    const owner = snapshot.areas.owner[area] as number;
    owners.set(owner, (owners.get(owner) ?? 0) + 1);
    const people = snapshot.areas.population[area] as number;
    population += people;
    wage += people * (snapshot.areas.wageLevel[area] as number);
    satisfaction += people * (snapshot.areas.satisfaction[area] as number);
    necessities += people * (snapshot.areas.necessitySatisfaction[area] as number);
    militia += snapshot.areas.militia[area] as number;
    const detail = detailOf(snapshot, area);
    if (detail) {
      withDetail++;
      detailPopulation += people;
      savings += detail.savings;
      unemployed += detail.unemployedWorkers;
    }
    for (let g = 0; g < goods; g++) {
      capacity[g] = (capacity[g] as number) + capacityMaximum(data, area, g);
      const row = market[g] as MarketRow;
      row.price += detail ? (detail.price[g] as number) : table ? priceOf(data, table, area, g) : 0;
      if (!detail) continue;
      if (data.goods[g]?.isPrimary) {
        capacityNow[g] = (capacityNow[g] as number) + (detail.naturalCapacity[g] as number);
        extracted[g] = (extracted[g] as number) + (detail.produced[g] as number) / days;
      }
      row.stock += detail.stock[g] as number;
      row.made += detail.produced[g] as number;
      row.used += detail.consumed[g] as number;
      row.trade += (detail.imported[g] as number) - (detail.exported[g] as number);
    }
  }
  const count = Math.max(areas.length, 1);
  for (const row of market) row.price /= count;
  const weight = population > 0 ? 1 / population : 0;
  return {
    areas: areas.length,
    owners: [...owners].map(([owner, n]) => ({ owner, areas: n })).sort((a, b) => b.areas - a.areas),
    population,
    wageLevel: wage * weight,
    satisfaction: satisfaction * weight,
    necessitySatisfaction: necessities * weight,
    militia,
    withDetail,
    detailPopulation,
    savings,
    unemployed,
    capacity,
    capacityNow,
    extracted,
    market,
  };
}

/** Mean price of every good over some areas, from the public price table. */
export function meanPrices(data: StaticData, table: Uint16Array, areas: readonly number[]): number[] {
  return data.goods.map((good) => {
    let sum = 0;
    for (const area of areas) sum += priceOf(data, table, area, good.id);
    return areas.length > 0 ? sum / areas.length : 0;
  });
}

/** Population and its movements over some areas (specification §10, Population panel), in people per day. */
export interface Demography {
  population: number;
  births: number; // growth, summed over the areas that grow
  deaths: number; // starvation, summed over the areas that shrink
  immigration: number; // migrants coming in from outside the areas; moves between two of them cancel out
  emigration: number;
  necessitySatisfaction: number; // means weighted by population
  satisfaction: number;
}

/** The channels of a demography series, in order (see History.demography). */
export const DEMOGRAPHY_KEYS = [
  "population",
  "births",
  "deaths",
  "immigration",
  "emigration",
  "necessitySatisfaction",
  "satisfaction",
] as const satisfies readonly (keyof Demography)[];

/** Demography of some areas from public figures: `edges` are every edge the snapshot's flows index. */
export function demographyOf(snapshot: Snapshot, edges: readonly StaticEdge[], areas: readonly number[]): Demography {
  const result: Demography = {
    population: 0,
    births: 0,
    deaths: 0,
    immigration: 0,
    emigration: 0,
    necessitySatisfaction: 0,
    satisfaction: 0,
  };
  const inside = new Set(areas);
  for (const area of areas) {
    const people = snapshot.areas.population[area] as number;
    const change = snapshot.areas.naturalChange[area] as number;
    result.population += people;
    if (change > 0) result.births += change;
    else result.deaths -= change;
    result.necessitySatisfaction += people * (snapshot.areas.necessitySatisfaction[area] as number);
    result.satisfaction += people * (snapshot.areas.satisfaction[area] as number);
  }
  const migration = snapshot.edges.migration;
  const count = Math.min(edges.length, migration.length);
  for (let e = 0; e < count; e++) {
    const migrants = migration[e] as number;
    if (migrants === 0) continue;
    const edge = edges[e] as StaticEdge;
    const from = migrants > 0 ? edge.areaA : edge.areaB;
    const to = migrants > 0 ? edge.areaB : edge.areaA;
    const leaves = inside.has(from);
    if (leaves === inside.has(to)) continue;
    if (leaves) result.emigration += Math.abs(migrants);
    else result.immigration += Math.abs(migrants);
  }
  if (result.population > 0) {
    result.necessitySatisfaction /= result.population;
    result.satisfaction /= result.population;
  }
  return result;
}

/** One need over some areas: what people wanted and got per day, over the areas whose detail the snapshot carries. */
export interface NeedRow {
  demanded: number;
  consumed: number;
}

export function needsOf(
  data: StaticData,
  snapshot: Snapshot,
  areas: readonly number[],
): { rows: NeedRow[]; withDetail: number; detailPopulation: number } {
  const days = data.config.pace.gameDaysPerTick;
  const rows = data.needs.map(() => ({ demanded: 0, consumed: 0 }));
  let withDetail = 0;
  let detailPopulation = 0;
  for (const area of areas) {
    const detail = detailOf(snapshot, area);
    if (!detail) continue;
    withDetail++;
    detailPopulation += snapshot.areas.population[area] as number;
    for (let n = 0; n < rows.length; n++) {
      const row = rows[n] as NeedRow;
      row.demanded += (detail.needDemanded[n] as number) / days;
      row.consumed += (detail.needConsumed[n] as number) / days;
    }
  }
  return { rows, withDetail, detailPopulation };
}
