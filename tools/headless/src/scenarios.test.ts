// Roadmap stage 2: every scenario builds with every catalog, starts from Rule 6 and reports diagnostics.
import { reserveDaysOf, runTick } from "@geonomics/sim";
import { describe, expect, it } from "vitest";
import { CATALOG_NAMES, readCatalog } from "./catalogs";
import { Recorder } from "./diagnostics";
import { SCENARIO_NAMES, scenarios } from "./scenarios";

describe.each(SCENARIO_NAMES)("%s", (scenario) => {
  it.each(CATALOG_NAMES)("starts near equilibrium and reports diagnostics with the %s catalog", (catalog) => {
    const world = scenarios[scenario].build({ catalog: readCatalog(catalog) });
    const { workforceShare } = world.config.economy;
    for (const area of world.areas) {
      let employed = 0;
      for (const good of world.goods) {
        expect(area.price[good.id]).toBe(good.laborValue);
        expect(area.smoothedPrice[good.id]).toBe(good.laborValue);
        const used = (area.demanded[good.id] as number) + (area.inputDemanded[good.id] as number);
        expect(area.stock[good.id]).toBeCloseTo(good.isService ? 0 : reserveDaysOf(good, world.config) * used, 6);
        employed += area.privateWorkers[good.id] as number;
      }
      // Infrastructure staff of a realm's starting ports and airports are part of the workforce too.
      const state = area.owner === null ? undefined : world.governments[area.owner]?.areaStates.get(area.id);
      for (const staff of state?.staff ?? []) employed += staff;
      expect(employed + area.unemployedWorkers).toBeCloseTo(area.population * workforceShare, 6);
      expect(area.savings).toBeGreaterThan(0);
    }

    const recorder = new Recorder(world);
    for (let i = 0; i < 10; i++) {
      runTick(world);
      recorder.sample();
    }
    const report = recorder.report();
    expect(report.day).toBe(10);
    for (const value of [report.unmetNecessities, report.laborChurn, report.worstVolatility, report.meanWageLevel]) {
      expect(Number.isFinite(value)).toBe(true);
    }
    expect(report.goods).toHaveLength(world.goods.length);
  });
});

it("builds a different grid for a different seed", () => {
  const catalog = readCatalog("small");
  const a = scenarios.grid100.build({ catalog, seed: 1 });
  const b = scenarios.grid100.build({ catalog, seed: 2 });
  expect(a.areas.map((area) => area.population)).not.toEqual(b.areas.map((area) => area.population));
});
