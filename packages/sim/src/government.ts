// Governments: founding, ownership, captures and policy resolution (specifications §6 and §7).
import { disbandArmy } from "./army";
import { MinHeap } from "./heap";
import { INFRASTRUCTURE_KINDS, levelOf } from "./infrastructure";
import { nextRandom } from "./random";
import { placeStartingInfrastructure, updateRouteCapacities } from "./tick/infrastructure";
import type {
  AiMix,
  Area,
  AreaId,
  Edge,
  Government,
  GovernmentAreaState,
  GovernmentController,
  GovernmentId,
  Personality,
  PolicySetting,
  ResolvedPolicies,
  World,
} from "./types";

const REALM_COLORS = [
  "#d1495b",
  "#2e86ab",
  "#edae49",
  "#66a182",
  "#8d6cab",
  "#e07a5f",
  "#3d5a80",
  "#a8763e",
  "#4fb3bf",
  "#c25b9e",
  "#9bc53d",
  "#e9d758",
];

export interface GovernmentInit {
  capital: AreaId;
  areas?: AreaId[]; // owned areas; defaults to the capital alone
  name?: string; // defaults to the capital's name
  color?: string;
  controller?: GovernmentController; // defaults to the AI
  personality?: Personality; // defaults to idle, an AI that never acts
  treasury?: number; // defaults to startingTreasuryDays of the realm's income
}

/** Creates a government owning the given areas, at peace with everyone. */
export function createGovernment(world: World, init: GovernmentInit): Government {
  const id = world.governments.length;
  const capital = world.areas[init.capital] as Area;
  const government: Government = {
    id,
    name: init.name ?? capital.name,
    color: init.color ?? (REALM_COLORS[id % REALM_COLORS.length] as string),
    controller: init.controller ?? { kind: "ai" },
    personality: init.personality ?? "idle",
    aiMemory: null,
    capital: capital.id,
    isEliminated: false,
    treasury: 0,
    ownedAreas: [],
    areaStates: new Map(),
    realmPolicies: [],
    marketOrders: [],
    standingOrders: [],
    soldierWage: world.config.military.soldierWage,
  };
  world.governments.push(government);
  for (const row of world.relations) row.push("peace");
  world.relations.push(Array.from({ length: id + 1 }, () => "peace"));
  for (const area of new Set([capital.id, ...(init.areas ?? [])])) setOwner(world, world.areas[area] as Area, id);
  government.treasury = init.treasury ?? world.config.government.startingTreasuryDays * realmIncomePerDay(world, id);
  return government;
}

/**
 * Founds one government per capital and splits the whole map between them: each area joins the capital nearest by
 * travel distance over active land and sea edges (ties to the earlier capital), and an area with no such path joins
 * the capital nearest in a straight line. Neighboring realms get different colors where the palette allows. Then
 * each realm gets its starting ports and airports (see placeStartingInfrastructure).
 */
export function foundGovernments(world: World, capitals: readonly AreaId[], mix: AiMix = "balanced"): Government[] {
  const realmOf = nearestCapitals(world, capitals);
  const realms = capitals.map((): AreaId[] => []);
  for (const area of world.areas) realms[realmOf[area.id] as number]?.push(area.id);
  const colors = realmColors(world, realmOf, capitals.length);
  const personalities = aiPersonalities(world, mix, capitals.length);
  const governments = capitals.map((capital, i) =>
    createGovernment(world, {
      capital,
      areas: realms[i] as AreaId[],
      color: colors[i] as string,
      personality: personalities[i] as Personality,
    }),
  );
  placeStartingInfrastructure(world);
  return governments;
}

const MIXES: Record<AiMix, readonly Personality[]> = {
  balanced: ["trader", "builder", "conqueror"],
  peaceful: ["trader", "builder"],
  aggressive: ["conqueror", "trader", "conqueror", "builder"],
};

/** Personalities for `count` realms in the mix's proportions, in a seeded order (specification §11). */
export function aiPersonalities(world: World, mix: AiMix, count: number): Personality[] {
  const pattern = MIXES[mix];
  const personalities = Array.from({ length: count }, (_, i) => pattern[i % pattern.length] as Personality);
  for (let i = count - 1; i > 0; i--) {
    const j = Math.floor(nextRandom(world) * (i + 1));
    [personalities[i], personalities[j]] = [personalities[j] as Personality, personalities[i] as Personality];
  }
  return personalities;
}

/** For each area, the index in `capitals` of the capital it belongs to (see foundGovernments). */
function nearestCapitals(world: World, capitals: readonly AreaId[]): Int32Array {
  const n = world.areas.length;
  const distance = new Float64Array(n).fill(Number.POSITIVE_INFINITY);
  const realmOf = new Int32Array(n).fill(-1);
  const heap = new MinHeap();
  capitals.forEach((capital, i) => {
    if (realmOf[capital] !== -1) return;
    distance[capital] = 0;
    realmOf[capital] = i;
    heap.push(0, capital);
  });
  while (heap.size > 0) {
    const [d, current] = heap.pop();
    if (d > (distance[current] as number)) continue;
    const realm = realmOf[current] as number;
    for (const id of (world.areas[current] as Area).edges) {
      const edge = world.edges[id] as Edge;
      if (!edge.isActive || edge.mode === "air") continue;
      const other = edge.areaA === current ? edge.areaB : edge.areaA;
      const next = d + edge.distance;
      const known = distance[other] as number;
      if (next < known || (next === known && realm < (realmOf[other] as number))) {
        distance[other] = next;
        realmOf[other] = realm;
        heap.push(next, other);
      }
    }
  }
  for (const area of world.areas) {
    if (realmOf[area.id] !== -1) continue;
    let best = 0;
    let bestDistance = Number.POSITIVE_INFINITY;
    capitals.forEach((capital, i) => {
      const c = world.areas[capital] as Area;
      const d = Math.hypot(c.position.x - area.position.x, c.position.y - area.position.y);
      if (d < bestDistance) {
        best = i;
        bestDistance = d;
      }
    });
    realmOf[area.id] = best;
  }
  return realmOf;
}

/** Colors realms in order, each with the palette color least used by its neighbors, then least used overall. */
function realmColors(world: World, realmOf: Int32Array, count: number): string[] {
  const neighbors = Array.from({ length: count }, () => new Set<number>());
  for (const edge of world.edges) {
    if (!edge.isActive || edge.mode === "air") continue;
    const a = realmOf[edge.areaA] as number;
    const b = realmOf[edge.areaB] as number;
    if (a === b) continue;
    neighbors[a]?.add(b);
    neighbors[b]?.add(a);
  }
  const chosen: number[] = [];
  const uses = new Array<number>(REALM_COLORS.length).fill(0);
  for (let realm = 0; realm < count; realm++) {
    const nearby = new Array<number>(REALM_COLORS.length).fill(0);
    for (const other of neighbors[realm] ?? []) {
      const c = chosen[other];
      if (other < realm && c !== undefined) nearby[c] = (nearby[c] as number) + 1;
    }
    let best = 0;
    for (let c = 1; c < REALM_COLORS.length; c++) {
      const better =
        (nearby[c] as number) < (nearby[best] as number) ||
        ((nearby[c] as number) === (nearby[best] as number) && (uses[c] as number) < (uses[best] as number));
      if (better) best = c;
    }
    chosen.push(best);
    uses[best] = (uses[best] as number) + 1;
  }
  return chosen.map((c) => REALM_COLORS[c] as string);
}

/** Income of a realm's inhabitants per game day, in man-hours. */
export function realmIncomePerDay(world: World, government: GovernmentId): number {
  const e = world.config.economy;
  let income = 0;
  for (const id of (world.governments[government] as Government).ownedAreas) {
    const area = world.areas[id] as Area;
    income += area.population * e.workforceShare * e.hoursPerWorkerDay * Math.max(area.wageLevel, 0.1);
  }
  return income;
}

/**
 * A fresh state for a newly owned area: empty depot, no jobs, the reference wage, no overrides, no staff yet, and the
 * built infrastructure as its target.
 */
export function createAreaState(world: World, area: Area): GovernmentAreaState {
  return {
    depot: new Float64Array(world.goods.length),
    jobs: [],
    wageOffer: 1,
    targetLevel: Uint8Array.from(INFRASTRUCTURE_KINDS, (kind) => levelOf(area, kind)),
    buildDays: new Float64Array(INFRASTRUCTURE_KINDS.length),
    staff: new Float64Array(INFRASTRUCTURE_KINDS.length),
    policyOverrides: [],
    resolvedPolicies: neutralPolicies(world.goods.length),
  };
}

/**
 * Changes an area's owner: updates the owned-area caches and gives the new owner a fresh area state with its realm
 * policies. The old owner's state is dropped; captures handle its depot, jobs and staff first.
 */
export function setOwner(world: World, area: Area, owner: GovernmentId | null): void {
  if (area.owner === owner) return;
  if (area.owner !== null) {
    const previous = world.governments[area.owner] as Government;
    previous.ownedAreas = previous.ownedAreas.filter((id) => id !== area.id);
    previous.areaStates.delete(area.id);
  }
  area.owner = owner;
  area.staffing.fill(0); // nobody runs the infrastructure until the new owner hires staff
  if (owner === null) return;
  const government = world.governments[owner] as Government;
  government.ownedAreas.push(area.id);
  government.ownedAreas.sort((a, b) => a - b);
  government.areaStates.set(area.id, createAreaState(world, area));
  resolvePolicies(government, area.id);
}

export function neutralPolicies(goodCount: number): ResolvedPolicies {
  return {
    productionTaxRate: new Float64Array(goodCount),
    consumptionTaxRate: new Float64Array(goodCount),
    importTariffRate: new Float64Array(goodCount),
    exportTariffRate: new Float64Array(goodCount),
    headTaxPerPersonPerDay: 0,
    staffWageShare: null,
    priceCeiling: new Float64Array(goodCount).fill(Number.POSITIVE_INFINITY),
    priceFloor: new Float64Array(goodCount),
  };
}

/**
 * Merges the realm policies, then the area's overrides, into the area's resolved policies. Within each, a setting for
 * every good (good null) applies before the settings for one good, so the more specific one wins.
 */
export function resolvePolicies(government: Government, area: AreaId): void {
  const state = government.areaStates.get(area);
  if (state) resolveSettings(state.resolvedPolicies, government.realmPolicies, state.policyOverrides);
}

/**
 * Writes into `resolved` the policies in force from realm settings and area overrides, as resolvePolicies does. Also
 * used by clients, which receive the settings but not their resolution.
 */
export function resolveSettings(
  resolved: ResolvedPolicies,
  realmPolicies: readonly PolicySetting[],
  overrides: readonly PolicySetting[],
): void {
  resolved.productionTaxRate.fill(0);
  resolved.consumptionTaxRate.fill(0);
  resolved.importTariffRate.fill(0);
  resolved.exportTariffRate.fill(0);
  resolved.headTaxPerPersonPerDay = 0;
  resolved.staffWageShare = null;
  resolved.priceCeiling.fill(Number.POSITIVE_INFINITY);
  resolved.priceFloor.fill(0);
  for (const settings of [realmPolicies, overrides]) {
    for (const setting of settings) if (setting.good === null) applySetting(resolved, setting);
    for (const setting of settings) if (setting.good !== null) applySetting(resolved, setting);
  }
}

/** A null value restores the neutral value: no tax, no ceiling, no floor, the default staff wage. */
function applySetting(resolved: ResolvedPolicies, setting: PolicySetting): void {
  const { value } = setting;
  if (setting.policy === "headTaxPerPersonPerDay") {
    resolved.headTaxPerPersonPerDay = value ?? 0;
    return;
  }
  if (setting.policy === "staffWageShare") {
    resolved.staffWageShare = value;
    return;
  }
  const neutral = setting.policy === "priceCeiling" ? Number.POSITIVE_INFINITY : 0;
  if (setting.good === null) resolved[setting.policy].fill(value ?? neutral);
  else resolved[setting.policy][setting.good] = value ?? neutral;
}

/** Replaces the setting of the same policy and good, or appends it. */
export function upsertSetting(settings: PolicySetting[], setting: PolicySetting): void {
  const index = settings.findIndex((s) => s.policy === setting.policy && s.good === setting.good);
  const copy = { policy: setting.policy, good: setting.good, value: setting.value };
  if (index >= 0) settings[index] = copy;
  else settings.push(copy);
}

/**
 * Hands an area to a new owner after a capture or a peace treaty: its fortification level drops by one, the old
 * owner's jobs and staff end and their workers become unemployed, its construction stops, its depot passes to the new
 * owner and its orders on the area are cancelled. The infrastructure stands idle until the new owner staffs it.
 * Unless `settle` is false, the old owner's capital then moves if needed (see settleRealm).
 */
export function transferArea(world: World, area: Area, newOwner: GovernmentId, settle = true): void {
  const previous = area.owner === null ? undefined : world.governments[area.owner];
  const state = previous?.areaStates.get(area.id);
  area.fortificationLevel = Math.max(0, area.fortificationLevel - 1);
  area.siegeProgress = 0;
  area.besiegingGovernment = null;
  area.militia = 0;
  if (state) {
    for (const job of state.jobs) area.unemployedWorkers += job.workers;
    for (const staff of state.staff) area.unemployedWorkers += staff;
  }
  setOwner(world, area, newOwner);
  updateRouteCapacities(world, area);
  const depot = world.governments[newOwner]?.areaStates.get(area.id)?.depot as Float64Array;
  if (state) for (let g = 0; g < depot.length; g++) depot[g] = (depot[g] as number) + (state.depot[g] as number);
  if (!previous) return;
  previous.marketOrders = previous.marketOrders.filter((order) => order.area !== area.id);
  if (settle) settleRealm(world, previous);
}

/**
 * After areas changed hands: a government that lost its capital moves it to its most populous remaining area, and
 * one with no area left is eliminated. Peace treaties settle once all their transfers are applied.
 */
export function settleRealm(world: World, government: Government): void {
  if (government.isEliminated) return;
  if (government.ownedAreas.length === 0) {
    eliminate(world, government);
    return;
  }
  if (government.capital !== null && government.areaStates.has(government.capital)) return;
  const remaining = government.ownedAreas.map((id) => world.areas[id] as Area);
  remaining.sort((a, b) => b.population - a.population || a.id - b.id);
  government.capital = (remaining[0] as Area).id;
}

/** A government with no area left is eliminated: its armies disband where they stand and its orders end. */
export function eliminate(world: World, government: Government): void {
  government.isEliminated = true;
  government.capital = null;
  for (const army of [...world.armies.values()]) if (army.owner === government.id) disbandArmy(world, army);
  government.marketOrders = [];
  government.standingOrders = [];
  world.peaceProposals = world.peaceProposals.filter((p) => p.from !== government.id && p.to !== government.id);
}
