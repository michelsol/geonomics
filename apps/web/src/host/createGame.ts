// Builds a new solo game: map generation, Rule 6 initialization, founding and warm-up (specification §5, §6).
import {
  createConfig,
  foundGovernments,
  generateMap,
  initializeWorld,
  loadCatalog,
  type World,
  warmUp,
} from "@geonomics/sim";
import large from "../../../../data/goods/large.json";
import medium from "../../../../data/goods/medium.json";
import small from "../../../../data/goods/small.json";
import type { CatalogName, GameOptions } from "./protocol";

const CATALOGS: Record<CatalogName, unknown> = { small, medium, large };
const WARMUP_CHUNK_DAYS = 10;

/** Generates, initializes and warms up a world, reporting progress in [0, 1] along the way. */
export function createGame(options: GameOptions, progress: (stage: string, done: number) => void): World {
  const catalog = loadCatalog(CATALOGS[options.catalog]);
  const config = createConfig(catalog, { map: { landAreaCount: options.areas, governmentCount: options.realms } });
  progress("Generating the map", 0);
  const { world, capitals } = generateMap(catalog, config, options.seed);
  progress("Settling the population", 0.1);
  initializeWorld(world);
  foundGovernments(world, capitals, options.aiMix);
  const days = options.warmupDays ?? config.warmupDays;
  for (let done = 0; done < days; done += WARMUP_CHUNK_DAYS) {
    progress("Warming up the economy", 0.15 + (0.85 * done) / Math.max(days, 1));
    warmUp(world, Math.min(WARMUP_CHUNK_DAYS, days - done));
  }
  progress("Ready", 1);
  return world;
}
