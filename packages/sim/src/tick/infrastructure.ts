// Port and airport levels, route capacities and the air route rebuild (specification §5, Sea and air routes).
import { edgeCapacityPerDay } from "../routes";
import type { Area, AreaId, Edge, World } from "../types";
import { addEdge } from "../world";

/** Phase 10: turns accumulated worker-days into port and airport levels and updates the routes they feed. */
export function advanceInfrastructure(world: World): void {
  const t = world.config.transport;
  let airportsChanged = false;
  for (const area of world.areas) {
    let changed = false;
    while (area.portLevel < t.maximumPortLevel && area.portProgress >= t.portWorkerDaysPerLevel) {
      area.portProgress -= t.portWorkerDaysPerLevel;
      area.portLevel += 1;
      changed = true;
    }
    while (area.airportLevel < t.maximumAirportLevel && area.airportProgress >= t.airportWorkerDaysPerLevel) {
      area.airportProgress -= t.airportWorkerDaysPerLevel;
      area.airportLevel += 1;
      changed = true;
      airportsChanged = true;
    }
    if (changed) updateRouteCapacities(world, area);
  }
  if (airportsChanged) rebuildAirRoutes(world);
}

/** Recomputes the capacity of every sea and air route touching an area, after its port or airport level changed. */
export function updateRouteCapacities(world: World, area: Area): void {
  for (const id of area.edges) {
    const edge = world.edges[id] as Edge;
    if (edge.mode === "land") continue;
    edge.capacityPerDay = edgeCapacityPerDay(
      world.config,
      edge,
      world.areas[edge.areaA] as Area,
      world.areas[edge.areaB] as Area,
    );
  }
}

const pairKey = (a: AreaId, b: AreaId) => (a < b ? `${a}-${b}` : `${b}-${a}`);

/**
 * Links each airport to its airRoutesPerAirport nearest airports, and airports at maximumAirportLevel to each other
 * as hubs. Air routes no longer wanted are deactivated, never deleted, so edge ids stay stable; a dropped route that
 * is wanted again is reactivated. Ties in distance go to the lower area id, so the result is deterministic.
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
        distance: Math.hypot(other.position.x - airport.position.x, other.position.y - airport.position.y),
      }))
      .sort((x, y) => x.distance - y.distance || x.id - y.id)
      .slice(0, t.airRoutesPerAirport);
    for (const other of nearest) want(airport.id, other.id);
  }
  const hubs = airports.filter((area) => area.airportLevel >= t.maximumAirportLevel);
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

  for (const edge of world.edges) {
    if (edge.mode !== "air") continue;
    edge.capacityPerDay = edgeCapacityPerDay(
      world.config,
      edge,
      world.areas[edge.areaA] as Area,
      world.areas[edge.areaB] as Area,
    );
  }
}
