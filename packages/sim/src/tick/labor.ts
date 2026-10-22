// Phase 7: labor allocation (specification §5, Labor allocation). Government hiring joins this phase in stage 6.
import { EPSILON, fractionPerTick, reserveDaysOf } from "../math";
import type { Area, World } from "../types";
import { savingsFactor } from "./consumption";
import { hourlyOutputPerWorker } from "./production";
import { policiesOf, type Scratch, scratchOf, suppliedForPerTick } from "./scratch";

/** Primary goods are never planned beyond this share of natural capacity, where extra labor adds almost nothing. */
const MAXIMUM_PLANNED_CAPACITY_USE = 0.95;

/**
 * Value added per worker-hour of each good, from smoothed prices after production tax, into `out`. Uses the
 * marginal output per worker computed by the last production pass. Returns the area's wage level, or its previous
 * wage level when it has no private workers.
 */
export function computeValueAdded(world: World, area: Area, scratch: Scratch, out: Float64Array): number {
  const { hoursPerWorkerDay } = world.config.economy;
  const productionTax = policiesOf(world, area, scratch).productionTaxRate;
  const marginal = scratch.marginalOutput[area.id] as Float64Array;
  const sp = area.smoothedPrice;
  let weighted = 0;
  let workers = 0;
  for (const good of world.goods) {
    const g = good.id;
    let margin = (sp[g] as number) * (1 - (productionTax[g] as number));
    for (const input of good.inputs) margin -= input.quantity * (sp[input.good] as number);
    const valueAdded = (margin * (marginal[g] as number)) / hoursPerWorkerDay;
    out[g] = valueAdded;
    weighted += valueAdded * (area.privateWorkers[g] as number);
    workers += area.privateWorkers[g] as number;
  }
  return workers > EPSILON ? weighted / workers : area.wageLevel;
}

/** Workers needed to produce `unitsPerDay` of a good in an area; 0 when the area cannot produce it. */
export function workersFor(world: World, area: Area, good: World["goods"][number], unitsPerDay: number): number {
  if (unitsPerDay <= 0) return 0;
  const hourly = hourlyOutputPerWorker(world, area, good);
  if (!good.isPrimary) return unitsPerDay / hourly;
  const capacity = area.naturalCapacity[good.id] as number;
  if (capacity <= EPSILON) return 0;
  const planned = Math.min(unitsPerDay, MAXIMUM_PLANNED_CAPACITY_USE * capacity);
  return (-capacity * Math.log(1 - planned / capacity)) / hourly;
}

/**
 * Target workers per good: the labor needed to meet total demand (local consumers, local producers and exports)
 * and to bring the stock back to its reserve, tilted by value added against the reservation wage. Jobs adding more
 * than the reservation wage grow beyond their need, jobs adding less shrink. Writes into `targets`, scaled down
 * together when they exceed the available workforce, and returns the target number of unemployed.
 */
export function laborTargets(
  world: World,
  area: Area,
  scratch: Scratch,
  valueAdded: Float64Array,
  available: number,
  targets: Float64Array,
): number {
  const e = world.config.economy;
  const days = world.config.pace.gameDaysPerTick;
  const producible = scratch.producible[area.id] as Uint8Array;
  // Workers short of savings accept less, rich ones ask more: an area that imports more than it exports gets
  // cheaper until its goods sell abroad, and the reverse.
  const reservation = e.reservationWage * savingsFactor(world, area);
  const temperature = e.laborAllocationTemperature * reservation;
  let total = 0;
  for (const good of world.goods) {
    const g = good.id;
    if (!producible[g]) {
      targets[g] = 0;
      continue;
    }
    const demandedPerDay = suppliedForPerTick(world, scratch, area, g) / days;
    const restock = good.isService
      ? 0
      : (reserveDaysOf(good, world.config) * demandedPerDay - (area.stock[g] as number)) / e.stockRecoveryDays;
    const tilt = Math.exp(Math.min(((valueAdded[g] as number) - reservation) / temperature, 5));
    targets[g] = workersFor(world, area, good, demandedPerDay + restock) * tilt;
    total += targets[g] as number;
  }
  if (total > available) {
    for (const good of world.goods) targets[good.id] = ((targets[good.id] as number) * available) / total;
    total = available;
  }
  return available - total;
}

export function runLabor(world: World): void {
  const scratch = scratchOf(world);
  const e = world.config.economy;
  const mobility = fractionPerTick(
    e.laborMobilityRatePerDay,
    world.config.pace.economyResponsiveness,
    world.config.pace.gameDaysPerTick,
  );
  const valueAdded = scratch.values;
  const targets = scratch.weights;

  for (const area of world.areas) {
    area.wageLevel = computeValueAdded(world, area, scratch, valueAdded);

    let available = area.unemployedWorkers;
    for (const good of world.goods) available += area.privateWorkers[good.id] as number;
    if (available <= EPSILON) continue;
    const unemployedTarget = laborTargets(world, area, scratch, valueAdded, available, targets);

    // Moves toward the targets, scaled down together if more than the shift limit would change jobs.
    let joining = Math.max(0, mobility * (unemployedTarget - area.unemployedWorkers));
    for (const good of world.goods) {
      const g = good.id;
      targets[g] = mobility * ((targets[g] as number) - (area.privateWorkers[g] as number)); // now the change
      joining += Math.max(0, targets[g] as number);
    }
    const workforce = area.population * e.workforceShare;
    const scale = joining > e.maxLaborShiftPerTick * workforce ? (e.maxLaborShiftPerTick * workforce) / joining : 1;

    let employed = 0;
    for (const good of world.goods) {
      const g = good.id;
      const workers = Math.max(0, (area.privateWorkers[g] as number) + (targets[g] as number) * scale);
      area.privateWorkers[g] = workers;
      employed += workers;
    }
    // Unemployment absorbs the difference, so the private workforce is conserved exactly.
    if (employed > available) {
      const shrink = available / employed;
      for (const good of world.goods) area.privateWorkers[good.id] = (area.privateWorkers[good.id] as number) * shrink;
      employed = available;
    }
    area.unemployedWorkers = available - employed;
  }
}
