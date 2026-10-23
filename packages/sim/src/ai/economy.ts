// An AI's economy (specification §11): the realm tax, wages, government jobs and the personality's standing orders.
import type { AiMemory, AreaId, Command, GovernmentJob, Personality, StandingRule } from "../types";
import type { Traits } from "./personalities";
import type { Realm } from "./realm";
import type { AiView } from "./view";

const TAX_STEP_UP = 0.02;
const MAXIMUM_WAGE = 10; // the highest wage a command accepts
const MINIMUM_WAGE = 0.1; // war can push an area's wage level below zero
const TAX_STEP_DOWN = 0.01;
const WAGE_PREMIUM = 1.1; // offers above the local wage level, so hiring goes ahead and nobody quits
const JOB_WORKFORCE_SHARE = 0.01; // government jobs take at most this share of the realm's workforce
const MINIMUM_JOB_WORKERS = 5;
const RETARGET_SHARE = 0.1; // job targets change only when they move by more than this share
const INFRASTRUCTURE_EDGES = 3;
const PORT_AREAS = 2;
const FORTIFIED_AREAS = 3;
// Past a few levels, research hurts more than it helps: higher productivity leaves people hungrier (design notes, AI
// governments), so the AI stops there.
const RESEARCH_LEVEL_CAP = 5;
const GRANARIES = 5; // a builder keeps staples in this many of its most populous areas

export function decideEconomy(
  view: AiView,
  realm: Realm,
  memory: AiMemory,
  traits: Traits,
  personality: Personality,
  commands: Command[],
): void {
  setTax(realm, memory, traits, commands);
  setSoldierWage(realm, commands);
  staffJobs(view, realm, traits, commands);
  placeStandingOrders(view, realm, memory, traits, personality, commands);
}

const round = (value: number, step: number) => Math.round(value / step) * step;

/** A wage offer a little above a wage level, within what commands accept. */
const wageFor = (wageLevel: number) =>
  Math.min(MAXIMUM_WAGE, Math.max(MINIMUM_WAGE, round(WAGE_PREMIUM * wageLevel, 0.01)));

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
    commands.push({ type: "setRealmPolicy", setting: { policy: "productionTaxRate", good: null, value: rate } });
}

function setSoldierWage(realm: Realm, commands: Command[]): void {
  // Above the realm's wage level, soldiers do not desert.
  const wage = wageFor(realm.wageLevel);
  if (Number.isFinite(wage) && Math.abs(wage - realm.government.soldierWage) > 0.05 * realm.government.soldierWage)
    commands.push({ type: "setSoldierWage", wage });
}

interface Candidate {
  area: AreaId;
  job: GovernmentJob;
}

const jobKey = (area: AreaId, job: GovernmentJob) =>
  `${area}:${job.kind}:${job.kind === "produce" ? job.good : job.kind === "buildInfrastructure" ? job.edge : ""}`;

/** Where each kind of job helps most, by the personality's weights; kinds with nowhere to go are dropped. */
function jobCandidates(view: AiView, realm: Realm): Record<keyof Traits["jobWeights"], Candidate[]> {
  const { areas, edges } = view.snapshot;
  const { transport, government } = view.data.config;
  const capital = realm.government.capital;
  const byPopulation = (a: AreaId, b: AreaId) => (areas.population[b] as number) - (areas.population[a] as number);
  const infrastructure: { candidate: Candidate; tonnage: number }[] = [];
  view.data.edges.forEach((edge, id) => {
    if (edge.mode !== "land" || !realm.owned.has(edge.areaA) || !realm.owned.has(edge.areaB)) return;
    const tonnage = (edges.tonnage[2 * id] as number) + (edges.tonnage[2 * id + 1] as number);
    if (tonnage <= 0) return;
    const area = byPopulation(edge.areaA, edge.areaB) <= 0 ? edge.areaA : edge.areaB;
    infrastructure.push({ candidate: { area, job: { kind: "buildInfrastructure", edge: id } }, tonnage });
  });
  infrastructure.sort((a, b) => b.tonnage - a.tonnage);
  const ports: Candidate[] = [...realm.owned]
    .filter(
      (area) => view.data.areas[area]?.isCoastal && (areas.portLevel[area] as number) < transport.maximumPortLevel,
    )
    .sort(byPopulation)
    .slice(0, PORT_AREAS)
    .map((area) => ({ area, job: { kind: "buildPort" } }));
  if (capital !== null && (areas.airportLevel[capital] as number) < transport.maximumAirportLevel)
    ports.push({ area: capital, job: { kind: "buildAirport" } });
  return {
    research:
      capital === null || realm.government.researchLevel >= RESEARCH_LEVEL_CAP
        ? []
        : [{ area: capital, job: { kind: "research" } }],
    infrastructure: infrastructure.slice(0, INFRASTRUCTURE_EDGES).map((entry) => entry.candidate),
    ports,
    fortify: realm.border
      .filter((area) => (areas.fortificationLevel[area] as number) < government.maximumFortificationLevel)
      .slice(0, FORTIFIED_AREAS)
      .map((area) => ({ area, job: { kind: "fortify" } })),
  };
}

function staffJobs(view: AiView, realm: Realm, traits: Traits, commands: Command[]): void {
  if (realm.incomePerDay <= 0) return; // no tax yet: jobs start at the next decision
  const { economy } = view.data.config;
  const { areas } = view.snapshot;
  const wage = WAGE_PREMIUM * realm.wageLevel * economy.hoursPerWorkerDay;
  let budget = traits.jobShare * Math.max(0, realm.incomePerDay - realm.soldierSpendingPerDay);
  if (realm.netPerDay !== null && realm.netPerDay < 0 && realm.government.treasury < realm.reserve)
    budget = Math.min(budget, 0.5 * realm.jobSpendingPerDay); // short of money: cut back
  const workforce = realm.population * economy.workforceShare;
  const workers = Math.min(budget / Math.max(wage, 1e-9), JOB_WORKFORCE_SHARE * workforce);

  const candidates = jobCandidates(view, realm);
  const weights = { ...traits.jobWeights };
  // Kinds with nowhere to go drop out; the others share the budget in proportion.
  for (const kind of Object.keys(weights) as (keyof typeof weights)[])
    if (candidates[kind].length === 0) weights[kind] = 0;
  const weightSum = Object.values(weights).reduce((sum, w) => sum + w, 0);
  const desired = new Map<string, { candidate: Candidate; target: number }>();
  if (weightSum > 0)
    for (const kind of Object.keys(weights) as (keyof typeof weights)[]) {
      const list = candidates[kind];
      const each = (workers * weights[kind]) / weightSum / Math.max(list.length, 1);
      if (each < MINIMUM_JOB_WORKERS) continue;
      for (const candidate of list)
        desired.set(jobKey(candidate.area, candidate.job), { candidate, target: Math.round(each) });
    }

  for (const state of realm.government.areaStates) {
    for (const assignment of state.jobs) {
      const { job, targetWorkers } = assignment;
      const key = jobKey(state.area, job);
      const want = desired.get(key);
      if (want) {
        desired.delete(key);
        if (Math.abs(want.target - targetWorkers) > RETARGET_SHARE * targetWorkers)
          commands.push({ type: "setJobTarget", area: state.area, job, targetWorkers: want.target });
      } else if (targetWorkers > 0) commands.push({ type: "setJobTarget", area: state.area, job, targetWorkers: 0 });
    }
  }
  for (const { candidate, target } of desired.values())
    commands.push({ type: "setJobTarget", area: candidate.area, job: candidate.job, targetWorkers: target });

  // Wages that hire: a little above the local wage level wherever the government employs.
  const staffed = new Set<AreaId>();
  for (const state of realm.government.areaStates) if (state.jobs.length > 0) staffed.add(state.area);
  for (const command of commands)
    if (command.type === "setJobTarget" && command.targetWorkers > 0) staffed.add(command.area);
  for (const state of realm.government.areaStates) {
    if (!staffed.has(state.area)) continue;
    const offer = wageFor(areas.wageLevel[state.area] as number);
    if (Number.isFinite(offer) && Math.abs(offer - state.wageOffer) > 0.05 * state.wageOffer)
      commands.push({ type: "setWageOffer", area: state.area, wageOffer: offer });
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
