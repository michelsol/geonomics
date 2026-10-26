// Phase 7: labor allocation (specification §4, Labor allocation).
import { WAGE_BAND_COUNT, wageBandOf } from "../bands";
import { infrastructureBillPerDay, staffWageShareOf } from "../infrastructure";
import { EPSILON, fractionPerTick } from "../math";
import type { Area, ResolvedPolicies, World } from "../types";
import { extractionCapacity } from "../waters";
import { savingsFactor } from "./consumption";
import { effectiveHoursPerWorkerDay } from "./production";
import { policiesOf, type Scratch, scratchOf, suppliedForPerTick } from "./scratch";

/** Primary goods are never planned beyond this share of natural capacity, where extra labor adds almost nothing. */
const MAXIMUM_PLANNED_CAPACITY_USE = 0.95;

/**
 * Value added per worker-hour of each good, from smoothed prices, into `out`: what a worker in the job earns before
 * income tax. Uses the marginal output per worker computed by the last production pass. Returns the area's average
 * wage, or its previous average wage when it has no private workers.
 */
export function computeValueAdded(world: World, area: Area, scratch: Scratch, out: Float64Array): number {
  const { hoursPerWorkerDay } = world.config.economy;
  const marginal = scratch.marginalOutput[area.id] as Float64Array;
  const sp = area.smoothedPrice;
  let weighted = 0;
  let workers = 0;
  for (const good of world.goods) {
    const g = good.id;
    let margin = sp[g] as number;
    for (const input of good.inputs) margin -= input.quantity * (sp[input.good] as number);
    const valueAdded = (margin * (marginal[g] as number)) / hoursPerWorkerDay;
    out[g] = valueAdded;
    weighted += valueAdded * (area.privateWorkers[g] as number);
    workers += area.privateWorkers[g] as number;
  }
  return workers > EPSILON ? weighted / workers : area.averageWage;
}

/**
 * Wage bands of an area (specification §4, Consumption): per band, the workers whose hourly wage falls in it and
 * their hourly wages summed, into `scratch.bandWorkers` and `scratch.bandWages` at `area.id × WAGE_BAND_COUNT`.
 * Private workers earn their job's value added, government workers the wage offer and staff their share of the
 * average wage, both as far as the treasury paid them in the last tax phase. Wages below zero count as zero. Leaves
 * each private job's hourly wage in `scratch.jobWages`.
 */
export function wageBands(world: World, area: Area, scratch: Scratch): void {
  const start = area.id * WAGE_BAND_COUNT;
  const workers = scratch.bandWorkers;
  const wages = scratch.bandWages;
  workers.fill(0, start, start + WAGE_BAND_COUNT);
  wages.fill(0, start, start + WAGE_BAND_COUNT);
  const add = (count: number, wage: number) => {
    if (count <= 0) return;
    const hourly = Math.max(wage, 0);
    const band = start + wageBandOf(hourly);
    workers[band] = (workers[band] as number) + count;
    wages[band] = (wages[band] as number) + count * hourly;
  };
  const jobWages = scratch.jobWages;
  computeValueAdded(world, area, scratch, jobWages);
  for (const good of world.goods) add(area.privateWorkers[good.id] as number, jobWages[good.id] as number);
  const owner = area.owner === null ? undefined : world.governments[area.owner];
  const state = owner?.areaStates.get(area.id);
  if (!owner || !state) return;
  const paidShare = scratch.paidShare[owner.id] ?? 1;
  let governmentWorkers = 0;
  for (const job of state.jobs) governmentWorkers += job.workers;
  add(governmentWorkers, state.wageOffer * paidShare);
  let staff = 0;
  for (const count of state.staff) staff += count;
  const staffWage = staffWageShareOf(world.config, state.resolvedPolicies) * Math.max(area.averageWage, 0);
  add(staff, staffWage * paidShare);
}

/** Income tax owed by an area per day, from its wage bands: what it pays, and the top-ups it is owed when negative. */
export function incomeTaxPerDay(
  world: World,
  area: Area,
  scratch: Scratch,
  policies: ResolvedPolicies,
): { tax: number; topUp: number } {
  const { hoursPerWorkerDay } = world.config.economy;
  const start = area.id * WAGE_BAND_COUNT;
  let tax = 0;
  let topUp = 0;
  for (let band = 0; band < WAGE_BAND_COUNT; band++) {
    const due =
      (policies.incomeTaxRate[band] as number) * (scratch.bandWages[start + band] as number) * hoursPerWorkerDay;
    if (due > 0) tax += due;
    else topUp -= due;
  }
  return { tax, topUp };
}

/**
 * Gross and net income of an area per member of the workforce and day, the unemployed included (specification §9,
 * Income), with the wage of each private job, its value added per worker-day before income tax, into `wages`.
 * Gross income is private value added plus the government wages, staff wages and construction payments paid; net
 * income takes off the income, unemployed, consumption and head taxes, and adds the top-ups, benefits, subsidies and
 * allowances paid. NaN without a workforce.
 */
export function incomeOf(
  world: World,
  area: Area,
  scratch: Scratch,
  wages: Float64Array,
): { gross: number; net: number } {
  const { hoursPerWorkerDay, workforceShare } = world.config.economy;
  const days = world.config.pace.gameDaysPerTick;
  const workforce = area.population * workforceShare;
  wageBands(world, area, scratch);
  wages.set(scratch.jobWages);
  const policies = policiesOf(world, area, scratch);
  const owner = area.owner === null ? undefined : world.governments[area.owner];
  const paidShare = owner ? (scratch.paidShare[owner.id] ?? 1) : 1;
  // A tax is owed in full; a subsidy or allowance is paid as far as the treasury could.
  const paid = (tax: number) => (tax > 0 ? tax : tax * paidShare);
  let gross = 0;
  let consumptionTax = 0;
  for (const good of world.goods) {
    const g = good.id;
    wages[g] = (wages[g] as number) * hoursPerWorkerDay;
    gross += (area.privateWorkers[g] as number) * (wages[g] as number);
    consumptionTax +=
      ((policies.consumptionTaxRate[g] as number) * (area.consumed[g] as number) * (area.price[g] as number)) / days;
  }
  const state = owner?.areaStates.get(area.id);
  if (state) {
    for (const job of state.jobs) gross += job.workers * state.wageOffer * hoursPerWorkerDay * paidShare;
    const bill = infrastructureBillPerDay(
      world.config,
      area,
      state,
      staffWageShareOf(world.config, state.resolvedPolicies),
    );
    gross += (bill.staff + bill.construction) * paidShare;
  }
  if (workforce <= 0) return { gross: Number.NaN, net: Number.NaN };
  const incomeTax = incomeTaxPerDay(world, area, scratch, policies);
  const net =
    gross -
    paid(incomeTax.tax) -
    paid(-incomeTax.topUp) -
    paid(policies.unemployedTaxPerDay * area.unemployedWorkers) -
    paid(consumptionTax) -
    paid(policies.headTaxPerPersonPerDay * area.population);
  return { gross: gross / workforce, net: net / workforce };
}

/** Workers needed to produce `unitsPerDay` of a good in an area; 0 when the area cannot produce it. */
export function workersFor(
  world: World,
  area: Area,
  good: World["goods"][number],
  unitsPerDay: number,
  hours = effectiveHoursPerWorkerDay(world, area),
): number {
  if (unitsPerDay <= 0) return 0;
  const hourly = hours / good.laborHoursPerUnit;
  if (!good.isPrimary) return unitsPerDay / hourly;
  const capacity = extractionCapacity(world, area, good.id);
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
  // cheaper until its goods sell abroad, and the reverse. A benefit for the unemployed makes them ask more too, and
  // each job is weighed after its band's income tax.
  const policies = policiesOf(world, area, scratch);
  const benefit = Math.max(0, -policies.unemployedTaxPerDay) / e.hoursPerWorkerDay;
  const reservation = e.reservationWage * savingsFactor(world, area) + e.benefitReservationShare * benefit;
  const temperature = e.laborAllocationTemperature * reservation;
  const hours = effectiveHoursPerWorkerDay(world, area);
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
      : ((scratch.reserveDays[g] as number) * demandedPerDay - (area.stock[g] as number)) / e.stockRecoveryDays;
    const wage = valueAdded[g] as number;
    const afterTax = wage > 0 ? wage * (1 - (policies.incomeTaxRate[wageBandOf(wage)] as number)) : wage;
    const tilt = Math.exp(Math.min((afterTax - reservation) / temperature, 5));
    targets[g] = workersFor(world, area, good, demandedPerDay + restock, hours) * tilt;
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
    area.averageWage = computeValueAdded(world, area, scratch, valueAdded);

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
