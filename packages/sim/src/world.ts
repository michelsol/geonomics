// Allocation of areas and worlds, sized by the catalog.
import type { Catalog } from "./catalog";
import type { WorldConfig } from "./config";
import { seedFrom } from "./random";
import type { Area, AreaId, World } from "./types";

export interface AreaInit {
  id: AreaId;
  name: string;
  position: { x: number; y: number };
  population?: number;
  productivity?: number;
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
  };
}
