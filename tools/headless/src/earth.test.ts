// A new game's planet: Earth's size and people, at the new-game pace, feeds itself like the reference world.
import {
  createConfig,
  EARTH,
  foundGovernments,
  generateMap,
  initializeWorld,
  lastTradeTonnage,
  NEW_GAME_PACE,
  planetOverrides,
  runTick,
  warmUp,
} from "@geonomics/sim";
import { expect, it } from "vitest";
import { readCatalog } from "./catalogs";
import { Recorder } from "./diagnostics";

it("feeds an Earth-sized world of 300 areas through a year at real-world pace", () => {
  const catalog = readCatalog("medium");
  const map = { landAreaCount: 300, landShare: createConfig(catalog).map.landShare };
  const planet = planetOverrides(map, EARTH);
  const config = createConfig(catalog, { ...planet, map: { ...planet.map, ...map }, pace: NEW_GAME_PACE });
  const { world, capitals } = generateMap(catalog, config, 1);
  expect(2 * Math.PI * (world.map?.radius ?? 0)).toBeCloseTo(EARTH.circumference, -1);
  initializeWorld(world);
  foundGovernments(world, capitals, "balanced");
  warmUp(world);
  const start = world.areas.reduce((sum, area) => sum + area.population, 0);
  // The map holds about the areas asked for (297 here), each with its share of the planet's people.
  expect(Math.abs(start / EARTH.population - 1)).toBeLessThan(0.05);
  const recorder = new Recorder(world);
  for (let day = 0; day < 365; day++) {
    runTick(world);
    recorder.sample();
  }
  // Seed 1 on the medium catalog: 0.1% to 1.7% of necessities unmet, population within 0.3% of its start, volatility
  // up to 0.034, as on the reference world.
  const report = recorder.report();
  expect(report.unmetNecessities).toBeLessThan(0.03);
  expect(report.worstVolatility).toBeLessThan(0.04);
  const population = world.areas.reduce((sum, area) => sum + area.population, 0);
  expect(population / start).toBeGreaterThan(0.98);
  expect(lastTradeTonnage(world).reduce((sum, tonnes) => sum + tonnes, 0)).toBeGreaterThan(0);
}, 120_000);
