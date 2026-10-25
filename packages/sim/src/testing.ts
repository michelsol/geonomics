// Small worlds with governments for the unit tests of commands, government phases and the military.
import small from "../../../data/goods/small.json";
import { loadCatalog } from "./catalog";
import { applyCommand } from "./commands";
import { createConfig, type DeepPartial, type WorldConfig } from "./config";
import { createGovernment } from "./government";
import { initializeWorld, referenceDemandPerPerson } from "./init";
import { staffFully } from "./tick/infrastructure";
import type { Command, World } from "./types";
import { createWorld } from "./world";

export const smallCatalog = loadCatalog(small);
export const goodId = (world: World, key: string) => world.goods.findIndex((good) => good.key === key);
export const PLAYER = "p1";

/**
 * Four areas of 10,000 people, each able to produce every primary good at twice its own demand:
 * 0 "Harbor" (port and airport) — land — 1 "Valley" — land — 3 "March"; 0 — sea and air — 2 "Isle" (port and airport).
 * Government 0 (human player p1) owns 0, 1 and 2 with its capital at 0; government 1 (AI) owns 3. The port and
 * airports start fully staffed.
 */
export function realmWorld(config?: DeepPartial<WorldConfig>): World {
  const probe = createWorld(smallCatalog, createConfig(smallCatalog), {
    areas: [{ name: "probe", position: { x: 0, y: 0 }, population: 1 }],
    edges: [],
    seed: 1,
  });
  const perPerson = referenceDemandPerPerson(probe);
  const capacity = Object.fromEntries(
    smallCatalog.goods
      .filter((good) => good.isPrimary)
      .map((good) => [good.key, 2 * (perPerson[good.id] as number) * 10_000]),
  );
  const area = (name: string, x: number, y: number, port: boolean) => ({
    name,
    position: { x, y },
    population: 10_000,
    naturalCapacity: capacity,
    isCoastal: port,
    portLevel: port ? 1 : 0,
    airportLevel: port ? 1 : 0,
  });
  const world = createWorld(smallCatalog, createConfig(smallCatalog, config), {
    areas: [
      area("Harbor", 0, 0, true),
      area("Valley", 100, 0, false),
      area("Isle", 0, 500, true),
      area("March", 200, 0, false),
    ],
    edges: [
      { a: 0, b: 1, mode: "land" },
      { a: 1, b: 3, mode: "land" },
      { a: 0, b: 2, mode: "sea" },
      { a: 0, b: 2, mode: "air" },
    ],
    seed: 1,
  });
  initializeWorld(world);
  createGovernment(world, { capital: 0, areas: [0, 1, 2], controller: { kind: "human", player: PLAYER } });
  createGovernment(world, { capital: 3 });
  staffFully(world);
  return world;
}

/** Sends a command as player p1 for government 0. */
export function send(world: World, command: Command, player = PLAYER, government = 0): string | null {
  return applyCommand(world, { player, government, command });
}

export function totalMoney(world: World): number {
  let money = 0;
  for (const area of world.areas) money += area.savings;
  for (const government of world.governments) money += government.treasury;
  return money;
}
