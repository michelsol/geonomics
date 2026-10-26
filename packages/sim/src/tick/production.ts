// Phase 1: production (specification §4, Production), private and government.
import { EPSILON } from "../math";
import type { Area, Good, GovernmentAreaState, World } from "../types";
import { depleteExtraction, extractionCapacity } from "../waters";
import { type Scratch, scratchOf } from "./scratch";

/** Worker-hours per worker per game day at the area's productivity. */
export function effectiveHoursPerWorkerDay(world: World, area: Area): number {
  return world.config.economy.hoursPerWorkerDay * area.productivity;
}

/** Units one worker produces per game day at the area's productivity. */
export function hourlyOutputPerWorker(world: World, area: Area, good: Good): number {
  return effectiveHoursPerWorkerDay(world, area) / good.laborHoursPerUnit;
}

export function runProduction(world: World): void {
  const scratch = scratchOf(world);
  collectStateWorkers(world, scratch);
  scratch.taxDue.fill(0);
  scratch.paymentDue.fill(0);
  for (const area of world.areas) {
    produceArea(world, area, scratch, true);
    const workers = scratch.stateWorkers[area.id];
    if (workers) produceForState(world, area, stateOf(world, area), workers, scratch);
  }
}

function stateOf(world: World, area: Area): GovernmentAreaState {
  return world.governments[area.owner as number]?.areaStates.get(area.id) as GovernmentAreaState;
}

/** Workers of government produce jobs per area and good; areas without such jobs get null. */
function collectStateWorkers(world: World, scratch: Scratch): void {
  const { stateWorkers } = scratch;
  for (let a = 0; a < stateWorkers.length; a++) if (stateWorkers[a]) (stateWorkers[a] as Float64Array).fill(0);
  const used = new Set<number>();
  for (const government of world.governments) {
    for (const [areaId, state] of government.areaStates) {
      for (const assignment of state.jobs) {
        if (assignment.job.kind !== "produce" || assignment.workers <= 0) continue;
        let workers = stateWorkers[areaId];
        if (!workers) {
          workers = new Float64Array(world.goods.length);
          stateWorkers[areaId] = workers;
        }
        workers[assignment.job.good] = (workers[assignment.job.good] as number) + assignment.workers;
        used.add(areaId);
      }
    }
  }
  for (let a = 0; a < stateWorkers.length; a++) if (!used.has(a)) stateWorkers[a] = null;
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

  const stateWorkers = commit ? scratch.stateWorkers[area.id] : null;
  const depot = stateWorkers ? stateOf(world, area).depot : null;

  const hours = effectiveHoursPerWorkerDay(world, area);
  for (const good of goods) {
    maximumByLabor[good.id] = good.isPrimary
      ? 0
      : ((area.privateWorkers[good.id] as number) * hours * days) / good.laborHoursPerUnit;
  }

  for (const good of goods) {
    const g = good.id;
    const hourly = hours / good.laborHoursPerUnit;
    let output = 0; // private output, to the area's stock
    let stateOutput = 0; // government output, to the depot

    if (good.isPrimary) {
      // The area's land and its share of the water cells its port reaches (section 5, Infrastructure).
      const capacity = extractionCapacity(world, area, g);
      if (capacity > EPSILON) {
        // Private and government workers share the natural capacity; output is split in proportion to workers.
        const privateWorkers = area.privateWorkers[g] as number;
        const totalWorkers = privateWorkers + (stateWorkers ? (stateWorkers[g] as number) : 0);
        const saturation = Math.exp(-(totalWorkers * hourly) / capacity);
        const totalOutput = capacity * (1 - saturation) * days;
        output =
          totalWorkers > privateWorkers
            ? (totalOutput * privateWorkers) / Math.max(totalWorkers, EPSILON)
            : totalOutput;
        stateOutput = totalOutput - output;
        if (depot) depot[g] = (depot[g] as number) + stateOutput;
        marginal[g] = hourly * saturation;
        producible[g] = 1;
        if (commit && good.depletionPerUnitExtracted > 0)
          depleteExtraction(world, area, g, totalOutput * good.depletionPerUnitExtracted);
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
    if (commit) {
      area.produced[g] = output + stateOutput;
    }

    // Every user of this good comes later in the catalog, so its ration can be fixed now.
    let requested = 0;
    for (const user of users[g] as Scratch["users"][number])
      requested += (maximumByLabor[user.good] as number) * user.quantity;
    ration[g] = Math.min(1, (stock[g] as number) / Math.max(requested, EPSILON));
    if (commit) area.inputDemanded[g] = requested;
  }
}

/**
 * Government production of crafted goods in one area, after private production: inputs come from the depot and
 * output goes to it, with the depot's stock rationed between the government's recipes the same way as private
 * stock. Government primary output was already added to the depot by the private pass, which shares the capacity.
 */
function produceForState(
  world: World,
  area: Area,
  state: GovernmentAreaState,
  workers: Float64Array,
  scratch: Scratch,
): void {
  const days = world.config.pace.gameDaysPerTick;
  const { maximumByLabor, ration, users } = scratch;
  const { depot } = state;
  const hours = effectiveHoursPerWorkerDay(world, area);
  for (const good of world.goods) {
    maximumByLabor[good.id] = good.isPrimary
      ? 0
      : ((workers[good.id] as number) * hours * days) / good.laborHoursPerUnit;
  }
  for (const good of world.goods) {
    const g = good.id;
    if (!good.isPrimary && (maximumByLabor[g] as number) > 0) {
      let minimumRation = 1;
      for (const input of good.inputs) minimumRation = Math.min(minimumRation, ration[input.good] as number);
      const output = (maximumByLabor[g] as number) * minimumRation;
      for (const input of good.inputs) {
        depot[input.good] = Math.max(0, (depot[input.good] as number) - output * input.quantity);
      }
      depot[g] = (depot[g] as number) + output;
      area.produced[g] = (area.produced[g] as number) + output;
    }
    let requested = 0;
    for (const user of users[g] as Scratch["users"][number])
      requested += (maximumByLabor[user.good] as number) * user.quantity;
    ration[g] = Math.min(1, (depot[g] as number) / Math.max(requested, EPSILON));
  }
}
