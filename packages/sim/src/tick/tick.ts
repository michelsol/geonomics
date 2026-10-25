// One simulation tick: eleven phases in a fixed order, each over every area (specification §8).
import { runAi } from "../ai";
import { applyCommands, type CommandRejection, expireProposals } from "../commands";
import type { Area, CommandEnvelope, World } from "../types";
import { runConsumption } from "./consumption";
import { runDecay } from "./decay";
import { runHiring } from "./hiring";
import { runConstruction } from "./infrastructure";
import { runLabor } from "./labor";
import { evaluateStandingOrders, runMarket } from "./market";
import { runDesertion, runEquipment, runMilitary, wearWeapons } from "./military";
import { runPopulation } from "./population";
import { runPrices } from "./prices";
import { runProduction } from "./production";
import { runTaxes } from "./taxes";
import { runTrade } from "./trade";

export interface TickOptions {
  ai?: boolean; // AI realms decide (default); the warm-up runs without them
}

/** Advances the world by one tick, applying the commands first. Returns the rejected commands with the reason. */
export function runTick(
  world: World,
  commands: readonly CommandEnvelope[] = [],
  options: TickOptions = {},
): CommandRejection[] {
  const rejections = applyCommands(world, commands); // 0
  expireProposals(world); // 0
  if (options.ai ?? true) runAi(world); // 0
  evaluateStandingOrders(world); // 0
  updateBlockedEdges(world); // 0
  runProduction(world); // 1
  runMarket(world); // 2
  runConsumption(world); // 3
  runEquipment(world); // 3
  runTrade(world); // 4
  runTaxes(world); // 5
  runPrices(world); // 6
  runLabor(world); // 7
  runHiring(world); // 7
  runDesertion(world); // 7
  runMilitary(world); // 8
  runPopulation(world); // 9
  runDecay(world); // 10
  wearWeapons(world); // 10
  runConstruction(world); // 10
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
