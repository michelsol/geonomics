// Phase 9: population growth, starvation and migration (specification §5, Population).
import { EPSILON, fractionPerTick } from "../math";
import type { Area, Edge, World } from "../types";
import { scratchOf } from "./scratch";

export function runPopulation(world: World): void {
  const scratch = scratchOf(world);
  const p = world.config.population;
  const { demographyResponsiveness, gameDaysPerTick: days } = world.config.pace;

  const natural = scratch.naturalChange;
  for (const area of world.areas) {
    const s = area.necessitySatisfaction;
    const threshold = p.growthSatisfactionThreshold;
    const growth =
      s >= threshold
        ? (p.growthRatePerDay * (s - threshold)) / Math.max(1 - threshold, EPSILON)
        : (-p.starvationRatePerDay * (threshold - s)) / Math.max(threshold, EPSILON);
    const before = area.population;
    changePopulation(world, area, area.population * (Math.exp(growth * demographyResponsiveness * days) - 1));
    natural[area.id] = area.population - before;
  }

  // Migration reads populations and attractiveness after growth, then applies every edge together.
  const attractiveness = scratch.attractiveness;
  const delta = scratch.migrationDelta;
  const perEdge = scratch.edgeMigration;
  delta.fill(0);
  perEdge.fill(0);
  for (const area of world.areas) {
    const wage = Math.max(area.wageLevel, 0);
    attractiveness[area.id] =
      (1 - p.migrationWageWeight) * area.satisfaction + (p.migrationWageWeight * wage) / (wage + 1);
  }
  const migration = fractionPerTick(p.migrationRatePerDay, demographyResponsiveness, days);
  for (const edge of world.edges) {
    if (!edge.isActive || edge.isBlocked) continue;
    const a = world.areas[edge.areaA] as Area;
    const b = world.areas[edge.areaB] as Area;
    const difference = (attractiveness[b.id] as number) - (attractiveness[a.id] as number);
    if (difference === 0) continue;
    const source = difference > 0 ? a : b;
    const destination = difference > 0 ? b : a;
    const migrants =
      (source.population * migration * Math.abs(difference) * modeFactor(world, edge)) / openEdgeCount(world, source);
    delta[source.id] = (delta[source.id] as number) - migrants;
    delta[destination.id] = (delta[destination.id] as number) + migrants;
    perEdge[edge.id] = difference > 0 ? migrants : -migrants;
  }
  for (const area of world.areas) changePopulation(world, area, delta[area.id] as number);
}

/**
 * Migrants who crossed each edge in the last population phase, positive from area A to area B. Recomputed every tick
 * and not part of the saved world.
 */
export function lastMigration(world: World): Float64Array {
  return scratchOf(world).edgeMigration;
}

/**
 * People each area gained by growth, or lost to starvation when negative, in the last population phase. Recomputed
 * every tick and not part of the saved world.
 */
export function lastNaturalChange(world: World): Float64Array {
  return scratchOf(world).naturalChange;
}

/** Migration over an edge relative to a land border; sea and air routes carry migrants only while they run. */
function modeFactor(world: World, edge: Edge): number {
  const t = world.config.transport;
  if (edge.mode === "land") return 1;
  if (!(edge.capacityPerDay > 0)) return 0;
  return edge.mode === "sea" ? t.migrationFactorBySea : t.migrationFactorByAir;
}

function openEdgeCount(world: World, area: Area): number {
  let count = 0;
  for (const id of area.edges) {
    const edge = world.edges[id] as Edge;
    if (edge.isActive && !edge.isBlocked) count++;
  }
  return Math.max(count, 1);
}

/**
 * Adds (or removes, when negative) inhabitants. Newcomers join the unemployed in proportion to the workforce share;
 * lost workers leave the unemployed first, then private jobs in proportion to their size. Government workers and
 * soldiers are not affected.
 */
export function changePopulation(world: World, area: Area, change: number): void {
  const removed = Math.min(-change, area.population);
  const actual = change >= 0 ? change : -removed;
  area.population = Math.max(0, area.population + actual);
  const workers = actual * world.config.economy.workforceShare;
  if (workers >= 0) {
    area.unemployedWorkers += workers;
    return;
  }
  takeWorkers(world, area, -workers);
}

/**
 * Removes up to `count` workers from an area's unemployed first, then from private jobs in proportion to their
 * size. Returns the number actually taken.
 */
export function takeWorkers(world: World, area: Area, count: number): number {
  const fromUnemployed = Math.min(count, area.unemployedWorkers);
  area.unemployedWorkers -= fromUnemployed;
  const wanted = count - fromUnemployed;
  if (wanted <= 0) return fromUnemployed;
  let employed = 0;
  for (const good of world.goods) employed += area.privateWorkers[good.id] as number;
  if (employed <= EPSILON) return fromUnemployed;
  const fromJobs = Math.min(wanted, employed);
  const keep = 1 - fromJobs / employed;
  for (const good of world.goods) area.privateWorkers[good.id] = (area.privateWorkers[good.id] as number) * keep;
  return fromUnemployed + fromJobs;
}
