// An AI's economy (specification §10): the realm income tax, the benefit for the unemployed, the soldier wage,
// infrastructure and the personality's standing orders.
import { canBuild, INFRASTRUCTURE_KINDS, levelCost } from "../infrastructure";
import { snapshotLevel } from "../snapshot";
import type { AiMemory, AreaId, Command, InfrastructureKind, Personality, StandingRule } from "../types";
import { shores, waterReach, withinHops } from "../waters";
import type { Traits } from "./personalities";
import type { Realm } from "./realm";
import type { AiView } from "./view";

const TAX_STEP_UP = 0.02;
const MAXIMUM_WAGE = 10; // the highest wage a command accepts
const MINIMUM_WAGE = 0.1; // war can push an area's average wage below zero
const TAX_STEP_DOWN = 0.01;
const WAGE_PREMIUM = 1.1; // soldiers are paid above the realm's average wage, so nobody deserts
const GRANARIES = 5; // a builder keeps staples in this many of its most populous areas
const SURPLUS_PAYOUT_DAYS = 365; // a treasury above twice its reserve pays the excess out as a benefit over this long
const BENEFIT_CHANGE = 0.1; // the benefit changes only when it would move by more than this share

export function decideEconomy(
  view: AiView,
  realm: Realm,
  memory: AiMemory,
  traits: Traits,
  personality: Personality,
  commands: Command[],
): void {
  setTax(realm, memory, traits, commands);
  setBenefit(view, realm, commands);
  setSoldierWage(realm, commands);
  manageInfrastructure(view, realm, traits, commands);
  placeStandingOrders(view, realm, memory, traits, personality, commands);
}

const round = (value: number, step: number) => Math.round(value / step) * step;

/** A wage offer a little above an average wage, within what commands accept. */
const wageFor = (averageWage: number) =>
  Math.min(MAXIMUM_WAGE, Math.max(MINIMUM_WAGE, round(WAGE_PREMIUM * averageWage, 0.01)));

function setTax(realm: Realm, memory: AiMemory, traits: Traits, commands: Command[]): void {
  const current = realm.taxRate;
  let rate = current;
  if (memory.lastDecisionDay === null) rate = traits.baseTax;
  else if (realm.netPerDay !== null) {
    const treasury = realm.government.treasury;
    if (realm.netPerDay < 0 && treasury < realm.reserve)
      rate += treasury < realm.reserve / 2 ? 2 * TAX_STEP_UP : TAX_STEP_UP;
    else if (realm.netPerDay > 0 && treasury > 2 * realm.reserve) rate -= TAX_STEP_DOWN;
  }
  rate = round(Math.min(traits.maximumTax, Math.max(traits.minimumTax, rate)), 0.005);
  if (Math.abs(rate - current) > 1e-9)
    commands.push({ type: "setRealmPolicy", setting: { policy: "incomeTaxRate", good: null, value: rate } });
}

/**
 * Money above twice the reserve goes back to the realm's people as a benefit for the unemployed, paid out over about
 * a year, so the treasury does not drain the savings it taxes. Below the reserve, the benefit stops.
 */
function setBenefit(view: AiView, realm: Realm, commands: Command[]): void {
  const { areas } = view.snapshot;
  const { workforceShare } = view.data.config.economy;
  let unemployed = 0;
  for (const area of realm.owned) {
    const employment = areas.employmentRate[area] as number;
    if (Number.isFinite(employment))
      unemployed += (areas.population[area] as number) * workforceShare * (1 - employment);
  }
  const setting = realm.government.realmPolicies.find((s) => s.policy === "unemployedTaxPerDay" && s.good === null);
  const current = Math.max(0, -(setting?.value ?? 0));
  const treasury = realm.government.treasury;
  let benefit = current;
  if (treasury > 2 * realm.reserve && unemployed > 0)
    benefit = round((treasury - 2 * realm.reserve) / SURPLUS_PAYOUT_DAYS / unemployed, 0.01);
  else if (treasury < realm.reserve) benefit = 0;
  if (benefit === current || Math.abs(benefit - current) <= BENEFIT_CHANGE * current) return;
  commands.push({
    type: "setRealmPolicy",
    setting: { policy: "unemployedTaxPerDay", good: null, value: benefit > 0 ? -benefit : null },
  });
}

function setSoldierWage(realm: Realm, commands: Command[]): void {
  // Above the realm's average wage, soldiers do not desert.
  const wage = wageFor(realm.averageWage);
  if (Number.isFinite(wage) && Math.abs(wage - realm.government.soldierWage) > 0.05 * realm.government.soldierWage)
    commands.push({ type: "setSoldierWage", wage });
}

/**
 * Per owned coastal area, what its next port level would add at sea: the labor value per day of the water cells it
 * would newly reach at full capacity, each split with the ports already reaching it.
 */
export function seaGains(view: AiView, owned: Iterable<AreaId>): Map<AreaId, number> {
  const gains = new Map<AreaId, number>();
  const { waters, waterCapacityMaximum, goods, config } = view.data;
  if (waters.length === 0) return gains;
  const levels = view.snapshot.areas.portLevel;
  const ports = new Uint16Array(waters.length);
  for (const reach of waterReach(waters, levels))
    for (const { water } of reach) ports[water] = (ports[water] as number) + 1;
  const primaries = goods.filter((good) => good.isPrimary);
  const cellValue = (water: number) =>
    primaries.reduce(
      (sum, good) => sum + (waterCapacityMaximum[water * goods.length + good.id] as number) * good.laborValue,
      0,
    );
  const shore = shores(waters, levels.length);
  for (const area of owned) {
    const level = levels[area] as number;
    if (level >= config.infrastructure.maximumLevel || (shore[area] as number[]).length === 0) continue;
    let gain = 0;
    for (const [water, hop] of withinHops(waters, shore[area] as number[], level + 1))
      if (hop === level + 1) gain += cellValue(water) / ((ports[water] as number) + 1);
    gains.set(area, gain);
  }
  return gains;
}

/** One level of one kind in one area, as the AI weighs it. */
interface Option {
  area: AreaId;
  kind: InfrastructureKind;
  level: number; // the built level
  score: number; // the personality's weight times what the area gains, less for each level already built
}

/**
 * Infrastructure within a budget (specification §10, Infrastructure): a share of tax income after soldiers' pay covers
 * the staff of what stands and the payments of what is being built. With a treasury above half its reserve, it starts
 * as many of the best next levels as the budget allows; short of money, it stops construction, then takes down its
 * least valuable level.
 */
function manageInfrastructure(view: AiView, realm: Realm, traits: Traits, commands: Command[]): void {
  if (realm.incomePerDay <= 0) return; // no tax yet: building starts at the next decision
  const { config } = view.data;
  const inf = config.infrastructure;
  const { areas, edges } = view.snapshot;
  const government = realm.government;
  const share =
    government.realmPolicies.find((s) => s.policy === "staffWageShare" && s.good === null)?.value ??
    inf.defaultStaffWageShare;
  const staffPerDay = (area: AreaId, kind: InfrastructureKind, levels: number) =>
    levels *
    inf.staffPerLevel[kind] *
    share *
    Math.max(areas.averageWage[area] as number, 0) *
    config.economy.hoursPerWorkerDay;
  const paymentPerDay = (kind: InfrastructureKind, level: number) =>
    levelCost(config, kind, level) / inf.buildDaysPerLevel[kind];
  const set = (area: AreaId, kind: InfrastructureKind, level: number) =>
    commands.push({ type: "setInfrastructureTarget", area, kind, level });

  // What the realm spends now, and on what.
  let spending = 0;
  const building: Option[] = [];
  for (const state of government.areaStates) {
    const coastal = view.data.areas[state.area]?.isCoastal ?? false;
    for (const [k, kind] of INFRASTRUCTURE_KINDS.entries()) {
      const level = snapshotLevel(areas, state.area, kind);
      spending += staffPerDay(state.area, kind, level);
      const target = Math.min(state.targetLevel[k] as number, inf.maximumLevel);
      if (target > level && canBuild({ isCoastal: coastal }, kind)) {
        spending += paymentPerDay(kind, level + 1);
        building.push({ area: state.area, kind, level, score: 0 });
      }
    }
  }

  // What each area would gain: people served, and for roads the land trade passing through.
  const largest = Math.max(1, ...[...realm.owned].map((area) => areas.population[area] as number));
  const tonnage = new Float64Array(view.data.areas.length);
  view.data.edges.forEach((edge, id) => {
    if (edge.mode !== "land") return;
    const carried = (edges.tonnage[2 * id] as number) + (edges.tonnage[2 * id + 1] as number);
    tonnage[edge.areaA] = (tonnage[edge.areaA] as number) + carried;
    tonnage[edge.areaB] = (tonnage[edge.areaB] as number) + carried;
  });
  const busiest = Math.max(1e-9, ...[...realm.owned].map((area) => tonnage[area] as number));
  const border = new Set(realm.border);
  const seaGain = seaGains(view, realm.owned);
  const bestSeaGain = Math.max(1e-9, ...seaGain.values());
  const options: Option[] = [];
  for (const area of realm.owned) {
    const people = (areas.population[area] as number) / largest;
    const coastal = view.data.areas[area]?.isCoastal ?? false;
    for (const kind of INFRASTRUCTURE_KINDS) {
      const level = snapshotLevel(areas, area, kind);
      let value = 0;
      if (kind === "port") value = coastal ? people + (seaGain.get(area) ?? 0) / bestSeaGain : 0;
      else if (kind === "airport") value = people * (area === government.capital ? 2 : 1);
      else if (kind === "roads") value = people + (tonnage[area] as number) / busiest;
      else value = border.has(area) ? people : 0;
      if (value > 0)
        options.push({ area, kind, level, score: (traits.infrastructureWeights[kind] * value) / (level + 1) });
    }
  }

  const budget = traits.infrastructureShare * Math.max(0, realm.incomePerDay - realm.soldierSpendingPerDay);
  const treasury = government.treasury;
  if (realm.netPerDay !== null && realm.netPerDay < 0 && treasury < realm.reserve / 2) {
    // Short of money: stop building, and if nothing is being built, take down the least valuable level.
    if (building.length > 0) for (const option of building) set(option.area, option.kind, option.level);
    else {
      const built = options
        .filter((option) => option.level > 0)
        .sort((a, b) => a.score - b.score || a.area - b.area)[0];
      if (built) set(built.area, built.kind, built.level - 1);
    }
    return;
  }
  if (treasury < realm.reserve / 2) return;
  // As many next levels as the budget can pay and then run, best first; one level per area and kind at a time.
  const underWay = new Set(building.map((option) => `${option.area}:${option.kind}`));
  const candidates = options
    .filter((option) => option.level < inf.maximumLevel && !underWay.has(`${option.area}:${option.kind}`))
    .sort((a, b) => b.score - a.score || a.area - b.area);
  for (const option of candidates) {
    const cost = staffPerDay(option.area, option.kind, 1) + paymentPerDay(option.kind, option.level + 1);
    if (spending + cost > budget) continue;
    spending += cost;
    set(option.area, option.kind, option.level + 1);
  }
}

/** The goods the realm consumes most, by value, never services; `filter` narrows the choice. */
function mostConsumed(view: AiView, realm: Realm, count: number, filter: (good: number) => boolean = () => true) {
  const goods = view.data.goods;
  const value = new Float64Array(goods.length);
  const quantity = new Float64Array(goods.length);
  for (const area of realm.owned) {
    const detail = view.detail.get(area);
    if (!detail) continue;
    for (const good of goods) {
      quantity[good.id] = (quantity[good.id] as number) + (detail.consumed[good.id] as number);
      value[good.id] = (value[good.id] as number) + (detail.consumed[good.id] as number) * good.laborValue;
    }
  }
  return goods
    .filter((good) => !good.isService && (value[good.id] as number) > 0 && filter(good.id))
    .sort((a, b) => (value[b.id] as number) - (value[a.id] as number))
    .slice(0, count)
    .map((good) => ({ good, perAreaPerDay: (quantity[good.id] as number) / Math.max(realm.owned.size, 1) }));
}

function placeStandingOrders(
  view: AiView,
  realm: Realm,
  memory: AiMemory,
  traits: Traits,
  personality: Personality,
  commands: Command[],
): void {
  const add = (areas: AreaId[] | "all", rule: StandingRule) => {
    // One rule of a kind per good and areas: amounts may drift, the order stays.
    const exists = realm.government.standingOrders.some(
      (order) =>
        order.rule.kind === rule.kind &&
        order.rule.good === rule.good &&
        JSON.stringify(order.areas) === JSON.stringify(areas),
    );
    if (!exists) commands.push({ type: "addStandingOrder", order: { areas, rule } });
  };
  if (!memory.standingOrdersPlaced) {
    memory.standingOrdersPlaced = true;
    if (personality === "trader")
      // Buy cheap, sell dear: profitable, and it evens out gluts and shortages.
      for (const { good, perAreaPerDay } of mostConsumed(view, realm, 6)) {
        const maximumDepotQuantity = round(20 * perAreaPerDay, 1);
        add("all", { kind: "buyBelowPrice", good: good.id, maximumPrice: 0.8 * good.laborValue, maximumDepotQuantity });
        add("all", { kind: "sellAbovePrice", good: good.id, minimumPrice: 1.3 * good.laborValue, keepDaysOfDemand: 0 });
      }
    if (personality === "builder") {
      // Granaries: keep ten days of the staples, and sell them in a famine.
      const necessity = (good: number) => {
        const need = view.data.goods[good]?.satisfies?.need;
        return need !== undefined && view.data.needs[need]?.tier === "necessity";
      };
      const granaries = [...realm.owned]
        .sort((x, y) => (view.snapshot.areas.population[y] as number) - (view.snapshot.areas.population[x] as number))
        .slice(0, GRANARIES);
      for (const { good } of mostConsumed(view, realm, 3, necessity)) {
        add(granaries, {
          kind: "keepDepotStock",
          good: good.id,
          targetDaysOfDemand: 10,
          maximumBuyPrice: 1.2 * good.laborValue,
        });
        add(granaries, {
          kind: "sellAbovePrice",
          good: good.id,
          minimumPrice: 2 * good.laborValue,
          keepDaysOfDemand: 5,
        });
      }
    }
  }
  const capital = realm.government.capital;
  if (traits.aggressive && capital !== null) {
    // Weapons for the army, bought where it is raised; nobody else uses them, so the order also makes them made.
    const weapons = view.data.config.military.weaponsGood;
    const laborValue = view.data.goods[weapons]?.laborValue ?? 1;
    const maximumDepotQuantity = round(traits.armyShare * realm.population, 10);
    if (maximumDepotQuantity > 0)
      add([capital], { kind: "buyBelowPrice", good: weapons, maximumPrice: 3 * laborValue, maximumDepotQuantity });
  }
}
