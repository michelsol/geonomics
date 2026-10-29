// What the host sends to the interface (specification §8, Snapshots and Single player): static data once, then
// snapshots of the dynamic state as seen by one government. Typed arrays are Float32Array, and every value is
// structured-clone friendly, so snapshots cross a worker boundary as transferables or go through msgpack unchanged.
import { CONSUMER_GROUP_COUNT } from "./bands";
import type { WorldConfig } from "./config";
import { kindIndex } from "./infrastructure";
import { incomeOf } from "./tick/labor";
import { lastBirths, lastDeaths, lastMigration } from "./tick/population";
import { scratchOf } from "./tick/scratch";
import { lastTradeFlows, lastTradeTonnage } from "./tick/trade";
import type {
  AreaId,
  Army,
  EdgeMode,
  Good,
  GoodId,
  GovernmentId,
  InfrastructureKind,
  JobAssignment,
  MapLayout,
  MarketOrder,
  Need,
  PeaceProposal,
  Personality,
  PolicySetting,
  Relation,
  StandingOrder,
  Terrain,
  WaterId,
  World,
} from "./types";
import { extractionCapacity } from "./waters";

export interface StaticEdge {
  mode: EdgeMode;
  areaA: AreaId;
  areaB: AreaId;
  distance: number;
}

/** A water cell as the interface knows it: enough to draw it and to compute the ports' reach (waterReach). */
export interface StaticWater {
  x: number;
  y: number;
  z: number;
  depth: number; // hops over water from the nearest land
  neighbors: WaterId[];
  coasts: AreaId[];
}

export interface StaticData {
  config: WorldConfig;
  needs: Need[];
  goods: Good[];
  areas: { name: string; x: number; y: number; z: number; terrain: Terrain; isCoastal: boolean }[];
  waters: StaticWater[]; // empty for hand-built worlds
  edges: StaticEdge[];
  map: MapLayout | null;
  naturalCapacityMaximum: Float32Array; // area-major: area × goodCount + good, the land alone; 0 where none
  waterCapacityMaximum: Float32Array; // water-major: water × goodCount + good
}

/** Full state of one owned area, for its own government. */
export interface AreaStateView {
  area: AreaId;
  depot: Float32Array;
  jobs: JobAssignment[];
  wageOffer: number;
  targetLevel: number[]; // per InfrastructureKind: the level to build up to
  buildDays: number[]; // per InfrastructureKind: days of construction done toward the next level
  staff: number[]; // per InfrastructureKind: workers running the built levels
  policyOverrides: PolicySetting[]; // with the realm policies, enough to resolve the policies in force (resolveSettings)
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
  personality: Personality; // how the AI runs the realm whenever it controls it
  ai: boolean; // the AI controls the realm now
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
  naturalCapacity: Float32Array; // current extraction capacity per day, after depletion: land plus staffed waters
  needDemanded: Float32Array; // per need: need units the population wanted in the last tick
  needConsumed: Float32Array; // per need: need units it consumed, substitutes included
  wage: Float32Array; // per good: value added per private worker-day before income tax, in man-hours
}

export interface Snapshot {
  tick: number;
  gameDay: number;
  areas: {
    owner: Int16Array; // -1 for neutral
    population: Float32Array;
    births: Float32Array; // people born per day
    deaths: Float32Array; // people who died per day
    averageWage: Float32Array;
    // per member of the workforce and day, the unemployed included, in man-hours; NaN when empty (section 9, Income)
    grossIncome: Float32Array;
    netIncome: Float32Array;
    employmentRate: Float32Array; // share of the workforce with a private or government job; NaN when empty
    satisfaction: Float32Array;
    necessitySatisfaction: Float32Array;
    // per area and consumer group (the wage bands, then the unemployed), as of the last consumption phase
    groupShare: Float32Array; // share of the population: the group's workers and their dependents
    groupNecessityMet: Float32Array; // share of the group's necessities met
    portLevel: Uint8Array;
    airportLevel: Uint8Array;
    roadLevel: Uint8Array;
    fortificationLevel: Uint8Array;
    staffing: Float32Array; // area-major: area × 4 + kind (INFRASTRUCTURE_KINDS), the staffed share of each kind
    siegeProgress: Float32Array;
    besieger: Int16Array; // -1 when not besieged
    militia: Float32Array; // militia defending each area
  };
  visibleAreas: AreaId[]; // the viewer's owned areas and their neighbors, whose detail it may receive
  detail: AreaDetail[]; // detail of all visible areas, or of some of them when the options ask (see SnapshotOptions)
  edges: {
    transportCost: Float32Array;
    capacityPerDay: Float32Array;
    flags: Uint8Array; // bit 0: active, bit 1: blocked
    tonnage: Float32Array; // per edge and direction (2 × edge for A→B, + 1 for B→A): tonnes carried per day
    migration: Float32Array; // per edge: migrants per day, positive from A to B
    goodFlow: Float32Array | null; // like tonnage, in units per day of the watched good; null when none is watched
  };
  newEdges: StaticEdge[]; // edges created since the receiver last knew, from index `knownEdges`
  armies: Army[];
  relations: Relation[][];
  peaceProposals: PeaceProposal[];
  government: GovernmentView | null; // the viewer's own government
  governments: GovernmentSummary[];
}

/** Built level of a kind in an area, from a snapshot. */
export function snapshotLevel(areas: Snapshot["areas"], area: AreaId, kind: InfrastructureKind): number {
  switch (kind) {
    case "port":
      return areas.portLevel[area] as number;
    case "airport":
      return areas.airportLevel[area] as number;
    case "roads":
      return areas.roadLevel[area] as number;
    case "fort":
      return areas.fortificationLevel[area] as number;
  }
}

/** What a kind delivers in an area, from a snapshot: its built level times its staffed share. */
export function runningLevel(areas: Snapshot["areas"], area: AreaId, kind: InfrastructureKind): number {
  return snapshotLevel(areas, area, kind) * (areas.staffing[4 * area + kindIndex(kind)] as number);
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
      z: area.position.z,
      terrain: area.terrain,
      isCoastal: area.isCoastal,
    })),
    waters: world.waters.map((water) => ({
      x: water.position.x,
      y: water.position.y,
      z: water.position.z,
      depth: water.depth,
      neighbors: [...water.neighbors],
      coasts: [...water.coasts],
    })),
    edges: world.edges.map((_, id) => staticEdge(world, id)),
    map: world.map ? { radius: world.map.radius } : null,
    naturalCapacityMaximum: capacityTable(world.areas, world.goods.length),
    waterCapacityMaximum: capacityTable(world.waters, world.goods.length),
  };
}

function capacityTable(cells: readonly { naturalCapacityMaximum: Float64Array }[], goodCount: number): Float32Array {
  const table = new Float32Array(cells.length * goodCount);
  for (const [i, cell] of cells.entries()) table.set(cell.naturalCapacityMaximum, i * goodCount);
  return table;
}

export interface SnapshotOptions {
  flowGood?: GoodId | null; // the good whose trade flows the receiver watches on the map
  // which visible areas get their detail this time (default: all); remote players get them in turns
  detailAreas?: (visible: readonly AreaId[]) => readonly AreaId[];
}

/**
 * The dynamic state as seen by `viewer` (null for a spectator), for a receiver that knows `knownEdges` edges. Trade
 * and migration flows are public, like prices.
 */
export function buildSnapshot(
  world: World,
  viewer: GovernmentId | null,
  knownEdges = world.edges.length,
  options: SnapshotOptions = {},
): Snapshot {
  const n = world.areas.length;
  const areas: Snapshot["areas"] = {
    owner: new Int16Array(n),
    population: new Float32Array(n),
    births: new Float32Array(n),
    deaths: new Float32Array(n),
    averageWage: new Float32Array(n),
    grossIncome: new Float32Array(n),
    netIncome: new Float32Array(n),
    employmentRate: new Float32Array(n),
    satisfaction: new Float32Array(n),
    necessitySatisfaction: new Float32Array(n),
    groupShare: new Float32Array(n * CONSUMER_GROUP_COUNT),
    groupNecessityMet: new Float32Array(n * CONSUMER_GROUP_COUNT),
    portLevel: new Uint8Array(n),
    airportLevel: new Uint8Array(n),
    roadLevel: new Uint8Array(n),
    fortificationLevel: new Uint8Array(n),
    staffing: new Float32Array(4 * n),
    siegeProgress: new Float32Array(n),
    besieger: new Int16Array(n),
    militia: new Float32Array(n),
  };
  const births = lastBirths(world);
  const deaths = lastDeaths(world);
  const days = world.config.pace.gameDaysPerTick;
  const { workforceShare } = world.config.economy;
  const scratch = scratchOf(world);
  const wages = new Float64Array(world.goods.length);
  for (const area of world.areas) {
    const i = area.id;
    areas.owner[i] = area.owner ?? -1;
    areas.population[i] = area.population;
    areas.births[i] = (births[i] ?? 0) / days;
    areas.deaths[i] = (deaths[i] ?? 0) / days;
    areas.averageWage[i] = area.averageWage;
    const income = incomeOf(world, area, scratch, wages);
    areas.grossIncome[i] = income.gross;
    areas.netIncome[i] = income.net;
    const workforce = area.population * workforceShare;
    areas.employmentRate[i] =
      workforce > 0 ? Math.min(1, Math.max(0, 1 - area.unemployedWorkers / workforce)) : Number.NaN;
    areas.satisfaction[i] = area.satisfaction;
    areas.necessitySatisfaction[i] = area.necessitySatisfaction;
    for (let g = i * CONSUMER_GROUP_COUNT; g < (i + 1) * CONSUMER_GROUP_COUNT; g++) {
      areas.groupShare[g] = scratch.groupShare[g] as number;
      areas.groupNecessityMet[g] = scratch.groupNecessityMet[g] as number;
    }
    areas.portLevel[i] = area.portLevel;
    areas.airportLevel[i] = area.airportLevel;
    areas.roadLevel[i] = area.roadLevel;
    areas.fortificationLevel[i] = area.fortificationLevel;
    areas.staffing.set(area.staffing, 4 * i);
    areas.siegeProgress[i] = area.siegeProgress;
    areas.besieger[i] = area.besiegingGovernment ?? -1;
    areas.militia[i] = area.militia;
  }

  const m = world.edges.length;
  const tonnage = lastTradeTonnage(world);
  const migration = lastMigration(world);
  const flowGood = options.flowGood ?? null;
  const edges: Snapshot["edges"] = {
    transportCost: new Float32Array(m),
    capacityPerDay: new Float32Array(m),
    flags: new Uint8Array(m),
    tonnage: new Float32Array(2 * m),
    migration: new Float32Array(m),
    goodFlow: flowGood !== null && flowGood >= 0 && flowGood < world.goods.length ? new Float32Array(2 * m) : null,
  };
  for (const edge of world.edges) {
    const e = edge.id;
    edges.transportCost[e] = edge.transportCost;
    edges.capacityPerDay[e] = edge.capacityPerDay;
    edges.flags[e] = (edge.isActive ? EDGE_ACTIVE : 0) | (edge.isBlocked ? EDGE_BLOCKED : 0);
    edges.tonnage[2 * e] = (tonnage[2 * e] ?? 0) / days;
    edges.tonnage[2 * e + 1] = (tonnage[2 * e + 1] ?? 0) / days;
    edges.migration[e] = (migration[e] ?? 0) / days;
  }
  if (edges.goodFlow) {
    for (const flow of lastTradeFlows(world)) {
      if (flow.good !== flowGood) continue;
      const slot = 2 * flow.edge + (world.edges[flow.edge]?.areaA === flow.seller ? 0 : 1);
      edges.goodFlow[slot] = (edges.goodFlow[slot] as number) + flow.quantity / days;
    }
  }
  const newEdges: StaticEdge[] = [];
  for (let id = knownEdges; id < m; id++) newEdges.push(staticEdge(world, id));

  const government = viewer === null ? undefined : world.governments[viewer];
  const visible = government ? visibleAreas(world, government.ownedAreas) : [];
  return {
    tick: world.tick,
    gameDay: world.gameDay,
    areas,
    visibleAreas: visible,
    detail: (options.detailAreas ? options.detailAreas(visible) : visible).map((id) => detailOf(world, id)),
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
      personality: g.personality,
      ai: g.controller.kind === "ai",
    })),
  };
}

/** Owned areas and their direct neighbors over every active edge, in area order: the areas a government sees. */
function visibleAreas(world: World, owned: readonly AreaId[]): AreaId[] {
  const visible = new Set<AreaId>(owned);
  for (const id of owned) {
    for (const edgeId of world.areas[id]?.edges ?? []) {
      const edge = world.edges[edgeId] as World["edges"][number];
      if (edge.isActive) visible.add(edge.areaA === id ? edge.areaB : edge.areaA);
    }
  }
  return [...visible].sort((a, b) => a - b);
}

function detailOf(world: World, id: AreaId): AreaDetail {
  const area = world.areas[id] as World["areas"][number];
  const wages = new Float64Array(world.goods.length);
  incomeOf(world, area, scratchOf(world), wages);
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
    naturalCapacity: Float32Array.from(world.goods, (good) =>
      good.isPrimary ? extractionCapacity(world, area, good.id) : 0,
    ),
    needDemanded: Float32Array.from(area.needDemanded),
    needConsumed: Float32Array.from(area.needConsumed),
    wage: Float32Array.from(wages),
  };
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
      targetLevel: Array.from(state.targetLevel),
      buildDays: Array.from(state.buildDays),
      staff: Array.from(state.staff),
      policyOverrides: state.policyOverrides.map((s) => ({ ...s })),
    })),
    realmPolicies: government.realmPolicies.map((s) => ({ ...s })),
    marketOrders: government.marketOrders.map((o) => ({ ...o })),
    standingOrders: government.standingOrders.map((o) => ({
      ...o,
      areas: o.areas === "all" ? "all" : [...o.areas],
      rule: { ...o.rule },
    })),
    soldierWage: government.soldierWage,
  };
}

/** Every typed-array buffer in a snapshot, to transfer it to another thread without copying. */
export function snapshotTransferables(snapshot: Snapshot): ArrayBuffer[] {
  const buffers: ArrayBuffer[] = [];
  const add = (view: ArrayBufferView) => buffers.push(view.buffer as ArrayBuffer);
  for (const view of Object.values(snapshot.areas)) add(view);
  for (const view of Object.values(snapshot.edges)) if (view) add(view);
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
      detail.needDemanded,
      detail.needConsumed,
      detail.wage,
    ])
      add(view);
  }
  for (const state of snapshot.government?.areaStates ?? []) add(state.depot);
  return buffers;
}

// Price table (specification §8, Price table)

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
