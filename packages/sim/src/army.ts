// Armies: where they stand, the paths they march and returning soldiers to the population (specification §6).
import { type Path, shortestPath } from "./graph";
import { effectiveLevel } from "./infrastructure";
import type { Area, AreaId, Army, Edge, GovernmentId, World } from "./types";

/** The area an army stands in, or the area it left while marching along an edge. */
export function armyArea(army: Army): AreaId {
  return army.location.kind === "area" ? army.location.area : army.location.from;
}

/**
 * Whether an army of `owner` can set out along an edge from an area: never by air, and by sea only from a running
 * port (built and staffed) the army's own government holds.
 */
export function canMarch(world: World, owner: GovernmentId, edge: Edge, from: AreaId): boolean {
  if (!edge.isActive || edge.mode === "air") return false;
  if (edge.mode === "land") return true;
  const area = world.areas[from] as Area;
  return area.owner === owner && effectiveLevel(area, "port") > 0;
}

/** Fastest path by travel days for an army of `owner`, or null when the destination cannot be reached. */
export function armyPath(world: World, owner: GovernmentId, from: AreaId, to: AreaId): Path | null {
  return shortestPath(world, from, to, (edge, area) => (canMarch(world, owner, edge, area) ? edge.travelDays : null));
}

/** The area a marching army heads for next, or where it stands: the start of any new path. */
export function planningOrigin(world: World, army: Army): AreaId {
  if (army.location.kind === "area") return army.location.area;
  const edge = world.edges[army.location.edge] as Edge;
  return edge.areaA === army.location.from ? edge.areaB : edge.areaA;
}

/** An army of `owner` standing in `area` with no path left, which recruits and arriving armies join. */
export function idleArmyIn(world: World, owner: GovernmentId, area: AreaId): Army | undefined {
  for (const army of world.armies.values()) {
    if (army.owner === owner && army.path.length === 0 && army.location.kind === "area" && army.location.area === area)
      return army;
  }
  return undefined;
}

/** Splits `soldiers` off an army, with the same share of its weapons, as a new army in the same place. */
export function splitArmy(world: World, army: Army, soldiers: number): Army {
  const id = world.nextArmyId++;
  const part: Army = {
    id,
    owner: army.owner,
    location: { ...army.location },
    path: [...army.path],
    soldiers,
    weapons: (army.weapons * soldiers) / army.soldiers,
  };
  army.soldiers -= soldiers;
  army.weapons -= part.weapons;
  world.armies.set(id, part);
  return part;
}

/**
 * Armies of one government standing in the same area with no path left become one, the one with the lowest id,
 * carrying all their soldiers and weapons: an area holds one idle army per realm.
 */
export function mergeArmies(world: World): void {
  const idle = new Map<string, Army>();
  for (const army of [...world.armies.values()].sort((a, b) => a.id - b.id)) {
    if (army.location.kind !== "area" || army.path.length > 0) continue;
    const key = `${army.owner} ${army.location.area}`;
    const into = idle.get(key);
    if (!into) {
      idle.set(key, army);
      continue;
    }
    into.soldiers += army.soldiers;
    into.weapons += army.weapons;
    world.armies.delete(army.id);
  }
}

/** Soldiers leave the army and rejoin the population of the area where it is, as unemployed workers. */
export function returnSoldiers(world: World, army: Army, count: number): void {
  const soldiers = Math.min(count, army.soldiers);
  const area = world.areas[armyArea(army)] as Area;
  area.population += soldiers;
  area.unemployedWorkers += soldiers;
  army.soldiers -= soldiers;
}

/**
 * Disbands an army: its soldiers rejoin the population where it stands, and its weapons go to its government's depot
 * there, or to the area's stock if the government does not own the area.
 */
export function disbandArmy(world: World, army: Army): void {
  returnSoldiers(world, army, army.soldiers);
  const area = world.areas[armyArea(army)] as Area;
  const store = world.governments[army.owner]?.areaStates.get(area.id)?.depot ?? area.stock;
  const { weaponsGood } = world.config.military;
  store[weaponsGood] = (store[weaponsGood] as number) + army.weapons;
  world.armies.delete(army.id);
}
