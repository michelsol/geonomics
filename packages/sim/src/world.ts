// Allocation of areas and worlds, sized by the catalog.
import type { Catalog } from "./catalog";
import type { WorldConfig } from "./config";
import { seedFrom } from "./random";
import { edgeBaseTransportCost, edgeCapacityPerDay, edgeTravelDays } from "./routes";
import type { Area, AreaId, Edge, EdgeMode, Terrain, World } from "./types";

export interface AreaInit {
  id: AreaId;
  name: string;
  position: { x: number; y: number };
  population?: number;
  productivity?: number;
  terrain?: Terrain;
  isCoastal?: boolean;
  portLevel?: number;
  airportLevel?: number;
}

/** Creates an area with every per-good array sized by the number of goods and per-need array by needs. */
export function createArea(init: AreaInit, goodCount: number, needCount: number): Area {
  const perGood = () => new Float64Array(goodCount);
  return {
    id: init.id,
    name: init.name,
    position: { ...init.position },
    owner: null,
    edges: [],
    population: init.population ?? 0,
    savings: 0,
    productivity: init.productivity ?? 1,
    unemployedWorkers: 0,
    fortificationLevel: 0,
    terrain: init.terrain ?? "plains",
    isCoastal: init.isCoastal ?? false,
    portLevel: init.portLevel ?? 0,
    portProgress: 0,
    airportLevel: init.airportLevel ?? 0,
    airportProgress: 0,
    siegeProgress: 0,
    besiegingGovernment: null,
    stock: perGood(),
    price: perGood(),
    smoothedPrice: perGood(),
    privateWorkers: perGood(),
    naturalCapacity: perGood(),
    naturalCapacityMaximum: perGood(),
    produced: perGood(),
    demanded: perGood(),
    inputDemanded: perGood(),
    consumed: perGood(),
    imported: perGood(),
    exported: perGood(),
    outputLimitedByInputs: new Uint8Array(goodCount),
    needDemanded: new Float64Array(needCount),
    needConsumed: new Float64Array(needCount),
    satisfaction: 1,
    necessitySatisfaction: 1,
    wageLevel: 1,
  };
}

/** Creates a world with the catalog and config but no areas, edges or governments. */
export function createEmptyWorld(catalog: Catalog, config: WorldConfig, seed: number): World {
  return {
    tick: 0,
    gameDay: 0,
    config,
    needs: catalog.needs,
    goods: catalog.goods,
    areas: [],
    edges: [],
    governments: [],
    armies: new Map(),
    relations: [],
    peaceProposals: [],
    nextArmyId: 0,
    nextOrderId: 0,
    randomSeed: seedFrom(seed),
    map: null,
  };
}

export interface AreaSpec extends Omit<AreaInit, "id"> {
  naturalCapacity?: Record<string, number>; // primary good key -> maximum extraction per day
}

export interface EdgeSpec {
  a: AreaId;
  b: AreaId;
  mode: EdgeMode;
  distance?: number; // defaults to the straight-line distance between the two positions
  terrainFactor?: number; // land only: multiplies landCostPerDistance (default 1)
  baseTransportCost?: number; // overrides the cost derived from mode and distance
  travelDays?: number; // overrides the default derived from mode and distance
}

export interface WorldSpec {
  areas: AreaSpec[];
  edges: EdgeSpec[];
  seed: number;
}

/** Builds a world from hand-written areas and edges. Call initializeWorld afterwards to reach Rule 6's start. */
export function createWorld(catalog: Catalog, config: WorldConfig, spec: WorldSpec): World {
  const world = createEmptyWorld(catalog, config, spec.seed);
  const goodIds = new Map(catalog.goods.map((good) => [good.key, good.id]));
  for (const [id, areaSpec] of spec.areas.entries()) {
    const area = createArea({ ...areaSpec, id }, catalog.goods.length, catalog.needs.length);
    for (const [key, capacity] of Object.entries(areaSpec.naturalCapacity ?? {})) {
      const good = goodIds.get(key);
      if (good === undefined || !catalog.goods[good]?.isPrimary) {
        throw new Error(`Area "${area.name}": natural capacity for "${key}", which is not a primary good`);
      }
      area.naturalCapacity[good] = capacity;
      area.naturalCapacityMaximum[good] = capacity;
    }
    world.areas.push(area);
  }
  for (const edgeSpec of spec.edges) addEdge(world, edgeSpec);
  return world;
}

/** Appends an edge and registers it on both areas. Edge ids are positions and are never reused. */
export function addEdge(world: World, spec: EdgeSpec): Edge {
  const a = world.areas[spec.a];
  const b = world.areas[spec.b];
  if (!a || !b || a === b) throw new Error(`Invalid edge between areas ${spec.a} and ${spec.b}`);
  const distance = spec.distance ?? Math.hypot(a.position.x - b.position.x, a.position.y - b.position.y);
  const baseTransportCost =
    spec.baseTransportCost ?? edgeBaseTransportCost(world.config, spec.mode, distance, spec.terrainFactor ?? 1);
  const edge: Edge = {
    id: world.edges.length,
    mode: spec.mode,
    areaA: a.id,
    areaB: b.id,
    distance,
    baseTransportCost,
    transportCost: baseTransportCost,
    infrastructureProgress: 0,
    capacityPerDay: 0,
    travelDays: spec.travelDays ?? edgeTravelDays(world.config, spec.mode, distance),
    isActive: true,
    isBlocked: false,
    tradeFlowPerDay: new Float64Array(2 * world.goods.length),
  };
  edge.capacityPerDay = edgeCapacityPerDay(world.config, edge, a, b);
  world.edges.push(edge);
  a.edges.push(edge.id);
  b.edges.push(edge.id);
  return edge;
}
