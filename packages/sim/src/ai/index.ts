// AI governments (specification §11): each AI realm decides every few days from what a player of it would see, and
// acts through the same commands. A fixed number of decisions per tick bounds the host time, deterministically.
import { AI_PLAYER, applyCommand } from "../commands";
import { nextRandom } from "../random";
import type { AiMemory, Command, Government, World } from "../types";
import { decideEconomy } from "./economy";
import { decideMilitary } from "./military";
import { TRAITS } from "./personalities";
import { assess } from "./realm";
import { perceive } from "./view";

export interface AiActivity {
  decisions: number; // AI realms that decided this tick
  commands: number; // commands they issued and the host applied
  rejected: number; // commands the host rejected
  milliseconds: number; // time spent deciding this tick
}

// Available in browsers, workers and Node; the sim compiles without the DOM library.
declare const performance: { now(): number };

let activity: AiActivity = { decisions: 0, commands: 0, rejected: 0, milliseconds: 0 };

/** What the AI did in the last tick, for diagnostics. */
export const lastAiActivity = (): Readonly<AiActivity> => activity;

const decisionInterval = (world: World) =>
  Math.max(1, Math.round(world.config.ai.decisionIntervalDays / world.config.pace.gameDaysPerTick));

function newMemory(world: World, government: Government): AiMemory {
  return {
    nextDecisionTick: world.tick + (government.id % decisionInterval(world)), // realms take turns
    createdDay: world.gameDay,
    lastDecisionDay: null,
    lastTreasury: government.treasury,
    standingOrdersPlaced: false,
    wars: [],
    lastPeaceDay: null,
    ownedAreaCount: government.ownedAreas.length,
  };
}

/** Phase 0: the AI realms whose turn it is decide, at most `ai.maxDecisionsPerTick` of them. */
export function runAi(world: World): void {
  const started = performance.now();
  activity = { decisions: 0, commands: 0, rejected: 0, milliseconds: 0 };
  let budget = world.config.ai.maxDecisionsPerTick;
  const count = world.governments.length;
  // Start from a different realm each tick, so the cap delays every realm in turn.
  for (let k = 0; k < count && budget > 0; k++) {
    const government = world.governments[(world.tick + k) % count] as Government;
    if (government.controller.kind !== "ai" || government.personality === "idle" || government.isEliminated) continue;
    government.aiMemory ??= newMemory(world, government);
    if (government.aiMemory.nextDecisionTick > world.tick) continue;
    budget--;
    decide(world, government, government.aiMemory);
  }
  activity.milliseconds = performance.now() - started;
}

function decide(world: World, government: Government, memory: AiMemory): void {
  const personality = government.personality as Exclude<Government["personality"], "idle">;
  const traits = TRAITS[personality];
  const view = perceive(world, government.id);
  const realm = assess(view, memory, traits);
  const commands: Command[] = [];
  decideMilitary(view, realm, memory, traits, commands, () => nextRandom(world));
  decideEconomy(view, realm, memory, traits, personality, commands);
  for (const command of commands) {
    if (applyCommand(world, { player: AI_PLAYER, government: government.id, command }) === null) activity.commands++;
    else activity.rejected++;
  }
  memory.nextDecisionTick = world.tick + decisionInterval(world);
  memory.lastDecisionDay = realm.day;
  memory.lastTreasury = realm.government.treasury;
  memory.ownedAreaCount = realm.owned.size;
  activity.decisions++;
}
