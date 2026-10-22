// Governments: founding, ownership and policy resolution (specification §6).
import type {
  Area,
  AreaId,
  Edge,
  Government,
  GovernmentAreaState,
  GovernmentController,
  GovernmentId,
  PolicySetting,
  ResolvedPolicies,
  World,
} from "./types";

const REALM_COLORS = ["#d1495b", "#2e86ab", "#edae49", "#66a182", "#8d6cab", "#e07a5f", "#3d5a80", "#a8763e"];

export interface GovernmentInit {
  capital: AreaId;
  areas?: AreaId[]; // owned areas; defaults to the capital alone
  name?: string; // defaults to the capital's name
  color?: string;
  controller?: GovernmentController; // defaults to an idle AI until a player or the AI takes over
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
    controller: init.controller ?? { kind: "ai", personality: "idle" },
    capital: capital.id,
    isEliminated: false,
    treasury: 0,
    ownedAreas: [],
    areaStates: new Map(),
    realmPolicies: [],
    marketOrders: [],
    standingOrders: [],
    depotTransfers: [],
    researchLevel: 0,
    researchProgress: 0,
  };
  world.governments.push(government);
  for (const row of world.relations) row.push("peace");
  world.relations.push(Array.from({ length: id + 1 }, () => "peace"));
  for (const area of new Set([capital.id, ...(init.areas ?? [])])) setOwner(world, world.areas[area] as Area, id);
  government.treasury = init.treasury ?? world.config.government.startingTreasuryDays * realmIncomePerDay(world, id);
  return government;
}

/**
 * Founds one government per capital. Each realm is its capital plus the areas within startingRealmRadius land hops
 * that no earlier government or other capital has claimed.
 */
export function foundGovernments(world: World, capitals: readonly AreaId[]): Government[] {
  const claimed = new Set(capitals);
  return capitals.map((capital) => {
    const realm = [capital];
    let frontier = [capital];
    for (let hop = 0; hop < world.config.government.startingRealmRadius; hop++) {
      const next: AreaId[] = [];
      for (const id of frontier) {
        for (const edgeId of (world.areas[id] as Area).edges) {
          const edge = world.edges[edgeId] as Edge;
          if (edge.mode !== "land") continue;
          const other = edge.areaA === id ? edge.areaB : edge.areaA;
          if (claimed.has(other)) continue;
          claimed.add(other);
          realm.push(other);
          next.push(other);
        }
      }
      frontier = next;
    }
    return createGovernment(world, { capital, areas: realm });
  });
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

/** A fresh state for a newly owned area: empty depot, no jobs, the reference wage and no overrides. */
export function createAreaState(world: World): GovernmentAreaState {
  return {
    depot: new Float64Array(world.goods.length),
    jobs: [],
    wageOffer: 1,
    policyOverrides: [],
    resolvedPolicies: neutralPolicies(world.goods.length),
  };
}

/**
 * Changes an area's owner: updates the owned-area caches and gives the new owner a fresh area state with its realm
 * policies. The old owner's state is dropped; captures handle its depot and jobs first.
 */
export function setOwner(world: World, area: Area, owner: GovernmentId | null): void {
  if (area.owner === owner) return;
  if (area.owner !== null) {
    const previous = world.governments[area.owner] as Government;
    previous.ownedAreas = previous.ownedAreas.filter((id) => id !== area.id);
    previous.areaStates.delete(area.id);
  }
  area.owner = owner;
  if (owner === null) return;
  const government = world.governments[owner] as Government;
  government.ownedAreas.push(area.id);
  government.ownedAreas.sort((a, b) => a - b);
  government.areaStates.set(area.id, createAreaState(world));
  resolvePolicies(government, area.id);
}

export function neutralPolicies(goodCount: number): ResolvedPolicies {
  return {
    productionTaxRate: new Float64Array(goodCount),
    consumptionTaxRate: new Float64Array(goodCount),
    importTariffRate: new Float64Array(goodCount),
    exportTariffRate: new Float64Array(goodCount),
    headTaxPerPersonPerDay: 0,
    priceCeiling: new Float64Array(goodCount).fill(Number.POSITIVE_INFINITY),
    priceFloor: new Float64Array(goodCount),
  };
}

/** Merges the realm policies, then the area's overrides, into the area's resolved policies. */
export function resolvePolicies(government: Government, area: AreaId): void {
  const state = government.areaStates.get(area);
  if (!state) return;
  const resolved = state.resolvedPolicies;
  resolved.productionTaxRate.fill(0);
  resolved.consumptionTaxRate.fill(0);
  resolved.importTariffRate.fill(0);
  resolved.exportTariffRate.fill(0);
  resolved.headTaxPerPersonPerDay = 0;
  resolved.priceCeiling.fill(Number.POSITIVE_INFINITY);
  resolved.priceFloor.fill(0);
  for (const setting of government.realmPolicies) applySetting(resolved, setting);
  for (const setting of state.policyOverrides) applySetting(resolved, setting);
}

/** A null value restores the neutral value: no tax, no ceiling, no floor. */
function applySetting(resolved: ResolvedPolicies, setting: PolicySetting): void {
  const { value } = setting;
  if (setting.policy === "headTaxPerPersonPerDay") {
    resolved.headTaxPerPersonPerDay = value ?? 0;
    return;
  }
  const g = setting.good as number;
  const neutral = setting.policy === "priceCeiling" ? Number.POSITIVE_INFINITY : 0;
  resolved[setting.policy][g] = value ?? neutral;
}

/** Replaces the setting of the same policy and good, or appends it. */
export function upsertSetting(settings: PolicySetting[], setting: PolicySetting): void {
  const index = settings.findIndex((s) => s.policy === setting.policy && s.good === setting.good);
  const copy = { policy: setting.policy, good: setting.good, value: setting.value };
  if (index >= 0) settings[index] = copy;
  else settings.push(copy);
}
