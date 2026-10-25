// Water cells worked through ports (specification §5, Water cells; §6, Infrastructure): which cells each port
// reaches, and the extraction capacity an area gets from its land and its share of those cells.
import { kindIndex, portLevelChanges } from "./infrastructure";
import type { Area, AreaId, GoodId, WaterId, World } from "./types";

/** What reach needs to know of a water cell; WaterCell and the static data's water cells both fit. */
export interface WaterGraph {
  neighbors: readonly WaterId[];
  coasts: readonly AreaId[];
}

/** One water cell an area's port reaches, with the area's share of it: 1 over the number of ports reaching it. */
export interface Reach {
  water: WaterId;
  share: number;
}

const NO_REACH: readonly Reach[] = [];

/** Per area, the water cells touching it. */
export function shores(waters: readonly WaterGraph[], areaCount: number): WaterId[][] {
  const shore: WaterId[][] = Array.from({ length: areaCount }, () => []);
  for (const [id, water] of waters.entries()) for (const area of water.coasts) shore[area]?.push(id);
  return shore;
}

/** The water cells within `hops` hops of a shore, a shore cell being one hop away, with their hop counts. */
export function withinHops(
  waters: readonly WaterGraph[],
  shore: readonly WaterId[],
  hops: number,
): Map<WaterId, number> {
  const found = new Map<WaterId, number>();
  if (hops < 1) return found;
  const queue = [...shore];
  for (const id of shore) found.set(id, 1);
  for (let head = 0; head < queue.length; head++) {
    const current = queue[head] as WaterId;
    const hop = found.get(current) as number;
    if (hop >= hops) continue;
    for (const next of (waters[current] as WaterGraph).neighbors) {
      if (found.has(next)) continue;
      found.set(next, hop + 1);
      queue.push(next);
    }
  }
  return found;
}

/**
 * Per area, the water cells its port reaches: every cell within portLevel hops over water, a cell touching the area
 * being one hop away. A cell reached by several ports is shared equally between them. A pure function of the water
 * graph and the built port levels, so the interface computes the same reach from public data.
 */
export function waterReach(waters: readonly WaterGraph[], portLevel: ArrayLike<number>): (readonly Reach[])[] {
  const shore = shores(waters, portLevel.length);
  const ports = new Uint16Array(waters.length);
  const reached: WaterId[][] = Array.from({ length: portLevel.length }, (_, area) => {
    const level = portLevel[area] as number;
    if (level < 1) return [];
    const list = [...withinHops(waters, shore[area] as WaterId[], level).keys()].sort((a, b) => a - b);
    for (const id of list) ports[id] = (ports[id] as number) + 1;
    return list;
  });
  return reached.map((list) =>
    list.length === 0 ? NO_REACH : list.map((water) => ({ water, share: 1 / (ports[water] as number) })),
  );
}

interface ReachCache {
  levels: Uint8Array; // the port levels the reach was computed for
  waters: number; // and the number of water cells
  tick: number; // the tick they were last checked at
  version: number; // portLevelChanges() when they were last checked
  reach: (readonly Reach[])[];
}

const caches = new WeakMap<World, ReachCache>();

/**
 * The world's water reach per area. Port levels are checked again once per tick and after any port level change,
 * and the reach is recomputed when they differ.
 */
export function waterReachOf(world: World): (readonly Reach[])[] {
  let cache = caches.get(world);
  const fresh = cache?.waters === world.waters.length;
  if (cache && fresh && cache.tick === world.tick && cache.version === portLevelChanges()) return cache.reach;
  const levels = cache?.levels;
  const same =
    fresh &&
    levels !== undefined &&
    levels.length === world.areas.length &&
    world.areas.every((area) => levels[area.id] === area.portLevel);
  if (cache && same) {
    cache.tick = world.tick;
    cache.version = portLevelChanges();
    return cache.reach;
  }
  const current = Uint8Array.from(world.areas, (area) => area.portLevel);
  cache = {
    levels: current,
    waters: world.waters.length,
    tick: world.tick,
    version: portLevelChanges(),
    reach: world.waters.length > 0 ? waterReach(world.waters, current) : world.areas.map(() => NO_REACH),
  };
  caches.set(world, cache);
  return cache.reach;
}

const PORT = kindIndex("port");

/**
 * What an area can extract of a primary good per day now: its own natural capacity, plus its share of the current
 * capacity of the water cells its port reaches, times the port's staffed share.
 */
export function extractionCapacity(world: World, area: Area, good: GoodId): number {
  const land = area.naturalCapacity[good] as number;
  const reach = waterReachOf(world)[area.id] as readonly Reach[];
  if (reach.length === 0) return land;
  const staffed = area.staffing[PORT] as number;
  if (staffed <= 0) return land;
  return land + staffed * waterCapacity(world, reach, good);
}

/** The same at full capacity and full staff: what the area could extract once its land and waters recover. */
export function extractionCapacityMaximum(world: World, area: Area, good: GoodId): number {
  let capacity = area.naturalCapacityMaximum[good] as number;
  for (const { water, share } of waterReachOf(world)[area.id] as readonly Reach[])
    capacity += share * (world.waters[water]?.naturalCapacityMaximum[good] as number);
  return capacity;
}

/** An area's share of the current capacity of the water cells it reaches, before staffing. */
export function waterCapacity(world: World, reach: readonly Reach[], good: GoodId): number {
  let capacity = 0;
  for (const { water, share } of reach) capacity += share * (world.waters[water]?.naturalCapacity[good] as number);
  return capacity;
}

/**
 * Takes `lost` units of capacity of a good from an area that extracted from its land and its waters: split between
 * the two in proportion to the capacity each brought, then across the cells in proportion to share × capacity.
 */
export function depleteExtraction(world: World, area: Area, good: GoodId, lost: number): void {
  if (lost <= 0) return;
  const land = area.naturalCapacity[good] as number;
  const reach = waterReachOf(world)[area.id] as readonly Reach[];
  const staffed = reach.length > 0 ? (area.staffing[PORT] as number) : 0;
  const water = staffed > 0 ? waterCapacity(world, reach, good) : 0;
  const total = land + staffed * water;
  if (total <= 0) return;
  area.naturalCapacity[good] = Math.max(0, land - (lost * land) / total);
  if (water <= 0) return;
  // Each cell loses its part of the water's lost capacity, in proportion to share × capacity.
  const lostAtSea = (lost * staffed * water) / total;
  for (const { water: id, share } of reach) {
    const cell = world.waters[id];
    if (!cell) continue;
    const capacity = cell.naturalCapacity[good] as number;
    cell.naturalCapacity[good] = Math.max(0, capacity - (lostAtSea * share * capacity) / water);
  }
}
