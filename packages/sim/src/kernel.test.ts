import { describe, expect, it } from "vitest";
import medium from "../../../data/goods/medium.json";
import small from "../../../data/goods/small.json";
import { loadCatalog } from "./catalog";
import { createConfig } from "./config";
import { hashWorld } from "./hash";
import { fractionPerTick, rateFromHalfLife, reserveDaysOf } from "./math";
import { nextRandom } from "./random";
import { createArea, createEmptyWorld } from "./world";

const catalog = loadCatalog(small);

describe("fractionPerTick", () => {
  it("stays within [0, 1) whatever the tick length or responsiveness", () => {
    for (const rate of [0, 0.01, 0.35, 5, 1000]) {
      for (const responsiveness of [0.1, 1, 3, 100]) {
        for (const days of [0.1, 1, 30]) {
          const f = fractionPerTick(rate, responsiveness, days);
          expect(f).toBeGreaterThanOrEqual(0);
          expect(f).toBeLessThanOrEqual(1);
        }
      }
    }
  });

  it("halves a gap in one half-life", () => {
    expect(fractionPerTick(rateFromHalfLife(2), 1, 2)).toBeCloseTo(0.5, 12);
    // Two ticks of one day compose to the same result as one tick of two days.
    const f = fractionPerTick(0.35, 1, 1);
    expect(1 - (1 - f) ** 2).toBeCloseTo(fractionPerTick(0.35, 1, 2), 12);
  });
});

describe("reserveDaysOf", () => {
  const config = createConfig(catalog);
  const byKey = (key: string) => catalog.goods.find((g) => g.key === key) as (typeof catalog.goods)[number];

  it("keeps the full reserve for durable goods and a short one for perishables", () => {
    expect(reserveDaysOf(byKey("ore"), config)).toBe(5);
    expect(reserveDaysOf(byKey("bread"), config)).toBeCloseTo(1, 12);
    expect(reserveDaysOf(byKey("fish"), config)).toBeCloseTo(1.25, 12);
  });
});

describe("createConfig", () => {
  it("fills defaults, catalog military goods and overrides", () => {
    const config = createConfig(catalog, { economy: { reserveDays: 7 }, pace: { gameDaysPerTick: 0.5 } });
    expect(config.economy.reserveDays).toBe(7);
    expect(config.economy.workforceShare).toBe(0.5);
    expect(config.pace.gameDaysPerTick).toBe(0.5);
    expect(config.pace.maxTicksPerSecond).toBe(10);
    expect(catalog.goods[config.military.foodGood]?.key).toBe("bread");
    expect(catalog.goods[config.military.weaponsGood]?.key).toBe("tools");
    // One inhabitant's food need (1.5 units) in bread (1.3 units per kg).
    expect(config.military.foodPerSoldierPerDay).toBeCloseTo(1.5 / 1.3, 12);
  });

  it("never shares nested objects between configs", () => {
    const a = createConfig(catalog);
    a.economy.tierWeights.luxury = 99;
    expect(createConfig(catalog).economy.tierWeights.luxury).toBe(1);
  });
});

describe("nextRandom", () => {
  it("is reproducible from the seed and stored in the world", () => {
    const config = createConfig(catalog);
    const a = createEmptyWorld(catalog, config, 42);
    const b = createEmptyWorld(catalog, config, 42);
    const seqA = Array.from({ length: 100 }, () => nextRandom(a));
    const seqB = Array.from({ length: 100 }, () => nextRandom(b));
    expect(seqA).toEqual(seqB);
    expect(a.randomSeed).toBe(b.randomSeed);
    for (const value of seqA) {
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
    const c = createEmptyWorld(catalog, config, 43);
    expect(nextRandom(c)).not.toBe(seqA[0]);
  });
});

describe("hashWorld", () => {
  const build = () => {
    const world = createEmptyWorld(catalog, createConfig(catalog), 1);
    world.areas.push(createArea({ id: 0, name: "A", position: { x: 0, y: 0 }, population: 1000 }, 5, 2));
    return world;
  };

  it("is equal for equal worlds and changes with any value", () => {
    const a = build();
    const b = build();
    expect(hashWorld(a)).toBe(hashWorld(b));
    (b.areas[0] as (typeof b.areas)[number]).stock[3] = 1e-12;
    expect(hashWorld(a)).not.toBe(hashWorld(b));
  });

  it("hashes numbers bit for bit", () => {
    expect(hashWorld({ x: 0 })).not.toBe(hashWorld({ x: -0 }));
  });
});

describe("createArea", () => {
  it("sizes per-good arrays by goods and per-need arrays by needs", () => {
    const m = loadCatalog(medium);
    const area = createArea({ id: 3, name: "X", position: { x: 1, y: 2 } }, m.goods.length, m.needs.length);
    expect(area.stock).toHaveLength(14);
    expect(area.outputLimitedByInputs).toHaveLength(14);
    expect(area.needDemanded).toHaveLength(5);
    expect(area.productivity).toBe(1);
    expect(area.owner).toBeNull();
  });
});
