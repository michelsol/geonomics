// What an AI works out about its own realm from its view: size, money, armies and borders.
import { EPSILON } from "../math";
import type { GovernmentView } from "../snapshot";
import type { AiMemory, AreaId, Army, GovernmentId } from "../types";
import type { Traits } from "./personalities";
import type { AiView } from "./view";

export interface Realm {
  government: GovernmentView;
  day: number;
  owned: ReadonlySet<AreaId>;
  population: number;
  wageLevel: number; // population-weighted mean wage level of the owned areas
  armies: Army[]; // this government's armies
  soldiers: number;
  jobSpendingPerDay: number; // government wages owed per day at the current staffing
  soldierSpendingPerDay: number; // soldiers' wages owed per day
  netPerDay: number | null; // treasury change per day since the last decision; null at the first
  taxRate: number; // the realm production tax rate
  incomePerDay: number; // production taxes owed per day at that rate, from the owned areas' output and prices
  reserve: number; // treasury the personality wants to keep: some days of income
  border: AreaId[]; // owned areas next to another realm's area, most populous first
}

export const armyPower = (army: Pick<Army, "soldiers" | "weapons">): number =>
  army.soldiers * (1 + Math.min(1, army.weapons / Math.max(army.soldiers, EPSILON)));

/** The area an army stands in, or is heading to while it crosses an edge. */
export function armyArea(view: AiView, army: Army): AreaId {
  if (army.location.kind === "area") return army.location.area;
  const edge = view.data.edges[army.location.edge];
  if (!edge) return army.location.from;
  return edge.areaA === army.location.from ? edge.areaB : edge.areaA;
}

export const ownerOf = (view: AiView, area: AreaId): GovernmentId | null => {
  const owner = view.snapshot.areas.owner[area] as number;
  return owner < 0 ? null : owner;
};

/** Defense of an area against attackers: its militia and its owner's armies there, times its fortification. */
export function defenseOf(view: AiView, area: AreaId): number {
  const { areas, armies } = view.snapshot;
  const owner = areas.owner[area] as number;
  let power = areas.militia[area] as number;
  for (const army of armies) if (army.owner === owner && armyArea(view, army) === area) power += armyPower(army);
  return power * (1 + (areas.fortificationLevel[area] as number));
}

export function assess(view: AiView, memory: AiMemory, traits: Traits): Realm {
  const government = view.snapshot.government as GovernmentView;
  const { areas, armies, gameDay: day } = view.snapshot;
  const hours = view.data.config.economy.hoursPerWorkerDay;
  const owned = new Set(government.ownedAreas);
  let population = 0;
  let wageSum = 0;
  for (const area of owned) {
    population += areas.population[area] as number;
    wageSum += (areas.population[area] as number) * (areas.wageLevel[area] as number);
  }
  let jobSpendingPerDay = 0;
  for (const state of government.areaStates)
    for (const job of state.jobs) jobSpendingPerDay += job.workers * state.wageOffer * hours;
  const own = armies.filter((army) => army.owner === view.me);
  const soldiers = own.reduce((sum, army) => sum + army.soldiers, 0);
  const soldierSpendingPerDay = soldiers * government.soldierWage * hours;
  const elapsed = memory.lastDecisionDay === null ? 0 : day - memory.lastDecisionDay;
  const netPerDay = elapsed > 0 ? (government.treasury - memory.lastTreasury) / elapsed : null;
  const setting = government.realmPolicies.find((s) => s.policy === "productionTaxRate" && s.good === null);
  const taxRate = setting?.value ?? 0;
  let output = 0;
  for (const area of owned) {
    const detail = view.detail.get(area);
    if (!detail) continue;
    for (let good = 0; good < detail.produced.length; good++)
      output += (detail.produced[good] as number) * (detail.price[good] as number);
  }
  const incomePerDay = (taxRate * output) / view.data.config.pace.gameDaysPerTick;
  const border = [...owned].filter((area) =>
    (view.neighbors[area] ?? []).some((other) => {
      const owner = areas.owner[other] as number;
      return owner >= 0 && owner !== view.me;
    }),
  );
  border.sort((a, b) => (areas.population[b] as number) - (areas.population[a] as number));
  return {
    government,
    day,
    owned,
    population,
    wageLevel: population > 0 ? wageSum / population : 1,
    armies: own,
    soldiers,
    jobSpendingPerDay,
    soldierSpendingPerDay,
    netPerDay,
    taxRate,
    incomePerDay,
    reserve: traits.reserveDays * incomePerDay,
    border,
  };
}

/** Workers an area could give up to an army: its unemployed and half its private workers. */
export function recruitable(view: AiView, area: AreaId): number {
  const detail = view.detail.get(area);
  if (!detail) return 0;
  let privateWorkers = 0;
  for (const workers of detail.privateWorkers) privateWorkers += workers;
  return detail.unemployedWorkers + 0.5 * privateWorkers;
}
