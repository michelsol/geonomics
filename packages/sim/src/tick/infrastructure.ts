// Infrastructure in the tick and at founding (specification §5, Infrastructure; §4, Sea and air routes): construction,
// staffed shares, what roads, ports and airports do to the edges, and the air route rebuild.

import { MinHeap } from "../heap";
import {
  INFRASTRUCTURE_KINDS,
  isBuilding,
  kindIndex,
  levelOf,
  portLevelChanged,
  setLevel,
  staffQuota,
} from "../infrastructure";
import { nextRandom } from "../random";
import { edgeCapacityPerDay, edgeTransportCost } from "../routes";
import { chord } from "../sphere";
import type { Area, AreaId, Edge, GovernmentAreaState, InfrastructureKind, World } from "../types";
import { addEdge } from "../world";
import { takeWorkers } from "./population";
import { scratchOf } from "./scratch";

/**
 * Phase 10: construction advances by the days paid for (all of them unless the treasury fell short), and a kind
 * reaching its build days gains a level. Then the edges follow the infrastructure as it runs.
 */
export function runConstruction(world: World): void {
  const scratch = scratchOf(world);
  const days = world.config.pace.gameDaysPerTick;
  const { buildDaysPerLevel } = world.config.infrastructure;
  let airports = false;
  let ports = false;
  for (const government of world.governments) {
    if (government.isEliminated) continue;
    const paid = scratch.paidShare[government.id] ?? 1;
    for (const [id, state] of government.areaStates) {
      const area = world.areas[id] as Area;
      for (const [k, kind] of INFRASTRUCTURE_KINDS.entries()) {
        if (!isBuilding(world.config, area, state, kind)) {
          state.buildDays[k] = 0;
          continue;
        }
        state.buildDays[k] = (state.buildDays[k] as number) + days * paid;
        if ((state.buildDays[k] as number) < buildDaysPerLevel[kind]) continue;
        state.buildDays[k] = 0;
        setLevel(area, kind, levelOf(area, kind) + 1);
        if (kind === "airport") airports = true;
        if (kind === "port") ports = true;
      }
    }
  }
  if (airports) rebuildAirRoutes(world);
  if (ports) rebuildSeaRoutes(world);
  updateInfrastructureEffects(world);
}

/** Land transport costs and route capacities from the infrastructure as it runs. */
export function updateInfrastructureEffects(world: World): void {
  for (const edge of world.edges) updateEdge(world, edge);
}

/** The same for the edges of one area, after its infrastructure changed. */
export function updateRouteCapacities(world: World, area: Area): void {
  for (const id of area.edges) updateEdge(world, world.edges[id] as Edge);
}

function updateEdge(world: World, edge: Edge): void {
  const a = world.areas[edge.areaA] as Area;
  const b = world.areas[edge.areaB] as Area;
  if (edge.mode === "land") edge.transportCost = edgeTransportCost(world.config, edge, a, b);
  else edge.capacityPerDay = edgeCapacityPerDay(world.config, edge, a, b);
}

/** Each kind's staffed share of its quota, 0 where nothing is built or the area has no government. */
export function updateStaffing(world: World, area: Area, state: GovernmentAreaState | undefined): void {
  for (const [k, kind] of INFRASTRUCTURE_KINDS.entries()) {
    const quota = staffQuota(world.config, area, kind);
    area.staffing[k] = state && quota > 0 ? Math.min(1, (state.staff[k] as number) / quota) : 0;
  }
}

/**
 * Lowers a kind to `level` at once, for free: construction stops, staff beyond the new quota become unemployed, and
 * the edges follow.
 */
export function lowerInfrastructure(
  world: World,
  area: Area,
  state: GovernmentAreaState,
  kind: InfrastructureKind,
  level: number,
): void {
  const k = kindIndex(kind);
  setLevel(area, kind, level);
  state.buildDays[k] = 0;
  const quota = staffQuota(world.config, area, kind);
  if ((state.staff[k] as number) > quota) {
    area.unemployedWorkers += (state.staff[k] as number) - quota;
    state.staff[k] = quota;
  }
  updateStaffing(world, area, state);
  if (kind === "airport") rebuildAirRoutes(world);
  if (kind === "port") rebuildSeaRoutes(world);
  updateRouteCapacities(world, area);
}

/** Fills every quota at once from each area's workforce, as hiring would over time; used when a game starts. */
export function staffFully(world: World): void {
  for (const government of world.governments) {
    if (government.isEliminated) continue;
    for (const [id, state] of government.areaStates) {
      const area = world.areas[id] as Area;
      for (const [k, kind] of INFRASTRUCTURE_KINDS.entries()) {
        const missing = staffQuota(world.config, area, kind) - (state.staff[k] as number);
        if (missing > 0) state.staff[k] = (state.staff[k] as number) + takeWorkers(world, area, missing);
      }
      updateStaffing(world, area, state);
    }
  }
  updateInfrastructureEffects(world);
}

/**
 * A new game's infrastructure, once the realms are founded: a port of level 1 in each coastal area with chance
 * startingPortShare (seeded), and airports of level 1 in each realm's capital and then its most populous areas, up
 * to startingAirports. A landmass left without any port gets one in its most populous coastal area, so no island is
 * cut off. Everything starts fully staffed.
 */
export function placeStartingInfrastructure(world: World): void {
  const { startingPortShare, startingAirports } = world.config.infrastructure;
  const byPopulation = (a: Area, b: Area) => b.population - a.population || a.id - b.id;
  for (const area of world.areas)
    if (area.isCoastal && nextRandom(world) < startingPortShare) area.portLevel = Math.max(area.portLevel, 1);
  for (const government of world.governments) {
    if (government.isEliminated) continue;
    const owned = government.ownedAreas.map((id) => world.areas[id] as Area).sort(byPopulation);
    const capital = owned.find((area) => area.id === government.capital);
    const capitalFirst = capital ? [capital, ...owned.filter((area) => area !== capital)] : owned;
    for (const area of capitalFirst.slice(0, startingAirports)) area.airportLevel = Math.max(area.airportLevel, 1);
  }
  for (const landmass of landmasses(world)) {
    if (landmass.some((area) => area.portLevel >= 1)) continue;
    const coast = landmass.filter((area) => area.isCoastal).sort(byPopulation)[0];
    if (coast) coast.portLevel = 1;
  }
  portLevelChanged();
  for (const government of world.governments) {
    for (const [id, state] of government.areaStates) {
      const area = world.areas[id] as Area;
      for (const [k, kind] of INFRASTRUCTURE_KINDS.entries())
        state.targetLevel[k] = Math.max(state.targetLevel[k] as number, levelOf(area, kind));
    }
  }
  rebuildAirRoutes(world);
  rebuildSeaRoutes(world);
  staffFully(world);
}

/** Groups of areas joined by active land edges. */
function landmasses(world: World): Area[][] {
  const seen = new Uint8Array(world.areas.length);
  const groups: Area[][] = [];
  for (const start of world.areas) {
    if (seen[start.id]) continue;
    seen[start.id] = 1;
    const group = [start];
    for (let i = 0; i < group.length; i++) {
      for (const id of (group[i] as Area).edges) {
        const edge = world.edges[id] as Edge;
        if (edge.mode !== "land" || !edge.isActive) continue;
        const other = edge.areaA === (group[i] as Area).id ? edge.areaB : edge.areaA;
        if (seen[other]) continue;
        seen[other] = 1;
        group.push(world.areas[other] as Area);
      }
    }
    groups.push(group);
  }
  return groups;
}

const pairKey = (a: AreaId, b: AreaId) => (a < b ? `${a}-${b}` : `${b}-${a}`);

/**
 * Links each port to its seaRoutesPerPort nearest ports by sea, along the lanes between coasts, without sailing past
 * another port. Like air routes, routes no longer wanted are deactivated, never deleted, so edge ids stay stable. A
 * world without lanes (built by hand) keeps the sea routes it was given.
 */
export function rebuildSeaRoutes(world: World): void {
  if (!world.edges.some((edge) => edge.isLane)) return;
  const wanted = new Map<string, { a: AreaId; b: AreaId; distance: number }>();
  for (const port of world.areas) {
    if (port.portLevel < 1) continue;
    const distance = new Map<AreaId, number>([[port.id, 0]]);
    const heap = new MinHeap();
    heap.push(0, port.id);
    let found = 0;
    while (heap.size > 0 && found < world.config.transport.seaRoutesPerPort) {
      const [d, current] = heap.pop();
      if (d > (distance.get(current) ?? Number.POSITIVE_INFINITY)) continue;
      if (current !== port.id && (world.areas[current] as Area).portLevel >= 1) {
        found++;
        const key = pairKey(port.id, current);
        if ((wanted.get(key)?.distance ?? Number.POSITIVE_INFINITY) > d)
          wanted.set(key, { a: Math.min(port.id, current), b: Math.max(port.id, current), distance: d });
        continue; // a route ends at the first port it meets
      }
      for (const id of (world.areas[current] as Area).edges) {
        const edge = world.edges[id] as Edge;
        if (!edge.isLane || !edge.isActive) continue;
        const other = edge.areaA === current ? edge.areaB : edge.areaA;
        const next = d + edge.distance;
        if (next < (distance.get(other) ?? Number.POSITIVE_INFINITY)) {
          distance.set(other, next);
          heap.push(next, other);
        }
      }
    }
  }

  const existing = new Set<string>();
  for (const edge of world.edges) {
    if (edge.mode !== "sea" || edge.isLane) continue;
    const key = pairKey(edge.areaA, edge.areaB);
    existing.add(key);
    edge.isActive = wanted.has(key);
  }
  const added = [...wanted.entries()].filter(([key]) => !existing.has(key)).sort(([x], [y]) => (x < y ? -1 : 1));
  for (const [, route] of added) addEdge(world, { a: route.a, b: route.b, mode: "sea", distance: route.distance });
  for (const edge of world.edges) if (edge.mode === "sea") updateEdge(world, edge);
}

/**
 * Links each airport to its airRoutesPerAirport nearest airports, and airports at the maximum level to each other as
 * hubs. Air routes no longer wanted are deactivated, never deleted, so edge ids stay stable; a dropped route that is
 * wanted again is reactivated. Ties in distance go to the lower area id, so the result is deterministic. Built
 * levels decide the routes; staffing only their capacity.
 */
export function rebuildAirRoutes(world: World): void {
  const t = world.config.transport;
  const airports = world.areas.filter((area) => area.airportLevel >= 1);
  const wanted = new Map<string, [AreaId, AreaId]>();
  const want = (a: AreaId, b: AreaId) => wanted.set(pairKey(a, b), a < b ? [a, b] : [b, a]);

  for (const airport of airports) {
    const nearest = airports
      .filter((other) => other !== airport)
      .map((other) => ({
        id: other.id,
        distance: chord(other.position, airport.position),
      }))
      .sort((x, y) => x.distance - y.distance || x.id - y.id)
      .slice(0, t.airRoutesPerAirport);
    for (const other of nearest) want(airport.id, other.id);
  }
  const hubs = airports.filter((area) => area.airportLevel >= world.config.infrastructure.maximumLevel);
  for (const [i, a] of hubs.entries()) for (const b of hubs.slice(i + 1)) want(a.id, b.id);

  const existing = new Set<string>();
  for (const edge of world.edges) {
    if (edge.mode !== "air") continue;
    const key = pairKey(edge.areaA, edge.areaB);
    existing.add(key);
    edge.isActive = wanted.has(key);
  }
  const added = [...wanted.entries()].filter(([key]) => !existing.has(key)).sort(([x], [y]) => (x < y ? -1 : 1));
  for (const [, [a, b]] of added) addEdge(world, { a, b, mode: "air" });

  for (const edge of world.edges) if (edge.mode === "air") updateEdge(world, edge);
}
