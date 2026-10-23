// Games with only AI realms (roadmap stage 10 exit): survival per personality, growth, trade and wars.
import {
  type AiMix,
  type Catalog,
  lastAiActivity,
  lastTradeTonnage,
  type Personality,
  runTick,
  type World,
  warmUp,
} from "@geonomics/sim";
import { scenarios } from "./scenarios";

export interface AiGameOptions {
  catalog: Catalog;
  areas: number;
  realms: number;
  mix: AiMix;
  days: number;
  seed?: number;
  every?: number; // days between progress reports
  onProgress?: (progress: AiProgress) => void;
}

export interface AiProgress {
  day: number;
  alive: Partial<Record<Personality, { alive: number; total: number }>>;
  population: number; // total, against the start
  tonnage: number; // tonnes carried per day over every edge
  warsDeclared: number;
  warsEnded: number;
  atWar: number; // pairs of realms at war now
}

export interface AiGameReport extends AiProgress {
  startPopulation: number;
  startTonnage: number;
  realms: {
    name: string;
    personality: Personality;
    alive: boolean;
    startPopulation: number;
    population: number;
    startAreas: number;
    areas: number;
  }[];
  longestWarDays: number;
  aiMsPerTick: number;
  aiMsPerTickMax: number;
  msPerTick: number;
  rejectedCommands: number;
}

const populationOf = (world: World, id: number) =>
  world.governments[id]?.ownedAreas.reduce((sum, area) => sum + (world.areas[area]?.population ?? 0), 0) ?? 0;

const totalTonnage = (world: World) => lastTradeTonnage(world).reduce((sum, t) => sum + t, 0);

/** Founds `realms` AI realms on a generated map, warms it up, and runs `days` with nobody but the AI. */
export function runAiGame(options: AiGameOptions): AiGameReport {
  const world = scenarios.map.build({
    catalog: options.catalog,
    seed: options.seed ?? 1,
    aiMix: options.mix,
    config: { map: { landAreaCount: options.areas, governmentCount: options.realms } },
  });
  warmUp(world);
  runTick(world); // one tick for the trade figures
  const start = world.governments.map((g) => ({ population: populationOf(world, g.id), areas: g.ownedAreas.length }));
  const startPopulation = world.areas.reduce((sum, area) => sum + area.population, 0);
  const startTonnage = totalTonnage(world);
  const n = world.governments.length;
  const warSince = new Map<number, number>(); // pair index → day the war began
  let warsDeclared = 0;
  let warsEnded = 0;
  let longestWarDays = 0;
  let aiTime = 0;
  let aiTimeMax = 0;
  let tickTime = 0;
  let rejectedCommands = 0;
  const ticks = Math.round(options.days / world.config.pace.gameDaysPerTick);
  const every = options.every ?? 250;

  const progress = (): AiProgress => {
    const alive: AiProgress["alive"] = {};
    for (const g of world.governments) {
      const entry = alive[g.personality] ?? { alive: 0, total: 0 };
      alive[g.personality] = entry;
      entry.total++;
      if (!g.isEliminated) entry.alive++;
    }
    return {
      day: world.gameDay,
      alive,
      population: world.areas.reduce((sum, area) => sum + area.population, 0),
      tonnage: totalTonnage(world),
      warsDeclared,
      warsEnded,
      atWar: warSince.size,
    };
  };

  for (let i = 0; i < ticks; i++) {
    const started = performance.now();
    runTick(world);
    tickTime += performance.now() - started;
    const activity = lastAiActivity();
    aiTime += activity.milliseconds;
    aiTimeMax = Math.max(aiTimeMax, activity.milliseconds);
    rejectedCommands += activity.rejected;
    for (let a = 0; a < n; a++)
      for (let b = a + 1; b < n; b++) {
        const pair = a * n + b;
        const atWar = world.relations[a]?.[b] === "war";
        const since = warSince.get(pair);
        if (atWar && since === undefined) {
          warSince.set(pair, world.gameDay);
          warsDeclared++;
        } else if (!atWar && since !== undefined) {
          warSince.delete(pair);
          warsEnded++;
          longestWarDays = Math.max(longestWarDays, world.gameDay - since);
        }
      }
    if (options.onProgress && (i + 1) % Math.round(every / world.config.pace.gameDaysPerTick) === 0)
      options.onProgress(progress());
  }
  for (const since of warSince.values()) longestWarDays = Math.max(longestWarDays, world.gameDay - since);

  return {
    ...progress(),
    startPopulation,
    startTonnage,
    realms: world.governments.map((g) => ({
      name: g.name,
      personality: g.personality,
      alive: !g.isEliminated,
      startPopulation: start[g.id]?.population ?? 0,
      population: populationOf(world, g.id),
      startAreas: start[g.id]?.areas ?? 0,
      areas: g.ownedAreas.length,
    })),
    longestWarDays,
    aiMsPerTick: aiTime / Math.max(ticks, 1),
    aiMsPerTickMax: aiTimeMax,
    msPerTick: tickTime / Math.max(ticks, 1),
    rejectedCommands,
  };
}

export function formatProgress(p: AiProgress, startPopulation?: number): string {
  const alive = Object.entries(p.alive)
    .map(([personality, { alive, total }]) => `${personality} ${alive}/${total}`)
    .join(", ");
  const growth = startPopulation ? ` (${((100 * p.population) / startPopulation - 100).toFixed(1)}%)` : "";
  return `day ${p.day}: ${alive}; population ${Math.round(p.population).toLocaleString("en")}${growth}; trade ${Math.round(p.tonnage).toLocaleString("en")} t/day; wars ${p.warsDeclared} declared, ${p.warsEnded} ended, ${p.atWar} ongoing`;
}
