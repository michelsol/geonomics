// What an AI sees (specification §10, Perception): the snapshot and price table a player of the realm would get, and
// the static data every player has. Decisions read this view only, never the world.
import {
  type AreaDetail,
  buildSnapshot,
  buildStaticData,
  decodePrice,
  EDGE_ACTIVE,
  encodePriceTable,
  type Snapshot,
  type StaticData,
} from "../snapshot";
import type { AreaId, GovernmentId, World } from "../types";

export interface AiView {
  me: GovernmentId;
  data: StaticData;
  neighbors: readonly (readonly AreaId[])[]; // per area: areas one active land or sea edge away
  landNeighbors: readonly (readonly AreaId[])[]; // per area: areas one land edge away, where armies can always march
  snapshot: Snapshot;
  detail: ReadonlyMap<AreaId, AreaDetail>; // the visible areas' detail
  prices: Float32Array; // every good in every area, area-major, as decoded from the price table
}

interface StaticCache {
  edgeCount: number;
  data: StaticData;
}

const statics = new WeakMap<World, StaticCache>();
const priceTables = new WeakMap<World, { tick: number; prices: Float32Array }>();

/** Static data, rebuilt only when edges were added (air routes rebuilt). */
function staticData(world: World): StaticData {
  const cached = statics.get(world);
  if (cached && cached.edgeCount === world.edges.length) return cached.data;
  const data = buildStaticData(world);
  statics.set(world, { edgeCount: world.edges.length, data });
  return data;
}

/** The price table as every player receives it, decoded once per tick for all AI realms. */
function priceTable(world: World): Float32Array {
  const cached = priceTables.get(world);
  if (cached && cached.tick === world.tick) return cached.prices;
  const table = encodePriceTable(world);
  const goodCount = world.goods.length;
  const prices = new Float32Array(table.length);
  for (let i = 0; i < table.length; i++)
    prices[i] = decodePrice(table[i] as number, world.goods[i % goodCount]?.laborValue ?? 1, world.config);
  priceTables.set(world, { tick: world.tick, prices });
  return prices;
}

export function perceive(world: World, me: GovernmentId): AiView {
  const data = staticData(world);
  const snapshot = buildSnapshot(world, me);
  const neighbors: AreaId[][] = data.areas.map(() => []);
  const landNeighbors: AreaId[][] = data.areas.map(() => []);
  data.edges.forEach((edge, id) => {
    if (edge.mode === "air" || !((snapshot.edges.flags[id] as number) & EDGE_ACTIVE)) return;
    for (const list of edge.mode === "land" ? [neighbors, landNeighbors] : [neighbors]) {
      list[edge.areaA]?.push(edge.areaB);
      list[edge.areaB]?.push(edge.areaA);
    }
  });
  return {
    me,
    data,
    neighbors,
    landNeighbors,
    snapshot,
    detail: new Map(snapshot.detail.map((detail) => [detail.area, detail])),
    prices: priceTable(world),
  };
}
