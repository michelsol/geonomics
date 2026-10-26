// Rule 6: start near equilibrium, then warm up (specification §3).
import { reserveDaysOf } from "./math";
import { planDemand } from "./tick/consumption";
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

/** Passes of placing workers and planning what consumers buy at the wages that gives, so the two agree. */
const INITIAL_PASSES = 3;

/**
 * Rule 6, steps 1 to 5: prices at labor value, workers placed to cover local demand where local resources allow,
 * starting stock and savings, and a first average wage, so the first tick starts close to balance. Demand starts at
 * the reference, then becomes what the area's consumers buy at the wages and unemployment that placement gives.
 */
export function initializeWorld(world: World): void {
  const perPerson = referenceDemandPerPerson(world);
  const scratch = scratchOf(world);
  const days = world.config.pace.gameDaysPerTick;
  const e = world.config.economy;
  const consumer = new Float64Array(world.goods.length);
  const total = new Float64Array(world.goods.length);
  for (const area of world.areas) {
    initializePrices(world, area);
    for (const good of world.goods) total[good.id] = (perPerson[good.id] as number) * area.population;
    for (let pass = 0; pass < INITIAL_PASSES; pass++) {
      // Stock first: placing workers runs a production pass that rations inputs from it.
      for (const good of world.goods)
        area.stock[good.id] = good.isService ? 0 : reserveDaysOf(good, world.config) * (total[good.id] as number);
      placeWorkers(world, area, total);
      area.averageWage = computeValueAdded(world, area, scratch, scratch.values);
      const income = Math.max(area.averageWage, 0.1) * e.hoursPerWorkerDay * e.workforceShare;
      area.savings = e.targetSavingsDays * area.population * income;
      planDemand(world, area, scratch);
      for (const good of world.goods) consumer[good.id] = (area.demanded[good.id] as number) / days;
      withInputs(world, consumer, total);
    }
    for (const good of world.goods) {
      const g = good.id;
      area.inputDemanded[g] = ((total[g] as number) - (consumer[g] as number)) * days;
      area.stock[g] = good.isService ? 0 : reserveDaysOf(good, world.config) * (total[g] as number);
    }
    area.satisfaction = 1;
    area.necessitySatisfaction = 1;
    area.militia = area.population * world.config.military.militiaShare;
  }
}

/**
 * Rule 6, step 6: runs warmupDays with no players at boosted economy responsiveness, then restores the pace.
 * Population is frozen meanwhile, so the map's people survive the economy finding its balance.
 */
export function warmUp(world: World, days = world.config.warmupDays): void {
  const pace = world.config.pace;
  const saved = { ...pace };
  pace.economyResponsiveness *= world.config.warmupResponsivenessBoost;
  pace.demographyResponsiveness = 0;
  try {
    const ticks = Math.round(days / pace.gameDaysPerTick);
    for (let i = 0; i < ticks; i++) runTick(world, [], { ai: false }); // no players yet, AI included
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

/** Total demand per day for every good: consumer demand, plus the inputs needed to make all of it, into `total`. */
function withInputs(world: World, consumer: Float64Array, total: Float64Array): void {
  total.set(consumer);
  // Outputs come after their inputs, so walking backwards adds each recipe's input demand before the input is read.
  for (let g = world.goods.length - 1; g >= 0; g--) {
    const good = world.goods[g] as World["goods"][number];
    for (const input of good.inputs)
      total[input.good] = (total[input.good] as number) + (total[g] as number) * input.quantity;
  }
}

/** Rule 6, step 2: workers to cover the area's total demand per day where resources allow; the rest stay unemployed. */
function placeWorkers(world: World, area: Area, demandPerDay: Float64Array): void {
  const scratch = scratchOf(world);
  const workforce = area.population * world.config.economy.workforceShare;
  let total = 0;
  for (const good of world.goods) {
    const workers = workersFor(world, area, good, demandPerDay[good.id] as number);
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
  produceArea(world, area, scratch, false); // marginal outputs for the first average wage
}
