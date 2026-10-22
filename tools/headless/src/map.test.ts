// Roadmap stage 5: a generated map warms up without collapsing, and a large map ticks fast enough.
import { runTick, warmUp } from "@geonomics/sim";
import { expect, it } from "vitest";
import { readCatalog } from "./catalogs";
import { Recorder } from "./diagnostics";
import { scenarios } from "./scenarios";

it("warms up a 1,000-area map without collapsing any area", () => {
  const world = scenarios.map.build({ catalog: readCatalog("medium") });
  const before = world.areas.map((area) => area.population);
  warmUp(world);
  const recorder = new Recorder(world);
  for (let i = 0; i < 30; i++) {
    runTick(world);
    recorder.sample();
  }
  const report = recorder.report();
  expect(report.unmetNecessities).toBeLessThan(0.06);
  expect(report.worstVolatility).toBeLessThan(0.03);
  // No collapse: people may move away, but no area empties and very few go hungry.
  for (const area of world.areas) {
    expect(area.population).toBeGreaterThan(0.75 * (before[area.id] as number));
    for (const value of area.price) expect(Number.isFinite(value)).toBe(true);
  }
  const hungry = world.areas.filter((area) => area.necessitySatisfaction < 0.5).length;
  expect(hungry / world.areas.length).toBeLessThan(0.05);
}, 60_000);

it("ticks a 3,000-area map with the large catalog", () => {
  const world = scenarios.map.build({ catalog: readCatalog("large"), config: { map: { landAreaCount: 3000 } } });
  for (let i = 0; i < 3; i++) runTick(world);
  const started = performance.now();
  for (let i = 0; i < 5; i++) runTick(world);
  // Generous bound so CI stays stable; `pnpm headless -- --scenario map --areas 3000` reports the real figure.
  expect((performance.now() - started) / 5).toBeLessThan(150);
}, 60_000);
