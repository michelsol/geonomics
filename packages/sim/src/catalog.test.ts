import { describe, expect, it } from "vitest";
import large from "../../../data/goods/large.json";
import medium from "../../../data/goods/medium.json";
import small from "../../../data/goods/small.json";
import { type Catalog, CatalogError, loadCatalog } from "./catalog";

const shipped = { small, medium, large };

// Labor values computed by hand from laborValue(g) = laborHoursPerUnit(g) + Σ quantity × laborValue(input).
const referenceLaborValues: Record<keyof typeof shipped, Record<string, number>> = {
  small: { grain: 1.5, fish: 3.6, ore: 1, bread: 0.8195, tools: 7.1 },
  medium: {
    grain: 0.8,
    electricity: 0.09,
    lumber: 4.42,
    steel: 3.02,
    bread: 0.415,
    clothing: 1.578,
    furniture: 8.372,
    healthcare: 1.06,
    weapons: 8.16,
  },
  large: {
    electricity: 0.08,
    fuel: 2.45,
    steel: 2.64,
    aluminium: 10.7,
    machinery: 16.091,
    bread: 0.212,
    processed_food: 2.469,
    cars: 343.053,
    car_travel: 0.093,
    weapons: 6.28,
  },
};

// Specification §4, calibration rule: the basket at labor-value prices and necessities' share of it.
const referenceNecessityShare = { small: 0.32, medium: 0.29, large: 0.35 };

function laborValue(catalog: Catalog, key: string): number {
  const good = catalog.goods.find((g) => g.key === key);
  if (!good) throw new Error(`missing ${key}`);
  return good.laborValue;
}

describe("shipped catalogs", () => {
  for (const [name, json] of Object.entries(shipped) as [keyof typeof shipped, unknown][]) {
    describe(name, () => {
      const catalog = loadCatalog(json);

      it("loads with ids matching positions and inputs before outputs", () => {
        catalog.goods.forEach((good, id) => {
          expect(good.id).toBe(id);
          for (const input of good.inputs) expect(input.good).toBeLessThan(id);
        });
        for (const [id, need] of catalog.needs.entries()) expect(need.id).toBe(id);
      });

      it("matches the reference labor values", () => {
        for (const [key, value] of Object.entries(referenceLaborValues[name])) {
          expect(laborValue(catalog, key)).toBeCloseTo(value, 3);
        }
      });

      it("derives isPrimary and isService from kind", () => {
        const raw = (json as { goods: { key: string; kind: string }[] }).goods;
        for (const [i, good] of catalog.goods.entries()) {
          expect(good.isPrimary).toBe(raw[i]?.kind === "primary");
          expect(good.isService).toBe(raw[i]?.kind === "service");
        }
      });

      it("follows the calibration rule", () => {
        let basket = 0;
        let necessities = 0;
        for (const need of catalog.needs) {
          const cost = need.demandPerPersonPerDay * need.referenceUnitPrice;
          basket += cost;
          if (need.tier === "necessity") necessities += cost;
        }
        const laborPerPerson = 8 * 0.5;
        expect(basket / laborPerPerson).toBeGreaterThan(0.7);
        expect(basket / laborPerPerson).toBeLessThan(0.85);
        expect(necessities / basket).toBeCloseTo(referenceNecessityShare[name], 2);
      });

      it("resolves the military goods", () => {
        const raw = (json as { military: { weaponsGood: string } }).military;
        expect(catalog.goods[catalog.military.weaponsGood]?.key).toBe(raw.weaponsGood);
      });
    });
  }

  it("prices a need unit at the preference-weighted mix of its goods' unit prices", () => {
    const catalog = loadCatalog(small);
    const food = catalog.needs.find((n) => n.key === "food");
    // fish: 3.6 / 6 = 0.6, bread: 0.8195 / 1.3 ≈ 0.6304; σ = 2; preferences 0.35 for fish, 1 for bread.
    const fish = 0.6;
    const bread = 0.8195 / 1.3;
    const wFish = 0.35 * fish ** -2;
    const wBread = bread ** -2;
    expect(food?.referenceUnitPrice).toBeCloseTo((wFish * fish + wBread * bread) / (wFish + wBread), 10);
  });
});

describe("broken catalogs", () => {
  type Mutable = { needs: Record<string, unknown>[]; goods: Record<string, unknown>[]; [key: string]: unknown };
  const broken = (mutate: (catalog: Mutable) => void): unknown => {
    const copy = JSON.parse(JSON.stringify(small)) as Mutable;
    mutate(copy);
    return copy;
  };
  const good = (c: Mutable, key: string) => c.goods.find((g) => g.key === key) as Record<string, unknown>;

  const cases: [string, unknown, RegExp][] = [
    ["not an object", 42, /catalog must be an object/],
    ["missing goods", broken((c) => delete (c as Partial<Mutable>).goods), /"goods" must be an array/],
    ["duplicate good key", broken((c) => (good(c, "ore").key = "grain")), /Duplicate good key "grain"/],
    [
      "duplicate need key",
      broken((c) => ((c.needs[1] as Record<string, unknown>).key = "food")),
      /Duplicate need key "food"/,
    ],
    [
      "unknown input",
      broken((c) => (good(c, "bread").inputs = [{ good: "flour", quantity: 1 }])),
      /Good "bread" uses unknown input "flour"/,
    ],
    [
      "input listed after its user",
      broken((c) => c.goods.push(c.goods.splice(2, 1)[0] as Record<string, unknown>)),
      /Good "tools" uses input "ore", which is listed after it/,
    ],
    [
      "service used as input",
      broken((c) => {
        good(c, "bread").kind = "service";
        good(c, "tools").inputs = [{ good: "bread", quantity: 1 }];
      }),
      /Good "tools" uses service "bread" as an input/,
    ],
    [
      "primary with inputs",
      broken((c) => (good(c, "fish").inputs = [{ good: "grain", quantity: 1 }])),
      /Primary good "fish" must not have inputs/,
    ],
    [
      "primary without abundance",
      broken((c) => (good(c, "ore").abundance = null)),
      /Primary good "ore" must have an abundance/,
    ],
    [
      "need without goods",
      broken((c) => c.needs.push({ ...(c.needs[1] as object), key: "leisure" })),
      /No good satisfies need "leisure"/,
    ],
    [
      "unknown need",
      broken((c) => ((good(c, "tools").satisfies as Record<string, unknown>).need = "fun")),
      /Good "tools" satisfies unknown need "fun"/,
    ],
    [
      "unknown military good",
      broken((c) => ((c.military as Record<string, unknown>).weaponsGood = "swords")),
      /Military weaponsGood "swords" is not a good/,
    ],
    [
      "unknown terrain",
      broken((c) => (good(c, "ore").terrains = ["hills", "swamp"])),
      /good "ore": unknown terrain "swamp"/,
    ],
    ["bad kind", broken((c) => (good(c, "ore").kind = "mined")), /good "ore": "kind" must be one of/],
    [
      "non-finite number",
      broken((c) => (good(c, "ore").laborHoursPerUnit = Number.NaN)),
      /good "ore": "laborHoursPerUnit" must be a finite number > 0/,
    ],
  ];

  for (const [label, json, message] of cases) {
    it(`rejects ${label}`, () => {
      expect(() => loadCatalog(json)).toThrow(CatalogError);
      expect(() => loadCatalog(json)).toThrow(message);
    });
  }
});
