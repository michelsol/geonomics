// Loads the shipped goods catalogs from data/goods.
import { readFileSync } from "node:fs";
import { type Catalog, loadCatalog } from "@geonomics/sim";

export const CATALOG_NAMES = ["small", "medium", "large"] as const;
export type CatalogName = (typeof CATALOG_NAMES)[number];

const cache = new Map<string, Catalog>();

export function readCatalog(name: CatalogName): Catalog {
  let catalog = cache.get(name);
  if (!catalog) {
    const url = new URL(`../../../data/goods/${name}.json`, import.meta.url);
    catalog = loadCatalog(JSON.parse(readFileSync(url, "utf8")));
    cache.set(name, catalog);
  }
  return catalog;
}
