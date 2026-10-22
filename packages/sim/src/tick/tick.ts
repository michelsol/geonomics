// One simulation tick: eleven phases in a fixed order, each over every area (specification §8).
import type { Area, CommandEnvelope, World } from "../types";
import { runConsumption } from "./consumption";
import { runDecay } from "./decay";
import { advanceInfrastructure } from "./infrastructure";
import { runLabor } from "./labor";
import { runPopulation } from "./population";
import { runPrices } from "./prices";
import { runProduction } from "./production";
import { runTrade } from "./trade";

/**
 * Advances the world by one tick. Commands are validated and applied in phase 0 from roadmap stage 6; government
 * market orders (phase 2), taxes and wages (phase 5) and the military (phase 8) arrive in stages 6 and 7.
 */
export function runTick(world: World, _commands: readonly CommandEnvelope[] = []): void {
  updateBlockedEdges(world); // 0
  runProduction(world); // 1
  runConsumption(world); // 3
  runTrade(world); // 4
  runPrices(world); // 6
  runLabor(world); // 7
  runPopulation(world); // 9
  runDecay(world); // 10
  advanceInfrastructure(world); // 10
  world.tick += 1;
  world.gameDay += world.config.pace.gameDaysPerTick;
}

/** An edge is blocked when its two areas belong to governments at war, or when either area is under siege. */
export function updateBlockedEdges(world: World): void {
  for (const edge of world.edges) {
    const a = world.areas[edge.areaA] as Area;
    const b = world.areas[edge.areaB] as Area;
    const atWar = a.owner !== null && b.owner !== null && world.relations[a.owner]?.[b.owner] === "war";
    edge.isBlocked = atWar || a.besiegingGovernment !== null || b.besiegingGovernment !== null;
  }
}
