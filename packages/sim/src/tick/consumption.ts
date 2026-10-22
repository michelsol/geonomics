// Phase 3: consumption (specification §5, Consumption). Army upkeep joins this phase in roadmap stage 7.
import { clamp, EPSILON } from "../math";
import type { Area, World } from "../types";
import { policiesOf, type Scratch, scratchOf } from "./scratch";

/**
 * How savings relative to the target change behavior: above 1 when inhabitants hold more than targetSavingsDays of
 * income, below 1 when they hold less.
 */
export function savingsFactor(world: World, area: Area): number {
  const e = world.config.economy;
  const incomePerPersonPerDay = Math.max(area.wageLevel, 0.1) * e.hoursPerWorkerDay * e.workforceShare;
  const savingsDays = area.savings / Math.max(area.population * incomePerPersonPerDay, EPSILON);
  return clamp(savingsDays / e.targetSavingsDays, e.savingsFactorMin, e.savingsFactorMax) ** e.savingsElasticity;
}

/** Purchasing power from wage level and savings relative to the target savings. */
export function purchasingPower(world: World, area: Area): number {
  return Math.max(area.wageLevel, 0.1) * savingsFactor(world, area);
}

export function runConsumption(world: World): void {
  const scratch = scratchOf(world);
  for (const area of world.areas) consumeArea(world, area, scratch);
}

function consumeArea(world: World, area: Area, scratch: Scratch): void {
  const days = world.config.pace.gameDaysPerTick;
  const { tierWeights } = world.config.economy;
  const { goods } = world;
  const consumptionTax = policiesOf(world, area, scratch).consumptionTaxRate;
  const power = purchasingPower(world, area);
  const share = scratch.weights;
  const unitPrice = scratch.values;

  area.demanded.fill(0);
  area.consumed.fill(0);
  let weightedDemand = 0;
  let weightedConsumption = 0;
  let necessityDemand = 0;
  let necessityConsumption = 0;

  for (const need of world.needs) {
    const needGoods = scratch.needGoods[need.id] as number[];
    let weightSum = 0;
    for (const g of needGoods) {
      const good = goods[g] as (typeof goods)[number];
      const satisfies = good.satisfies as NonNullable<typeof good.satisfies>;
      unitPrice[g] = ((area.price[g] as number) * (1 + (consumptionTax[g] as number))) / satisfies.unitsPerGood;
      share[g] = satisfies.preference * Math.max(unitPrice[g] as number, EPSILON) ** -need.substitutionElasticity;
      weightSum += share[g] as number;
    }
    let needPrice = 0;
    for (const g of needGoods) {
      share[g] = (share[g] as number) / weightSum;
      needPrice += (share[g] as number) * (unitPrice[g] as number);
    }

    const needDemanded =
      area.population *
      need.demandPerPersonPerDay *
      days *
      (need.referenceUnitPrice / Math.max(needPrice, EPSILON)) ** need.priceElasticity *
      power ** need.wealthElasticity;

    // First pass: each good covers its share; unmet need units are counted for the spillover pass.
    let unmet = 0;
    let availableShare = 0;
    for (const g of needGoods) {
      const unitsPerGood = scratch.unitsPerGood[g] as number;
      const demanded = (needDemanded * (share[g] as number)) / unitsPerGood;
      const consumed = Math.min(area.stock[g] as number, demanded);
      area.demanded[g] = demanded;
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

    area.needDemanded[need.id] = needDemanded;
    area.needConsumed[need.id] = needConsumed;

    // Need units differ between needs, so satisfaction compares them at their reference value.
    const demandValue = needDemanded * need.referenceUnitPrice;
    const consumedValue = Math.min(needConsumed, needDemanded) * need.referenceUnitPrice;
    const tierWeight = tierWeights[need.tier];
    weightedDemand += tierWeight * demandValue;
    weightedConsumption += tierWeight * consumedValue;
    if (need.tier === "necessity") {
      necessityDemand += demandValue;
      necessityConsumption += consumedValue;
    }
  }

  area.satisfaction = weightedDemand > EPSILON ? weightedConsumption / weightedDemand : 1;
  area.necessitySatisfaction = necessityDemand > EPSILON ? necessityConsumption / necessityDemand : 1;

  // Services are consumed in the tick they are produced; whatever was not consumed is lost.
  for (const good of goods) if (good.isService) area.stock[good.id] = 0;
}
