// Builds a new solo game: map generation, Rule 6 initialization, founding and warm-up (specification §4, §5).
import {
  createConfig,
  DEFAULT_CONFIG,
  EARTH,
  foundGovernments,
  generateMap,
  initializeWorld,
  loadCatalog,
  NEW_GAME_PACE,
  planetOverrides,
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
  const map = { landAreaCount: options.areas, governmentCount: options.realms };
  const planet = planetOverrides({ ...map, landShare: DEFAULT_CONFIG.map.landShare }, options.planet ?? EARTH);
  const config = createConfig(catalog, {
    ...planet,
    map: { ...planet.map, ...map },
    pace: { ...NEW_GAME_PACE, ...options.pace },
  });
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
