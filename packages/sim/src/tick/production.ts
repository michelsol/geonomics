// Phase 1: production (specification §5, Production).
import { EPSILON } from "../math";
import type { Area, Good, World } from "../types";
import { type Scratch, scratchOf } from "./scratch";

/** Units one worker produces per game day at the area's productivity and its owner's research level. */
export function hourlyOutputPerWorker(world: World, area: Area, good: Good): number {
  const { hoursPerWorkerDay } = world.config.economy;
  const owner = area.owner === null ? undefined : world.governments[area.owner];
  const research = owner ? 1 + owner.researchLevel * world.config.government.researchProductivityBonus : 1;
  return (hoursPerWorkerDay * area.productivity * research) / good.laborHoursPerUnit;
}

export function runProduction(world: World): void {
  const scratch = scratchOf(world);
  for (const area of world.areas) produceArea(world, area, scratch, true);
}

/**
 * Produces every good of one area in catalog order. With commit false, nothing in the area changes and only the
 * marginal output per worker and the producible flags are computed (used to initialize the world).
 */
export function produceArea(world: World, area: Area, scratch: Scratch, commit: boolean): void {
  const days = world.config.pace.gameDaysPerTick;
  const { goods } = world;
  const { maximumByLabor, ration, users } = scratch;
  const marginal = scratch.marginalOutput[area.id] as Float64Array;
  const producible = scratch.producible[area.id] as Uint8Array;
  let stock = area.stock;
  if (!commit) {
    scratch.values.set(area.stock);
    stock = scratch.values;
  }

  for (const good of goods) {
    maximumByLabor[good.id] = good.isPrimary
      ? 0
      : (area.privateWorkers[good.id] as number) * hourlyOutputPerWorker(world, area, good) * days;
  }

  for (const good of goods) {
    const g = good.id;
    const hourly = hourlyOutputPerWorker(world, area, good);
    let output = 0;

    if (good.isPrimary) {
      const capacity = area.naturalCapacity[g] as number;
      if (capacity > EPSILON) {
        const laborOutputPerDay = (area.privateWorkers[g] as number) * hourly;
        const saturation = Math.exp(-laborOutputPerDay / capacity);
        output = capacity * (1 - saturation) * days;
        marginal[g] = hourly * saturation;
        producible[g] = 1;
        if (commit && good.depletionPerUnitExtracted > 0) {
          area.naturalCapacity[g] = Math.max(0, capacity - output * good.depletionPerUnitExtracted);
        }
      } else {
        marginal[g] = 0;
        producible[g] = 0;
      }
      if (commit) area.outputLimitedByInputs[g] = 0;
    } else {
      let minimumRation = 1;
      for (const input of good.inputs) minimumRation = Math.min(minimumRation, ration[input.good] as number);
      output = (maximumByLabor[g] as number) * minimumRation;
      for (const input of good.inputs) {
        stock[input.good] = Math.max(0, (stock[input.good] as number) - output * input.quantity);
      }
      // An extra worker only adds output as far as inputs are available, so value added falls smoothly with supply.
      const limited = minimumRation < 1 - 1e-9;
      marginal[g] = hourly * minimumRation;
      producible[g] = 1;
      if (commit) area.outputLimitedByInputs[g] = limited ? 1 : 0;
    }

    stock[g] = (stock[g] as number) + output;
    if (commit) area.produced[g] = output;

    // Every user of this good comes later in the catalog, so its ration can be fixed now.
    let requested = 0;
    for (const user of users[g] as Scratch["users"][number])
      requested += (maximumByLabor[user.good] as number) * user.quantity;
    ration[g] = Math.min(1, (stock[g] as number) / Math.max(requested, EPSILON));
    if (commit) area.inputDemanded[g] = requested;
  }
}
