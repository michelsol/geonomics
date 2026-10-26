// Phase 5: taxes, subsidies, wages of workers, staff and soldiers, and construction payments (specification §5, Tax
// collection, Hiring and wages, Infrastructure; specification §6, Armies).
import { armyArea } from "../army";
import { infrastructureBillPerDay, staffWageShareOf } from "../infrastructure";
import { EPSILON } from "../math";
import type { Area, GovernmentAreaState, World } from "../types";
import { incomeTaxPerDay } from "./labor";
import { policiesOf, type Scratch, scratchOf } from "./scratch";

export function runTaxes(world: World): void {
  const scratch = scratchOf(world);
  const days = world.config.pace.gameDaysPerTick;
  const wagePerWorker = world.config.economy.hoursPerWorkerDay * days;
  const { paymentDue } = scratch;
  scratch.paidShare.length = world.governments.length;

  for (const government of world.governments) {
    scratch.paidShare[government.id] = 1;
    if (government.isEliminated) continue;
    for (const id of government.ownedAreas) {
      const area = world.areas[id] as Area;
      const state = government.areaStates.get(id) as GovernmentAreaState;
      government.treasury += collect(world, scratch, area, state);
      let workers = 0;
      for (const job of state.jobs) workers += job.workers;
      const share = staffWageShareOf(world.config, state.resolvedPolicies);
      const infrastructure = infrastructureBillPerDay(world.config, area, state, share);
      paymentDue[id] =
        (paymentDue[id] as number) +
        workers * state.wageOffer * wagePerWorker +
        (infrastructure.staff + infrastructure.construction) * days;
    }
    let bill = 0;
    for (const id of government.ownedAreas) bill += paymentDue[id] as number;
    // Soldiers are paid in the area where their army stands, or the one it left while marching.
    const wagePerSoldier = government.soldierWage * wagePerWorker;
    for (const army of world.armies.values()) if (army.owner === government.id) bill += army.soldiers * wagePerSoldier;

    // Subsidies and wages are paid from the treasury, all scaled down together when it runs short.
    const share = bill > EPSILON ? Math.min(1, Math.max(0, government.treasury) / bill) : 1;
    scratch.paidShare[government.id] = share;
    government.treasury -= bill * share;
    for (const id of government.ownedAreas) (world.areas[id] as Area).savings += (paymentDue[id] as number) * share;
    for (const army of world.armies.values()) {
      if (army.owner !== government.id) continue;
      (world.areas[armyArea(army)] as Area).savings += army.soldiers * wagePerSoldier * share;
    }
  }
}

/**
 * Collects an area's taxes: the consumption tax accumulated this tick, the income tax on the wage bands of the
 * consumption phase, the unemployed tax and the head tax. What savings cannot cover is taken in kind, most valuable
 * goods first, into the depot. Returns the money collected. A negative income tax tops wages up, a negative unemployed
 * tax is a benefit and a negative head tax an allowance: each is added to what the treasury owes the area instead.
 */
function collect(world: World, scratch: Scratch, area: Area, state: GovernmentAreaState): number {
  const days = world.config.pace.gameDaysPerTick;
  const policies = policiesOf(world, area, scratch);
  const owe = (amount: number) => {
    scratch.paymentDue[area.id] = (scratch.paymentDue[area.id] as number) + amount;
  };
  const headTax = policies.headTaxPerPersonPerDay * area.population * days;
  const unemployedTax = policies.unemployedTaxPerDay * area.unemployedWorkers * days;
  const incomeTax = incomeTaxPerDay(world, area, scratch, policies);
  owe(Math.max(0, -headTax) + Math.max(0, -unemployedTax) + incomeTax.topUp * days);
  const due =
    (scratch.taxDue[area.id] as number) + Math.max(0, headTax) + Math.max(0, unemployedTax) + incomeTax.tax * days;
  if (due <= 0) return 0;
  const paid = Math.min(due, area.savings);
  area.savings -= paid;
  let shortfall = due - paid;
  if (shortfall > EPSILON) {
    const byPrice = world.goods
      .filter((good) => !good.isService && (area.stock[good.id] as number) > 0)
      .sort((a, b) => (area.price[b.id] as number) - (area.price[a.id] as number) || a.id - b.id);
    for (const good of byPrice) {
      const price = area.price[good.id] as number;
      const quantity = Math.min(area.stock[good.id] as number, shortfall / price);
      area.stock[good.id] = (area.stock[good.id] as number) - quantity;
      state.depot[good.id] = (state.depot[good.id] as number) + quantity;
      shortfall -= quantity * price;
      if (shortfall <= EPSILON) break;
    }
  }
  return paid;
}
