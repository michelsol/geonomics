// Goods catalog loader (specification §5, Goods catalogs). Takes parsed JSON, so it works in the browser,
// the worker and Node alike.
import type { Abundance, DemandTier, Good, GoodId, Need, NeedSatisfaction, RecipeInput } from "./types";

export interface Catalog {
  name: string;
  description: string;
  needs: Need[];
  goods: Good[]; // sorted so that every input comes before its outputs
  military: { foodGood: GoodId; weaponsGood: GoodId };
}

export class CatalogError extends Error {
  override name = "CatalogError";
}

const TIERS: readonly DemandTier[] = ["necessity", "comfort", "luxury"];
const KINDS = ["primary", "crafted", "service"] as const;
const ABUNDANCES: readonly Abundance[] = ["common", "regional", "rare"];

type Json = Record<string, unknown>;

/** Parses, resolves and validates a catalog, then derives labor values and reference unit prices. */
export function loadCatalog(json: unknown): Catalog {
  const root = object(json, "catalog");
  const name = string(root, "name", "catalog");
  const description = string(root, "description", "catalog");
  const rawNeeds = array(root, "needs", "catalog");
  const rawGoods = array(root, "goods", "catalog");
  const rawMilitary = object(root.military, "catalog.military");

  const needIds = new Map<string, number>();
  const needs: Need[] = rawNeeds.map((raw, id) => {
    const where = `need #${id}`;
    const need = object(raw, where);
    const key = string(need, "key", where);
    if (needIds.has(key)) throw new CatalogError(`Duplicate need key "${key}"`);
    needIds.set(key, id);
    const at = `need "${key}"`;
    return {
      id,
      key,
      name: string(need, "name", at),
      unit: string(need, "unit", at),
      tier: oneOf(need, "tier", TIERS, at),
      demandPerPersonPerDay: number(need, "demandPerPersonPerDay", at, 0),
      priceElasticity: number(need, "priceElasticity", at, 0),
      wealthElasticity: number(need, "wealthElasticity", at, 0),
      substitutionElasticity: number(need, "substitutionElasticity", at, 0),
      referenceUnitPrice: 0,
    };
  });

  const goodIds = new Map<string, number>();
  const goods: Good[] = [];
  for (const [id, raw] of rawGoods.entries()) {
    const where = `good #${id}`;
    const good = object(raw, where);
    const key = string(good, "key", where);
    if (goodIds.has(key)) throw new CatalogError(`Duplicate good key "${key}"`);
    const at = `good "${key}"`;
    const kind = oneOf(good, "kind", KINDS, at);

    const inputs: RecipeInput[] = array(good, "inputs", at).map((rawInput, index) => {
      const input = object(rawInput, `${at} input #${index}`);
      const inputKey = string(input, "good", `${at} input #${index}`);
      const inputId = goodIds.get(inputKey);
      if (inputId === undefined) {
        const later = rawGoods.slice(id).some((other) => (other as Json | null)?.key === inputKey);
        throw new CatalogError(
          later
            ? `Good "${key}" uses input "${inputKey}", which is listed after it; inputs must come before their outputs`
            : `Good "${key}" uses unknown input "${inputKey}"`,
        );
      }
      if (goods[inputId]?.isService) throw new CatalogError(`Good "${key}" uses service "${inputKey}" as an input`);
      return { good: inputId, quantity: number(input, "quantity", `${at} input "${inputKey}"`, 0) };
    });

    const abundance = good.abundance === null ? null : oneOf(good, "abundance", ABUNDANCES, at);
    if (kind === "primary") {
      if (inputs.length > 0) throw new CatalogError(`Primary good "${key}" must not have inputs`);
      if (abundance === null) throw new CatalogError(`Primary good "${key}" must have an abundance`);
    }

    let satisfies: NeedSatisfaction | null = null;
    if (good.satisfies !== null) {
      const raw = object(good.satisfies, `${at}.satisfies`);
      const needKey = string(raw, "need", `${at}.satisfies`);
      const need = needIds.get(needKey);
      if (need === undefined) throw new CatalogError(`Good "${key}" satisfies unknown need "${needKey}"`);
      satisfies = {
        need,
        unitsPerGood: positive(raw, "unitsPerGood", `${at}.satisfies`),
        preference: positive(raw, "preference", `${at}.satisfies`),
      };
    }

    const laborHoursPerUnit = positive(good, "laborHoursPerUnit", at);
    const laborValue =
      laborHoursPerUnit +
      inputs.reduce((sum, input) => sum + input.quantity * (goods[input.good] as Good).laborValue, 0);
    goodIds.set(key, id);
    goods.push({
      id,
      key,
      name: string(good, "name", at),
      unit: string(good, "unit", at),
      laborHoursPerUnit,
      inputs,
      isPrimary: kind === "primary",
      isService: kind === "service",
      transportWeight: number(good, "transportWeight", at, 0),
      spoilageRatePerDay: number(good, "spoilageRatePerDay", at, 0),
      depletionPerUnitExtracted: number(good, "depletionPerUnitExtracted", at, 0),
      regenerationRatePerDay: number(good, "regenerationRatePerDay", at, 0),
      abundance,
      satisfies,
      laborValue,
    });
  }

  for (const need of needs) {
    need.referenceUnitPrice = referenceUnitPrice(need, goods);
    if (Number.isNaN(need.referenceUnitPrice)) throw new CatalogError(`No good satisfies need "${need.key}"`);
  }

  const militaryGood = (field: string): GoodId => {
    const key = string(rawMilitary, field, "catalog.military");
    const id = goodIds.get(key);
    if (id === undefined) throw new CatalogError(`Military ${field} "${key}" is not a good of the catalog`);
    return id;
  };

  return {
    name,
    description,
    needs,
    goods,
    military: { foodGood: militaryGood("foodGood"), weaponsGood: militaryGood("weaponsGood") },
  };
}

/** Price of one need unit when every consumer price equals labor value; NaN when no good satisfies the need. */
function referenceUnitPrice(need: Need, goods: Good[]): number {
  let weightSum = 0;
  let weightedPrice = 0;
  for (const good of goods) {
    if (good.satisfies?.need !== need.id) continue;
    const unitPrice = good.laborValue / good.satisfies.unitsPerGood;
    const weight = good.satisfies.preference * unitPrice ** -need.substitutionElasticity;
    weightSum += weight;
    weightedPrice += weight * unitPrice;
  }
  return weightSum > 0 ? weightedPrice / weightSum : Number.NaN;
}

// Shape checks with messages that name the offending field.

function object(value: unknown, where: string): Json {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new CatalogError(`${where} must be an object`);
  }
  return value as Json;
}

function array(parent: Json, field: string, where: string): unknown[] {
  const value = parent[field];
  if (!Array.isArray(value)) throw new CatalogError(`${where}: "${field}" must be an array`);
  return value;
}

function string(parent: Json, field: string, where: string): string {
  const value = parent[field];
  if (typeof value !== "string" || value === "")
    throw new CatalogError(`${where}: "${field}" must be a non-empty string`);
  return value;
}

function number(parent: Json, field: string, where: string, minimum: number): number {
  const value = parent[field];
  if (typeof value !== "number" || !Number.isFinite(value) || value < minimum) {
    throw new CatalogError(`${where}: "${field}" must be a finite number ≥ ${minimum}`);
  }
  return value;
}

function positive(parent: Json, field: string, where: string): number {
  const value = parent[field];
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new CatalogError(`${where}: "${field}" must be a finite number > 0`);
  }
  return value;
}

function oneOf<T extends string>(parent: Json, field: string, allowed: readonly T[], where: string): T {
  const value = parent[field];
  if (typeof value !== "string" || !allowed.includes(value as T)) {
    throw new CatalogError(`${where}: "${field}" must be one of ${allowed.join(", ")}`);
  }
  return value as T;
}
