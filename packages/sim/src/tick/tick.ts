// One simulation tick: eleven phases in a fixed order, each over every area (specification §8).
import { applyCommands, type CommandRejection } from "../commands";
import type { Area, CommandEnvelope, World } from "../types";
import { runConsumption } from "./consumption";
import { runDecay } from "./decay";
import { runHiring } from "./hiring";
import { advanceInfrastructure } from "./infrastructure";
import { runJobs } from "./jobs";
import { runLabor } from "./labor";
import { evaluateStandingOrders, runMarket } from "./market";
import { runPopulation } from "./population";
import { runPrices } from "./prices";
import { runProduction } from "./production";
import { runTaxes } from "./taxes";
import { runTrade } from "./trade";

/**
 * Advances the world by one tick, applying the commands first. Returns the commands that were rejected, with the
 * reason. The military (phase 8) arrives in roadmap stage 7.
 */
export function runTick(world: World, commands: readonly CommandEnvelope[] = []): CommandRejection[] {
  const rejections = applyCommands(world, commands); // 0
  evaluateStandingOrders(world); // 0
  updateBlockedEdges(world); // 0
  runProduction(world); // 1
  runMarket(world); // 2
  runConsumption(world); // 3
  runTrade(world); // 4
  runTaxes(world); // 5
  runPrices(world); // 6
  runLabor(world); // 7
  runHiring(world); // 7
  runPopulation(world); // 9
  runDecay(world); // 10
  runJobs(world); // 10
  advanceInfrastructure(world); // 10
  world.tick += 1;
  world.gameDay += world.config.pace.gameDaysPerTick;
  return rejections;
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
