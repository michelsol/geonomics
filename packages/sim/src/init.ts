// Rule 6: start near equilibrium, then warm up (specification §4).
import { reserveDaysOf } from "./math";
import { computeValueAdded, workersFor } from "./tick/labor";
import { produceArea } from "./tick/production";
import { scratchOf } from "./tick/scratch";
import { runTick } from "./tick/tick";
import type { Area, World } from "./types";

/** Consumer demand per inhabitant per day for every good at labor-value prices and a purchasing power of 1. */
function referenceConsumerDemandPerPerson(world: World): Float64Array {
  const demand = new Float64Array(world.goods.length);
  for (const need of world.needs) {
    let weightSum = 0;
    for (const good of world.goods) {
      if (good.satisfies?.need !== need.id) continue;
      weightSum +=
        good.satisfies.preference * (good.laborValue / good.satisfies.unitsPerGood) ** -need.substitutionElasticity;
    }
    for (const good of world.goods) {
      if (good.satisfies?.need !== need.id) continue;
      const unitPrice = good.laborValue / good.satisfies.unitsPerGood;
      const share = (good.satisfies.preference * unitPrice ** -need.substitutionElasticity) / weightSum;
      demand[good.id] = (need.demandPerPersonPerDay * share) / good.satisfies.unitsPerGood;
    }
  }
  return demand;
}

/**
 * Total demand per inhabitant per day for every good at labor-value prices and a purchasing power of 1:
 * consumer demand split between substitutes, plus the inputs needed to make all of it.
 */
export function referenceDemandPerPerson(world: World): Float64Array {
  const demand = referenceConsumerDemandPerPerson(world);
  // Outputs come after their inputs, so walking backwards adds each recipe's input demand before the input is read.
  for (let g = world.goods.length - 1; g >= 0; g--) {
    const good = world.goods[g] as World["goods"][number];
    for (const input of good.inputs)
      demand[input.good] = (demand[input.good] as number) + (demand[g] as number) * input.quantity;
  }
  return demand;
}

/**
 * Rule 6, steps 1 to 5: prices at labor value, workers placed to cover local demand where local resources allow,
 * starting stock and savings, and a first wage level, so the first tick starts close to balance.
 */
export function initializeWorld(world: World): void {
  const consumerPerPerson = referenceConsumerDemandPerPerson(world);
  const perPerson = referenceDemandPerPerson(world);
  const scratch = scratchOf(world);
  const days = world.config.pace.gameDaysPerTick;
  for (const area of world.areas) {
    initializePrices(world, area);
    for (const good of world.goods) {
      const g = good.id;
      const consumerDemand = (consumerPerPerson[g] as number) * area.population;
      const totalDemand = (perPerson[g] as number) * area.population;
      area.demanded[g] = consumerDemand * days;
      area.inputDemanded[g] = (totalDemand - consumerDemand) * days;
      area.stock[g] = good.isService ? 0 : reserveDaysOf(good, world.config) * totalDemand;
    }
    placeWorkers(world, area, perPerson);
    area.wageLevel = computeValueAdded(world, area, scratch, scratch.values);
    const e = world.config.economy;
    const income = Math.max(area.wageLevel, 0.1) * e.hoursPerWorkerDay * e.workforceShare;
    area.savings = e.targetSavingsDays * area.population * income;
    area.satisfaction = 1;
    area.necessitySatisfaction = 1;
  }
}

/** Rule 6, step 6: runs warmupDays with no players at boosted responsiveness, then restores the pace. */
export function warmUp(world: World, days = world.config.warmupDays): void {
  const pace = world.config.pace;
  const saved = { ...pace };
  const boost = world.config.warmupResponsivenessBoost;
  pace.economyResponsiveness *= boost;
  pace.demographyResponsiveness *= boost;
  try {
    const ticks = Math.round(days / pace.gameDaysPerTick);
    for (let i = 0; i < ticks; i++) runTick(world);
  } finally {
    Object.assign(pace, saved);
  }
}

function initializePrices(world: World, area: Area): void {
  for (const good of world.goods) {
    area.price[good.id] = good.laborValue;
    area.smoothedPrice[good.id] = good.laborValue;
  }
}

/** Rule 6, step 2: workers to cover local demand where resources allow; the rest stay unemployed. */
function placeWorkers(world: World, area: Area, perPerson: Float64Array): void {
  const scratch = scratchOf(world);
  const workforce = area.population * world.config.economy.workforceShare;
  let total = 0;
  for (const good of world.goods) {
    const workers = workersFor(world, area, good, (perPerson[good.id] as number) * area.population);
    area.privateWorkers[good.id] = workers;
    total += workers;
  }
  if (total > workforce) {
    for (const good of world.goods) {
      area.privateWorkers[good.id] = ((area.privateWorkers[good.id] as number) * workforce) / total;
    }
    total = workforce;
  }
  // The rest stay unemployed: production starts matched to demand, and they are the pool that government jobs and
  // armies hire from.
  area.unemployedWorkers = workforce - total;
  produceArea(world, area, scratch, false); // marginal outputs for the first wage level
}
