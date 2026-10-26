// Phase 3: consumption (specification §4, Consumption).
import { CONSUMER_GROUP_COUNT, WAGE_BAND_COUNT } from "../bands";
import { clamp, EPSILON } from "../math";
import type { Area, ResolvedPolicies, World } from "../types";
import { wageBands } from "./labor";
import { policiesOf, type Scratch, scratchOf } from "./scratch";

/**
 * How savings relative to the target change behavior: above 1 when inhabitants hold more than targetSavingsDays of
 * income, below 1 when they hold less.
 */
export function savingsFactor(world: World, area: Area): number {
  const e = world.config.economy;
  const incomePerPersonPerDay = Math.max(area.averageWage, 0.1) * e.hoursPerWorkerDay * e.workforceShare;
  const savingsDays = area.savings / Math.max(area.population * incomePerPersonPerDay, EPSILON);
  return clamp(savingsDays / e.targetSavingsDays, e.savingsFactorMin, e.savingsFactorMax) ** e.savingsElasticity;
}

/**
 * What an unemployed worker lives on per hour, before head tax: the share of the average wage the employed pass on,
 * less the unemployed tax, which is a benefit when negative.
 */
export function unemployedIncome(world: World, area: Area, policies: ResolvedPolicies): number {
  const e = world.config.economy;
  return e.unemployedWageShare * Math.max(area.averageWage, 0) - policies.unemployedTaxPerDay / e.hoursPerWorkerDay;
}

export function runConsumption(world: World): void {
  const scratch = scratchOf(world);
  for (const area of world.areas) {
    planDemand(world, area, scratch);
    consumeArea(world, area, scratch);
  }
}

/**
 * What the area's consumers want and what they buy this tick. Consumers come in groups: the workers of each wage band,
 * then the unemployed, each with the people who depend on them. A group wants what its purchasing power asks for, and
 * buys what its income pays for, necessities first. Writes what was bought per good into `area.demanded`, what was
 * wanted per need into `area.needDemanded`, and each good's share of its need into `scratch.weights`. Purchases inside
 * an area move no money, as every trade there cancels out: the budget only caps quantities.
 */
export function planDemand(world: World, area: Area, scratch: Scratch): void {
  const days = world.config.pace.gameDaysPerTick;
  const e = world.config.economy;
  const { goods } = world;
  const policies = policiesOf(world, area, scratch);
  const consumptionTax = policies.consumptionTaxRate;
  const share = scratch.weights;
  const unitPrice = scratch.values;
  const { groupPeople: people, groupLogPower: logPower, groupBudget: budget, groupNeedBought: needBought } = scratch;
  const necessityWanted = scratch.groupNecessityWanted;
  const needCount = world.needs.length;
  necessityWanted.fill(0);

  // Groups: the wage bands, then the unemployed. Every group owes the head tax for its people.
  wageBands(world, area, scratch);
  const factor = savingsFactor(world, area);
  const workforce = area.population * e.workforceShare;
  const headTaxPerHour = policies.headTaxPerPersonPerDay / e.workforceShare / e.hoursPerWorkerDay;
  const start = area.id * WAGE_BAND_COUNT;
  const group = (index: number, workers: number, hourly: number) => {
    const income = Math.max(0, hourly - headTaxPerHour);
    people[index] = workforce > EPSILON ? (area.population * workers) / workforce : 0;
    logPower[index] = Math.log(Math.max(income, 0.01) * factor);
    budget[index] = income * e.hoursPerWorkerDay * days * workers * factor;
  };
  for (let band = 0; band < WAGE_BAND_COUNT; band++) {
    const workers = scratch.bandWorkers[start + band] as number;
    const mean = workers > EPSILON ? (scratch.bandWages[start + band] as number) / workers : 0;
    group(band, workers, mean * (1 - (policies.incomeTaxRate[band] as number)));
  }
  group(WAGE_BAND_COUNT, area.unemployedWorkers, unemployedIncome(world, area, policies));

  area.demanded.fill(0);
  for (const need of scratch.needsByTier) {
    const needGoods = scratch.needGoods[need.id] as number[];
    let weightSum = 0;
    for (const g of needGoods) {
      const good = goods[g] as (typeof goods)[number];
      const satisfies = good.satisfies as NonNullable<typeof good.satisfies>;
      unitPrice[g] = ((area.price[g] as number) * (1 + (consumptionTax[g] as number))) / satisfies.unitsPerGood;
      share[g] =
        satisfies.preference * inversePower(Math.max(unitPrice[g] as number, EPSILON), need.substitutionElasticity);
      weightSum += share[g] as number;
    }
    let needPrice = 0;
    for (const g of needGoods) {
      share[g] = (share[g] as number) / weightSum;
      needPrice += (share[g] as number) * (unitPrice[g] as number);
    }
    const price = Math.max(needPrice, EPSILON);

    // people × demandPerPersonPerDay × (referenceUnitPrice / needPrice) ** priceElasticity × power ** wealthElasticity
    const perPerson = need.demandPerPersonPerDay * days;
    const logPrice = need.priceElasticity * Math.log(need.referenceUnitPrice / price);
    let wanted = 0;
    let bought = 0;
    for (let index = 0; index < CONSUMER_GROUP_COUNT; index++) {
      const groupPeople = people[index] as number;
      needBought[index * needCount + need.id] = 0;
      if (groupPeople <= 0) continue;
      const groupWanted =
        groupPeople * perPerson * Math.exp(logPrice + need.wealthElasticity * (logPower[index] as number));
      const groupBought = Math.min(groupWanted, (budget[index] as number) / price);
      budget[index] = Math.max(0, (budget[index] as number) - groupBought * price);
      needBought[index * needCount + need.id] = groupBought;
      if (need.tier === "necessity")
        necessityWanted[index] = (necessityWanted[index] as number) + groupWanted * need.referenceUnitPrice;
      wanted += groupWanted;
      bought += groupBought;
    }
    area.needDemanded[need.id] = wanted;
    for (const g of needGoods) area.demanded[g] = (bought * (share[g] as number)) / (scratch.unitsPerGood[g] as number);
  }
}

/**
 * Consumes what `planDemand` left in `area.demanded` from stock, moving what a good lacks to its substitutes, and
 * measures satisfaction against what was wanted: what a group wanted but could not pay for counts as unmet. Each
 * group's necessities met is kept too, with a stock shortage shared in proportion to what each group bought.
 */
function consumeArea(world: World, area: Area, scratch: Scratch): void {
  const { tierWeights } = world.config.economy;
  const { goods } = world;
  const policies = policiesOf(world, area, scratch);
  const consumptionTax = policies.consumptionTaxRate;
  const share = scratch.weights;

  const needCount = world.needs.length;
  const groupMet = scratch.groupNecessityMet;
  const groupShare = scratch.groupShare;
  const start = area.id * CONSUMER_GROUP_COUNT;
  for (let index = 0; index < CONSUMER_GROUP_COUNT; index++) groupMet[start + index] = 0; // necessities got, for now
  area.consumed.fill(0);
  let weightedDemand = 0;
  let weightedConsumption = 0;
  let necessityDemand = 0;
  let necessityConsumption = 0;

  for (const need of world.needs) {
    const needGoods = scratch.needGoods[need.id] as number[];
    // First pass: each good covers its share; unmet need units are counted for the spillover pass.
    let unmet = 0;
    let availableShare = 0;
    for (const g of needGoods) {
      const unitsPerGood = scratch.unitsPerGood[g] as number;
      const demanded = area.demanded[g] as number;
      const consumed = Math.min(area.stock[g] as number, demanded);
      area.consumed[g] = consumed;
      unmet += (demanded - consumed) * unitsPerGood;
      if ((area.stock[g] as number) - consumed > EPSILON) availableShare += share[g] as number;
    }

    // Spillover: unmet need units move to substitutes that still have stock, in proportion to their share.
    let needConsumed = 0;
    for (const g of needGoods) {
      const unitsPerGood = scratch.unitsPerGood[g] as number;
      const left = (area.stock[g] as number) - (area.consumed[g] as number);
      if (unmet > EPSILON && left > EPSILON) {
        const extra = Math.min(left, (unmet * (share[g] as number)) / availableShare / unitsPerGood);
        area.consumed[g] = (area.consumed[g] as number) + extra;
      }
      area.stock[g] = Math.max(0, (area.stock[g] as number) - (area.consumed[g] as number));
      needConsumed += (area.consumed[g] as number) * unitsPerGood;
    }
    area.needConsumed[need.id] = needConsumed;

    // Need units differ between needs, so satisfaction compares them at their reference value.
    const needWanted = area.needDemanded[need.id] as number;
    const demandValue = needWanted * need.referenceUnitPrice;
    const consumedValue = Math.min(needConsumed, needWanted) * need.referenceUnitPrice;
    const tierWeight = tierWeights[need.tier];
    weightedDemand += tierWeight * demandValue;
    weightedConsumption += tierWeight * consumedValue;
    if (need.tier === "necessity") {
      necessityDemand += demandValue;
      necessityConsumption += consumedValue;
      // What each group bought, less its share of what the stock lacked.
      let bought = 0;
      for (let index = 0; index < CONSUMER_GROUP_COUNT; index++)
        bought += scratch.groupNeedBought[index * needCount + need.id] as number;
      const delivered = bought > EPSILON ? Math.min(1, needConsumed / bought) : 0;
      for (let index = 0; index < CONSUMER_GROUP_COUNT; index++) {
        const got = (scratch.groupNeedBought[index * needCount + need.id] as number) * delivered;
        groupMet[start + index] = (groupMet[start + index] as number) + got * need.referenceUnitPrice;
      }
    }
  }
  for (let index = 0; index < CONSUMER_GROUP_COUNT; index++) {
    const wanted = scratch.groupNecessityWanted[index] as number;
    groupMet[start + index] = wanted > EPSILON ? Math.min(1, (groupMet[start + index] as number) / wanted) : 1;
    groupShare[start + index] =
      area.population > EPSILON ? (scratch.groupPeople[index] as number) / area.population : 0;
  }

  area.satisfaction = weightedDemand > EPSILON ? weightedConsumption / weightedDemand : 1;
  area.necessitySatisfaction = necessityDemand > EPSILON ? necessityConsumption / necessityDemand : 1;

  // Services are consumed in the tick they are produced; whatever was not consumed is lost.
  for (const good of goods) if (good.isService) area.stock[good.id] = 0;

  if (policies !== scratch.neutralPolicies) {
    // Consumption tax is owed on what was consumed at the market price; a negative rate is a subsidy.
    let tax = 0;
    let subsidy = 0;
    for (const good of goods) {
      const due =
        (consumptionTax[good.id] as number) * (area.consumed[good.id] as number) * (area.price[good.id] as number);
      if (due > 0) tax += due;
      else subsidy -= due;
    }
    scratch.taxDue[area.id] = (scratch.taxDue[area.id] as number) + tax;
    scratch.paymentDue[area.id] = (scratch.paymentDue[area.id] as number) + subsidy;
  }
}

/** x ** -exponent, with the common exponents of the catalogs computed without Math.pow. */
function inversePower(x: number, exponent: number): number {
  if (exponent === 0) return 1;
  if (exponent === 1) return 1 / x;
  if (exponent === 2) return 1 / (x * x);
  return x ** -exponent;
}
