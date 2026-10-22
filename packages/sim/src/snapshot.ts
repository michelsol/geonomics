// What the host sends to the interface (specification §9, Snapshots and Single player): static data once, then
// snapshots of the dynamic state as seen by one government. Typed arrays are Float32Array, and every value is
// structured-clone friendly, so snapshots cross a worker boundary as transferables or go through msgpack unchanged.
import type { WorldConfig } from "./config";
import type {
  AreaId,
  Army,
  DepotTransfer,
  EdgeMode,
  Good,
  GovernmentId,
  JobAssignment,
  MapLayout,
  MarketOrder,
  Need,
  PeaceProposal,
  PolicySetting,
  Relation,
  StandingOrder,
  Terrain,
  World,
} from "./types";

export interface StaticEdge {
  mode: EdgeMode;
  areaA: AreaId;
  areaB: AreaId;
  distance: number;
}

export interface StaticData {
  config: WorldConfig;
  needs: Need[];
  goods: Good[];
  areas: { name: string; x: number; y: number; terrain: Terrain; isCoastal: boolean }[];
  edges: StaticEdge[];
  map: MapLayout | null;
  naturalCapacityMaximum: Float32Array; // area-major: area × goodCount + good; 0 where a good cannot be extracted
}

/** Full state of one owned area, for its own government. */
export interface AreaStateView {
  area: AreaId;
  depot: Float32Array;
  jobs: JobAssignment[];
  wageOffer: number;
  policyOverrides: PolicySetting[];
  resolved: {
    productionTaxRate: Float32Array;
    consumptionTaxRate: Float32Array;
    importTariffRate: Float32Array;
    exportTariffRate: Float32Array;
    headTaxPerPersonPerDay: number;
    priceCeiling: Float32Array;
    priceFloor: Float32Array;
  };
}

/** Everything a government knows about itself. */
export interface GovernmentView {
  id: GovernmentId;
  treasury: number;
  capital: AreaId | null;
  isEliminated: boolean;
  ownedAreas: AreaId[];
  areaStates: AreaStateView[];
  realmPolicies: PolicySetting[];
  marketOrders: MarketOrder[];
  standingOrders: StandingOrder[];
  depotTransfers: DepotTransfer[];
  researchLevel: number;
  researchProgress: number;
  soldierWage: number;
}

/** What every player sees of every government. */
export interface GovernmentSummary {
  id: GovernmentId;
  name: string;
  color: string;
  capital: AreaId | null;
  areaCount: number;
  population: number;
  isEliminated: boolean;
}

/** Stocks and flows of one area, sent for the viewer's areas and their direct neighbors. */
export interface AreaDetail {
  area: AreaId;
  savings: number;
  unemployedWorkers: number;
  price: Float32Array;
  stock: Float32Array;
  produced: Float32Array;
  consumed: Float32Array;
  imported: Float32Array;
  exported: Float32Array;
  privateWorkers: Float32Array;
  naturalCapacity: Float32Array; // current extraction capacity per day, after depletion
}

export interface Snapshot {
  tick: number;
  gameDay: number;
  areas: {
    owner: Int16Array; // -1 for neutral
    population: Float32Array;
    wageLevel: Float32Array;
    satisfaction: Float32Array;
    necessitySatisfaction: Float32Array;
    portLevel: Uint8Array;
    airportLevel: Uint8Array;
    fortificationLevel: Uint8Array;
    siegeProgress: Float32Array;
    besieger: Int16Array; // -1 when not besieged
    militia: Float32Array; // militia defending a neutral area; 0 for owned areas
  };
  detail: AreaDetail[];
  edges: {
    transportCost: Float32Array;
    capacityPerDay: Float32Array;
    flags: Uint8Array; // bit 0: active, bit 1: blocked
  };
  newEdges: StaticEdge[]; // edges created since the receiver last knew, from index `knownEdges`
  armies: Army[];
  relations: Relation[][];
  peaceProposals: PeaceProposal[];
  government: GovernmentView | null; // the viewer's own government
  governments: GovernmentSummary[];
}

export const EDGE_ACTIVE = 1;
export const EDGE_BLOCKED = 2;

const staticEdge = (world: World, id: number): StaticEdge => {
  const edge = world.edges[id] as World["edges"][number];
  return { mode: edge.mode, areaA: edge.areaA, areaB: edge.areaB, distance: edge.distance };
};

/** The parts of the world that never change during a game (edges can only be added, see Snapshot.newEdges). */
export function buildStaticData(world: World): StaticData {
  return {
    config: world.config,
    needs: world.needs,
    goods: world.goods,
    areas: world.areas.map((area) => ({
      name: area.name,
      x: area.position.x,
      y: area.position.y,
      terrain: area.terrain,
      isCoastal: area.isCoastal,
    })),
    edges: world.edges.map((_, id) => staticEdge(world, id)),
    map: world.map,
    naturalCapacityMaximum: capacityTable(world),
  };
}

function capacityTable(world: World): Float32Array {
  const goodCount = world.goods.length;
  const table = new Float32Array(world.areas.length * goodCount);
  for (const area of world.areas) table.set(area.naturalCapacityMaximum, area.id * goodCount);
  return table;
}

/** The dynamic state as seen by `viewer` (null for a spectator), for a receiver that knows `knownEdges` edges. */
export function buildSnapshot(world: World, viewer: GovernmentId | null, knownEdges = world.edges.length): Snapshot {
  const n = world.areas.length;
  const areas: Snapshot["areas"] = {
    owner: new Int16Array(n),
    population: new Float32Array(n),
    wageLevel: new Float32Array(n),
    satisfaction: new Float32Array(n),
    necessitySatisfaction: new Float32Array(n),
    portLevel: new Uint8Array(n),
    airportLevel: new Uint8Array(n),
    fortificationLevel: new Uint8Array(n),
    siegeProgress: new Float32Array(n),
    besieger: new Int16Array(n),
    militia: new Float32Array(n),
  };
  for (const area of world.areas) {
    const i = area.id;
    areas.owner[i] = area.owner ?? -1;
    areas.population[i] = area.population;
    areas.wageLevel[i] = area.wageLevel;
    areas.satisfaction[i] = area.satisfaction;
    areas.necessitySatisfaction[i] = area.necessitySatisfaction;
    areas.portLevel[i] = area.portLevel;
    areas.airportLevel[i] = area.airportLevel;
    areas.fortificationLevel[i] = area.fortificationLevel;
    areas.siegeProgress[i] = area.siegeProgress;
    areas.besieger[i] = area.besiegingGovernment ?? -1;
    areas.militia[i] = area.owner === null ? area.militia : 0;
  }

  const m = world.edges.length;
  const edges: Snapshot["edges"] = {
    transportCost: new Float32Array(m),
    capacityPerDay: new Float32Array(m),
    flags: new Uint8Array(m),
  };
  for (const edge of world.edges) {
    edges.transportCost[edge.id] = edge.transportCost;
    edges.capacityPerDay[edge.id] = edge.capacityPerDay;
    edges.flags[edge.id] = (edge.isActive ? EDGE_ACTIVE : 0) | (edge.isBlocked ? EDGE_BLOCKED : 0);
  }
  const newEdges: StaticEdge[] = [];
  for (let id = knownEdges; id < m; id++) newEdges.push(staticEdge(world, id));

  const government = viewer === null ? undefined : world.governments[viewer];
  return {
    tick: world.tick,
    gameDay: world.gameDay,
    areas,
    detail: government ? detailFor(world, government.ownedAreas) : [],
    edges,
    newEdges,
    armies: [...world.armies.values()].map((army) => ({
      ...army,
      location: { ...army.location },
      path: [...army.path],
    })),
    relations: world.relations.map((row) => [...row]),
    peaceProposals: world.peaceProposals.map((p) => ({ ...p, areaTransfers: p.areaTransfers.map((t) => ({ ...t })) })),
    government: government ? governmentView(government) : null,
    governments: world.governments.map((g) => ({
      id: g.id,
      name: g.name,
      color: g.color,
      capital: g.capital,
      areaCount: g.ownedAreas.length,
      population: g.ownedAreas.reduce((sum, id) => sum + (world.areas[id]?.population ?? 0), 0),
      isEliminated: g.isEliminated,
    })),
  };
}

/** Owned areas and their direct neighbors over every active edge, in area order. */
function detailFor(world: World, owned: readonly AreaId[]): AreaDetail[] {
  const visible = new Set<AreaId>(owned);
  for (const id of owned) {
    for (const edgeId of world.areas[id]?.edges ?? []) {
      const edge = world.edges[edgeId] as World["edges"][number];
      if (edge.isActive) visible.add(edge.areaA === id ? edge.areaB : edge.areaA);
    }
  }
  return [...visible]
    .sort((a, b) => a - b)
    .map((id) => {
      const area = world.areas[id] as World["areas"][number];
      return {
        area: id,
        savings: area.savings,
        unemployedWorkers: area.unemployedWorkers,
        price: Float32Array.from(area.price),
        stock: Float32Array.from(area.stock),
        produced: Float32Array.from(area.produced),
        consumed: Float32Array.from(area.consumed),
        imported: Float32Array.from(area.imported),
        exported: Float32Array.from(area.exported),
        privateWorkers: Float32Array.from(area.privateWorkers),
        naturalCapacity: Float32Array.from(area.naturalCapacity),
      };
    });
}

function governmentView(government: World["governments"][number]): GovernmentView {
  return {
    id: government.id,
    treasury: government.treasury,
    capital: government.capital,
    isEliminated: government.isEliminated,
    ownedAreas: [...government.ownedAreas],
    areaStates: [...government.areaStates].map(([area, state]) => ({
      area,
      depot: Float32Array.from(state.depot),
      jobs: state.jobs.map((job) => ({ ...job, job: { ...job.job } })),
      wageOffer: state.wageOffer,
      policyOverrides: state.policyOverrides.map((s) => ({ ...s })),
      resolved: {
        productionTaxRate: Float32Array.from(state.resolvedPolicies.productionTaxRate),
        consumptionTaxRate: Float32Array.from(state.resolvedPolicies.consumptionTaxRate),
        importTariffRate: Float32Array.from(state.resolvedPolicies.importTariffRate),
        exportTariffRate: Float32Array.from(state.resolvedPolicies.exportTariffRate),
        headTaxPerPersonPerDay: state.resolvedPolicies.headTaxPerPersonPerDay,
        priceCeiling: Float32Array.from(state.resolvedPolicies.priceCeiling),
        priceFloor: Float32Array.from(state.resolvedPolicies.priceFloor),
      },
    })),
    realmPolicies: government.realmPolicies.map((s) => ({ ...s })),
    marketOrders: government.marketOrders.map((o) => ({ ...o })),
    standingOrders: government.standingOrders.map((o) => ({
      ...o,
      areas: o.areas === "all" ? "all" : [...o.areas],
      rule: { ...o.rule },
    })),
    depotTransfers: government.depotTransfers.map((t) => ({ ...t })),
    researchLevel: government.researchLevel,
    researchProgress: government.researchProgress,
    soldierWage: government.soldierWage,
  };
}

/** Every typed-array buffer in a snapshot, to transfer it to another thread without copying. */
export function snapshotTransferables(snapshot: Snapshot): ArrayBuffer[] {
  const buffers: ArrayBuffer[] = [];
  const add = (view: ArrayBufferView) => buffers.push(view.buffer as ArrayBuffer);
  for (const view of Object.values(snapshot.areas)) add(view);
  for (const view of Object.values(snapshot.edges)) add(view);
  for (const detail of snapshot.detail) {
    for (const view of [
      detail.price,
      detail.stock,
      detail.produced,
      detail.consumed,
      detail.imported,
      detail.exported,
      detail.privateWorkers,
      detail.naturalCapacity,
    ])
      add(view);
  }
  for (const state of snapshot.government?.areaStates ?? []) {
    add(state.depot);
    for (const value of Object.values(state.resolved)) if (ArrayBuffer.isView(value)) add(value);
  }
  return buffers;
}

// Price table (specification §9, Price table)

/**
 * Prices of every good in every area, quantized on a log scale between the floor and ceiling multiples of labor
 * value, area-major: index area × goodCount + good.
 */
export function encodePriceTable(world: World): Uint16Array {
  const goodCount = world.goods.length;
  const table = new Uint16Array(world.areas.length * goodCount);
  const { priceFloorMultiple, priceCeilingMultiple } = world.config.economy;
  const low = Math.log(priceFloorMultiple);
  const span = Math.log(priceCeilingMultiple) - low;
  for (const area of world.areas) {
    for (const good of world.goods) {
      const relative = Math.log((area.price[good.id] as number) / good.laborValue);
      const q = Math.round((65535 * (relative - low)) / span);
      table[area.id * goodCount + good.id] = Math.min(65535, Math.max(0, q));
    }
  }
  return table;
}

/** Inverse of the quantization: the price of a good from its table entry. */
export function decodePrice(q: number, laborValue: number, config: WorldConfig): number {
  const low = Math.log(config.economy.priceFloorMultiple);
  const span = Math.log(config.economy.priceCeilingMultiple) - low;
  return laborValue * Math.exp(low + (q / 65535) * span);
}
