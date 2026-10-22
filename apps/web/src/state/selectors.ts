// Values derived from static data, snapshots and the price table.
import { type AreaDetail, decodePrice, type Snapshot, type StaticData } from "@geonomics/sim";

/** Price of a good in an area from the public price table. */
export function priceOf(data: StaticData, table: Uint16Array, area: number, good: number): number {
  const goods = data.goods.length;
  return decodePrice(
    table[area * goods + good] as number,
    (data.goods[good] as StaticData["goods"][number]).laborValue,
    data.config,
  );
}

export interface PricePoint {
  area: number;
  price: number;
}

export interface PriceExtremes {
  low: PricePoint;
  median: PricePoint;
  high: PricePoint;
}

/** Lowest, median and highest price of a good across all areas, with the areas where they occur. */
export function priceExtremes(data: StaticData, table: Uint16Array, good: number): PriceExtremes {
  const goods = data.goods.length;
  const areas = data.areas.length;
  const order = Array.from({ length: areas }, (_, i) => i);
  order.sort((a, b) => (table[a * goods + good] as number) - (table[b * goods + good] as number) || a - b);
  const point = (area: number): PricePoint => ({ area, price: priceOf(data, table, area, good) });
  return {
    low: point(order[0] as number),
    median: point(order[Math.floor((areas - 1) / 2)] as number),
    high: point(order[areas - 1] as number),
  };
}

/** Stocks and flows of an area, when the snapshot carries them (own areas and their neighbors). */
export function detailOf(snapshot: Snapshot | null, area: number): AreaDetail | undefined {
  return snapshot?.detail.find((detail) => detail.area === area);
}

/** Population of the player's realm. */
export function realmPopulation(snapshot: Snapshot): number {
  let population = 0;
  for (const area of snapshot.government?.ownedAreas ?? []) population += snapshot.areas.population[area] as number;
  return population;
}
