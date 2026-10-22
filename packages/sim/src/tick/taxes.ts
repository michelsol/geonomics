// Phase 5: taxes, subsidies and wages (specification §6, Tax collection, Hiring and wages).
import { EPSILON } from "../math";
import type { Area, GovernmentAreaState, World } from "../types";
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
      paymentDue[id] = (paymentDue[id] as number) + workers * state.wageOffer * wagePerWorker;
    }
    let bill = 0;
    for (const id of government.ownedAreas) bill += paymentDue[id] as number;

    // Subsidies and wages are paid from the treasury, all scaled down together when it runs short.
    const share = bill > EPSILON ? Math.min(1, Math.max(0, government.treasury) / bill) : 1;
    scratch.paidShare[government.id] = share;
    government.treasury -= bill * share;
    for (const id of government.ownedAreas) (world.areas[id] as Area).savings += (paymentDue[id] as number) * share;
  }
}

/**
 * Collects an area's taxes: production and consumption taxes accumulated this tick plus the head tax. What savings
 * cannot cover is taken in kind, most valuable goods first, into the depot. Returns the money collected.
 */
function collect(world: World, scratch: Scratch, area: Area, state: GovernmentAreaState): number {
  const days = world.config.pace.gameDaysPerTick;
  const headTax = policiesOf(world, area, scratch).headTaxPerPersonPerDay;
  const due = (scratch.taxDue[area.id] as number) + headTax * area.population * days;
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
