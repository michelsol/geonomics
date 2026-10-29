// Values derived from static data, snapshots and the price table.
import {
  type AreaDetail,
  CONSUMER_GROUP_COUNT,
  decodePrice,
  type GovernmentSummary,
  type GovernmentView,
  neutralPolicies,
  type Personality,
  type Point3,
  type Reach,
  type ResolvedPolicies,
  resolveSettings,
  runningLevel,
  type Snapshot,
  type StaticData,
  type StaticEdge,
  shores,
  sphericalMean,
  waterReach,
  withinHops,
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

/**
 * Cost of living in an area: the reference basket of needs at local prices over the same basket at labor values, so
 * 1 when goods cost their labor value. Consumers split each need between its goods as the consumption phase does
 * (specification §4, Consumption), from the public prices, without consumption tax.
 */
export function costOfLiving(data: StaticData, table: Uint16Array, area: number): number {
  let local = 0;
  let reference = 0;
  for (const need of data.needs) {
    let weightSum = 0;
    let weightedPrice = 0;
    for (const good of data.goods) {
      if (good.satisfies?.need !== need.id) continue;
      const unitPrice = Math.max(priceOf(data, table, area, good.id) / good.satisfies.unitsPerGood, 1e-9);
      const weight = good.satisfies.preference * unitPrice ** -need.substitutionElasticity;
      weightSum += weight;
      weightedPrice += weight * unitPrice;
    }
    if (weightSum <= 0) continue;
    local += need.demandPerPersonPerDay * (weightedPrice / weightSum);
    reference += need.demandPerPersonPerDay * need.referenceUnitPrice;
  }
  return reference > 0 ? local / reference : 1;
}

const livingCosts = new WeakMap<Uint16Array, Float32Array>();

/** The cost of living of every area (see costOfLiving), computed once per price table. */
export function costsOfLiving(data: StaticData, table: Uint16Array): Float32Array {
  let costs = livingCosts.get(table);
  if (!costs) {
    costs = new Float32Array(data.areas.length);
    for (let area = 0; area < costs.length; area++) costs[area] = costOfLiving(data, table, area);
    livingCosts.set(table, costs);
  }
  return costs;
}

/**
 * Real net income of every area, per member of the workforce and day: net income over the cost of living, or the net
 * income itself without a price table. NaN for an empty area.
 */
export function realNetIncomes(data: StaticData, snapshot: Snapshot, table: Uint16Array | null): Float32Array {
  const living = table ? costsOfLiving(data, table) : null;
  return Float32Array.from(snapshot.areas.netIncome, (net, area) => net / (living ? (living[area] as number) : 1));
}

/** Lowest, median and highest of some values, leaving out those that are not finite and positive. */
export interface Spread {
  low: number;
  median: number;
  high: number;
}

/** Lowest, median and highest price of a good on the map: the prices layer's scale. */
export function priceSpread(data: StaticData, table: Uint16Array, good: number): Spread | null {
  return spreadOf(Array.from(data.areas, (_, area) => priceOf(data, table, area, good)));
}

export function spreadOf(values: ArrayLike<number>): Spread | null {
  const kept = Array.from(values).filter((value) => Number.isFinite(value) && value > 0);
  if (kept.length === 0) return null;
  kept.sort((a, b) => a - b);
  return {
    low: kept[0] as number,
    median: kept[Math.floor((kept.length - 1) / 2)] as number,
    high: kept[kept.length - 1] as number,
  };
}

/** Population of the player's realm. */
export function realmPopulation(snapshot: Snapshot): number {
  let population = 0;
  for (const area of snapshot.government?.ownedAreas ?? []) population += snapshot.areas.population[area] as number;
  return population;
}

/** Average wage of the player's realm, weighted by population, as the sim's soldier desertion rule uses it. */
export function realmAverageWage(snapshot: Snapshot): number {
  let weighted = 0;
  let population = 0;
  for (const area of snapshot.government?.ownedAreas ?? []) {
    const people = snapshot.areas.population[area] as number;
    weighted += (snapshot.areas.averageWage[area] as number) * people;
    population += people;
  }
  return population > 0 ? weighted / population : 1;
}

const reaches = new WeakMap<Uint8Array, (readonly Reach[])[]>();

/** Per area, the water cells its port reaches and its share of each, from the public port levels (memoized). */
export function reachOf(data: StaticData, snapshot: Snapshot | null): (readonly Reach[])[] | null {
  if (!snapshot || data.waters.length === 0) return null;
  const levels = snapshot.areas.portLevel;
  let reach = reaches.get(levels);
  if (!reach) {
    reach = waterReach(data.waters, levels);
    reaches.set(levels, reach);
  }
  return reach;
}

/** Natural capacity of a good in a water cell at its fullest, in units per day (static data). */
export function waterCapacityMaximum(data: StaticData, water: number, good: number): number {
  return data.waterCapacityMaximum[water * data.goods.length + good] as number;
}

/**
 * Natural capacity of a good in an area at its fullest, in units per day: its land, plus its share of the water cells
 * its port reaches when the snapshot is given.
 */
export function capacityMaximum(data: StaticData, snapshot: Snapshot | null, area: number, good: number): number {
  let capacity = data.naturalCapacityMaximum[area * data.goods.length + good] as number;
  for (const { water, share } of reachOf(data, snapshot)?.[area] ?? []) {
    capacity += share * waterCapacityMaximum(data, water, good);
  }
  return capacity;
}

/** What one more port level would add to an area at sea: the water cells newly reached and their capacity per good. */
export interface PortGain {
  cells: number;
  capacity: Float64Array; // per good, the area's share at full capacity
}

export function portLevelGain(data: StaticData, snapshot: Snapshot, area: number): PortGain {
  const capacity = new Float64Array(data.goods.length);
  const level = snapshot.areas.portLevel[area] as number;
  const shore = shores(data.waters, data.areas.length)[area] ?? [];
  // Ports already reaching each cell, to split the cells the next level adds with them.
  const ports = new Uint16Array(data.waters.length);
  for (const reach of reachOf(data, snapshot) ?? [])
    for (const { water } of reach) ports[water] = (ports[water] as number) + 1;
  let cells = 0;
  for (const [water, hop] of withinHops(data.waters, shore, level + 1)) {
    if (hop !== level + 1) continue;
    cells++;
    for (let g = 0; g < capacity.length; g++)
      capacity[g] = (capacity[g] as number) + waterCapacityMaximum(data, water, g) / ((ports[water] as number) + 1);
  }
  return { cells, capacity };
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
 * What it takes to conquer an area (specification §6, Power, Combat and Siege). Combat follows Lanchester's square
 * law: losses of each side scale with the other's total power over its own power per soldier, so (a/d)·A² − (d/a)·D²
 * stays constant and the attackers win exactly when their total power exceeds the defense power.
 */
export function conquestEstimate(data: StaticData, snapshot: Snapshot, area: number): ConquestEstimate {
  const owner = snapshot.areas.owner[area] as number;
  const fortification = runningLevel(snapshot.areas, area, "fort"); // the built level as far as it is staffed
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
  wage: Float64Array; // per good: value added per private worker-day, weighted by private workers
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
    wage: new Float64Array(goods),
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
        result.wage[g] = (result.wage[g] as number) + workers * (detail.wage[g] as number);
        result.privateTotal += workers;
        result.producedPerDay[g] = (result.producedPerDay[g] as number) + (detail.produced[g] as number) / days;
      }
      result.unemployed += detail.unemployedWorkers;
    }
    const state = government.areaStates.find((s) => s.area === area);
    for (const job of state?.jobs ?? []) result.government += job.workers;
    for (const staff of state?.staff ?? []) result.government += staff; // infrastructure staff
  }
  for (let g = 0; g < goods; g++) {
    const workers = result.privateWorkers[g] as number;
    result.wage[g] = workers > 0 ? (result.wage[g] as number) / workers : 0;
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

/** What the transport flows show: the selected good's units carried per day, once a snapshot carries them. */
export function transportFlows(state: { snapshot: Snapshot | null; selectedGood: number }): {
  flows: Float32Array | null;
  good: number;
} {
  return { flows: state.snapshot?.edges.goodFlow ?? null, good: state.selectedGood };
}

/** One arrow between two groups of areas: realms, or the neutral areas together. */
export interface GroupFlow {
  from: Point;
  to: Point;
  flow: number; // per day
}

const NEUTRAL = -1;

/**
 * Edge flows summed across each border into one arrow per pair of groups: every realm, and the neutral areas as one
 * group. Transport keeps each direction apart; migration nets into one arrow toward the group that gains people.
 * A realm's arrows start and end at its capital, or at the population-weighted center of its areas without one; the
 * neutral group's at the population-weighted center of the neutral areas.
 */
export function realmFlows(
  data: StaticData,
  snapshot: Snapshot,
  edges: readonly StaticEdge[],
  governments: readonly GovernmentSummary[],
  kind: "migration" | "transport",
): GroupFlow[] {
  const owner = snapshot.areas.owner;
  const groupOf = (area: number) => owner[area] ?? NEUTRAL;
  const totals = new Map<number, number>(); // keyed by (from + 1) * 65536 + (to + 1)
  const add = (from: number, to: number, flow: number) => {
    if (flow === 0 || from === to) return;
    const key = (from + 1) * 65536 + (to + 1);
    totals.set(key, (totals.get(key) ?? 0) + flow);
  };
  if (kind === "migration") {
    const migration = snapshot.edges.migration;
    for (let e = 0; e < Math.min(edges.length, migration.length); e++) {
      const edge = edges[e] as StaticEdge;
      const a = groupOf(edge.areaA);
      const b = groupOf(edge.areaB);
      // Signed migrants from A to B, gathered under the pair's lower group first so both ways net out.
      if (a < b) add(a, b, migration[e] as number);
      else add(b, a, -(migration[e] as number));
    }
  } else {
    const flows = snapshot.edges.goodFlow;
    if (!flows) return [];
    for (let e = 0; e < Math.min(edges.length, flows.length / 2); e++) {
      const edge = edges[e] as StaticEdge;
      add(groupOf(edge.areaA), groupOf(edge.areaB), flows[2 * e] as number);
      add(groupOf(edge.areaB), groupOf(edge.areaA), flows[2 * e + 1] as number);
    }
  }
  if (totals.size === 0) return [];

  // Anchors: capitals, else population-weighted centers.
  const members = new Map<number, { points: Point[]; people: number[] }>();
  for (const [id, area] of data.areas.entries()) {
    const group = groupOf(id);
    const entry = members.get(group) ?? { points: [], people: [] };
    entry.points.push(area);
    entry.people.push(Math.max(snapshot.areas.population[id] as number, 1e-9));
    members.set(group, entry);
  }
  const anchor = (group: number): Point => {
    const capital = group === NEUTRAL ? null : (governments[group]?.capital ?? null);
    const at = capital === null ? undefined : data.areas[capital];
    if (at) return { x: at.x, y: at.y, z: at.z };
    const entry = members.get(group);
    return entry ? centerOf(data, entry.points, entry.people) : { x: 0, y: 0, z: 0 };
  };

  const result: GroupFlow[] = [];
  for (const [key, total] of totals) {
    const from = Math.floor(key / 65536) - 1;
    const to = (key % 65536) - 1;
    if (total > 0) result.push({ from: anchor(from), to: anchor(to), flow: total });
    else if (total < 0) result.push({ from: anchor(to), to: anchor(from), flow: -total });
  }
  return result;
}

/** Policies in force in one of the government's areas, resolved from its settings as the host does. */
export function policiesInForce(government: GovernmentView, area: number, goodCount: number): ResolvedPolicies | null {
  const state = government.areaStates.find((s) => s.area === area);
  if (!state) return null;
  const resolved = neutralPolicies(goodCount);
  resolveSettings(resolved, government.realmPolicies, state.policyOverrides);
  return resolved;
}

export type Point = Point3;

/** Areas whose center lies within `radius` km of a point, in a straight line. */
export function areasNear(data: StaticData, point: Point, radius: number): number[] {
  const near: number[] = [];
  for (const [id, area] of data.areas.entries()) {
    if ((area.x - point.x) ** 2 + (area.y - point.y) ** 2 + (area.z - point.z) ** 2 <= radius * radius) near.push(id);
  }
  return near;
}

/**
 * The center of some points, weighted: on a spherical map, the point of the sphere in their mean direction; on a
 * hand-built one, their mean.
 */
export function centerOf(data: Pick<StaticData, "map">, points: readonly Point[], weights?: readonly number[]): Point {
  if (data.map) return sphericalMean(points, data.map.radius, weights);
  let x = 0;
  let y = 0;
  let z = 0;
  let total = 0;
  for (const [i, p] of points.entries()) {
    const w = weights?.[i] ?? 1;
    x += w * p.x;
    y += w * p.y;
    z += w * p.z;
    total += w;
  }
  return total > 0 ? { x: x / total, y: y / total, z: z / total } : { x: 0, y: 0, z: 0 };
}

/** What the player's actions apply to (specification §9, Selection). */
export interface ActionTarget {
  /** True when nothing or all of the player's areas are selected: the actions are realm-wide. */
  realm: boolean;
  /** The player's selected areas, or all of them for the realm; none when only others' areas are selected. */
  areas: number[];
}

export function actionTarget(government: GovernmentView, selection: readonly number[]): ActionTarget {
  const owned = new Set(government.ownedAreas);
  const own = selection.filter((area) => owned.has(area));
  if (selection.length > 0 && own.length === 0) return { realm: false, areas: [] };
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
  // Means weighted by population over the areas with a workforce, per member of the workforce and day, in man-hours
  grossIncome: number;
  netIncome: number;
  realNetIncome: number; // net income over the cost of living; the net income itself without a price table
  costOfLiving: number | null; // null without a price table
  satisfaction: number;
  necessitySatisfaction: number;
  militia: number;
  withDetail: number; // areas whose stocks and flows the snapshot carries
  detailPopulation: number; // people in the areas with detail
  savings: number; // over the areas with detail
  unemployed: number;
  capacity: Float64Array; // per good: maximum natural capacity, land and reached waters, summed
  capacityNow: Float64Array; // per good: natural capacity left after depletion, over the areas with detail
  extracted: Float64Array; // per good: primary output per day, over the areas with detail
  market: MarketRow[]; // per good
}

/** Totals and population-weighted means over several areas (specification §9, Selection). */
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
  let earning = 0; // people in the areas with a workforce
  let gross = 0;
  let net = 0;
  let realNet = 0;
  let living = 0;
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
    const areaNet = snapshot.areas.netIncome[area] as number;
    const areaLiving = table ? costOfLiving(data, table, area) : 1;
    if (Number.isFinite(areaNet)) {
      earning += people;
      gross += people * (snapshot.areas.grossIncome[area] as number);
      net += people * areaNet;
      realNet += (people * areaNet) / areaLiving;
    }
    living += people * areaLiving;
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
      capacity[g] = (capacity[g] as number) + capacityMaximum(data, snapshot, area, g);
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
  const perEarner = earning > 0 ? 1 / earning : 0;
  return {
    areas: areas.length,
    owners: [...owners].map(([owner, n]) => ({ owner, areas: n })).sort((a, b) => b.areas - a.areas),
    population,
    grossIncome: gross * perEarner,
    netIncome: net * perEarner,
    realNetIncome: realNet * perEarner,
    costOfLiving: table && population > 0 ? living * weight : null,
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

/** Population and its movements over some areas (specification §9, Population panel), in people per day. */
export interface Demography {
  population: number;
  births: number;
  deaths: number; // people lost where necessities run short
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
    result.population += people;
    result.births += snapshot.areas.births[area] as number;
    result.deaths += snapshot.areas.deaths[area] as number;
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

/** One consumer group over some areas: its people, and the share of its necessities met. */
export interface ConsumerGroup {
  people: number;
  necessitiesMet: number; // weighted by people; NaN with nobody in the group
}

/** The consumer groups (the wage bands, then the unemployed) over some areas, from public figures. */
export function consumerGroupsOf(snapshot: Snapshot, areas: readonly number[]): ConsumerGroup[] {
  const groups = Array.from({ length: CONSUMER_GROUP_COUNT }, () => ({ people: 0, necessitiesMet: 0 }));
  for (const area of areas) {
    const population = snapshot.areas.population[area] as number;
    for (let g = 0; g < CONSUMER_GROUP_COUNT; g++) {
      const group = groups[g] as ConsumerGroup;
      const people = population * (snapshot.areas.groupShare[area * CONSUMER_GROUP_COUNT + g] as number);
      group.people += people;
      group.necessitiesMet += people * (snapshot.areas.groupNecessityMet[area * CONSUMER_GROUP_COUNT + g] as number);
    }
  }
  for (const group of groups)
    group.necessitiesMet = group.people > 0 ? group.necessitiesMet / group.people : Number.NaN;
  return groups;
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

/** One realm's public figures at the end of a session (specification §9, Screens). */
export interface RealmResult {
  id: number;
  name: string;
  color: string;
  areas: number;
  population: number;
  peakPopulation: number;
  realNetIncome: number; // per member of the workforce and day, weighted by population; nominal without a price table
  necessitySatisfaction: number; // weighted by population
  soldiers: number; // in the realm's armies
  eliminated: boolean;
  ai: boolean;
  personality: Personality;
}

/** Every realm's public figures, the largest population first and fallen realms last. */
export function realmResults(
  data: StaticData,
  snapshot: Snapshot,
  table: Uint16Array | null,
  peaks: readonly number[],
): RealmResult[] {
  const living = table ? costsOfLiving(data, table) : null;
  const results: RealmResult[] = snapshot.governments.map((government) => ({
    id: government.id,
    name: government.name,
    color: government.color,
    areas: 0,
    population: 0,
    peakPopulation: Math.max(peaks[government.id] ?? 0, government.population),
    realNetIncome: 0,
    necessitySatisfaction: 0,
    soldiers: 0,
    eliminated: government.isEliminated,
    ai: government.ai,
    personality: government.personality,
  }));
  const { owner, population, netIncome, necessitySatisfaction } = snapshot.areas;
  for (let area = 0; area < owner.length; area++) {
    const result = results[owner[area] as number];
    if (!result) continue;
    const people = population[area] as number;
    result.areas++;
    result.population += people;
    const net = netIncome[area] as number;
    if (Number.isFinite(net)) result.realNetIncome += (people * net) / (living ? (living[area] as number) : 1);
    result.necessitySatisfaction += people * (necessitySatisfaction[area] as number);
  }
  for (const army of snapshot.armies) {
    const result = results[army.owner];
    if (result) result.soldiers += army.soldiers;
  }
  for (const result of results) {
    if (result.population <= 0) continue;
    result.realNetIncome /= result.population;
    result.necessitySatisfaction /= result.population;
  }
  return results.sort((a, b) => Number(a.eliminated) - Number(b.eliminated) || b.population - a.population);
}
