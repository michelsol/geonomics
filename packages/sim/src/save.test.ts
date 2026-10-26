import { describe, expect, it } from "vitest";
import { createConfig } from "./config";
import { foundGovernments } from "./government";
import { hashWorld } from "./hash";
import { initializeWorld, warmUp } from "./init";
import { generateMap } from "./mapgen";
import { deserializeWorld, readSaveInfo, type SaveInfo, serializeWorld } from "./save";
import { smallCatalog } from "./testing";
import { runTick } from "./tick/tick";
import type { Command, CommandEnvelope, World } from "./types";

const PLAYER = "p1";

/** A 300-area map with aggressive AI realms, past the conquerors' first wars, and a human player in realm 0. */
function playedWorld(): World {
  const config = createConfig(smallCatalog, { map: { landAreaCount: 300, governmentCount: 6 } });
  const { world, capitals } = generateMap(smallCatalog, config, 5);
  initializeWorld(world);
  foundGovernments(world, capitals, "aggressive");
  warmUp(world, 30);
  (world.governments[0] as World["governments"][number]).controller = { kind: "human", player: PLAYER };
  for (let i = 0; i < 150; i++) runTick(world);
  return world;
}

const info = (world: World): SaveInfo => ({
  gameId: "test",
  title: "Test game",
  gameDay: world.gameDay,
  savedAt: 0,
  catalog: "small",
  areas: world.areas.length,
});

/** The player's commands, by tick from the save: taxes, an army, a fortification job, a market order. */
function commandsAt(world: World, offset: number): CommandEnvelope[] {
  const realm = world.governments[0] as World["governments"][number];
  const capital = realm.capital ?? 0;
  const commands: Record<number, Command> = {
    0: { type: "setRealmPolicy", setting: { policy: "incomeTaxRate", good: null, value: 0.07 } },
    3: { type: "recruitArmy", area: capital, soldiers: 150 },
    7: { type: "setInfrastructureTarget", area: capital, kind: "fort", level: 2 },
    12: {
      type: "placeMarketOrder",
      order: { area: capital, good: 0, side: "buy", remainingQuantity: 50, limitPrice: 10, maximumQuantityPerDay: 10 },
    },
  };
  const command = commands[offset];
  return command ? [{ player: PLAYER, government: 0, command }] : [];
}

const replay = (world: World, ticks: number) => {
  for (let offset = 0; offset < ticks; offset++) runTick(world, commandsAt(world, offset));
};

describe("saves", () => {
  const world = playedWorld();
  const saved = info(world);
  const bytes = serializeWorld(world, saved);

  it("keep the whole world, bit for bit", () => {
    expect(world.armies.size).toBeGreaterThan(0);
    expect(world.relations.flat()).toContain("war");
    const loaded = deserializeWorld(bytes).world;
    (loaded.governments[0] as World["governments"][number]).controller = { kind: "human", player: PLAYER };
    expect(hashWorld(loaded)).toBe(hashWorld(world));
    expect(loaded.armies).toBeInstanceOf(Map);
    expect(loaded.areas[0]?.stock).toBeInstanceOf(Float64Array);
    expect(loaded.areas[0]?.outputLimitedByInputs).toBeInstanceOf(Uint8Array);
  });

  it("replay the same commands into the same world", () => {
    const loaded = deserializeWorld(bytes).world;
    (loaded.governments[0] as World["governments"][number]).controller = { kind: "human", player: PLAYER };
    replay(world, 60);
    replay(loaded, 60);
    expect(hashWorld(loaded)).toBe(hashWorld(world));
  });

  it("give the players' realms back to the AI", () => {
    const loaded = deserializeWorld(bytes).world;
    expect(loaded.governments.every((g) => g.controller.kind === "ai")).toBe(true);
  });

  it("carry their info, readable on its own", () => {
    expect(readSaveInfo(bytes)).toEqual(saved);
  });

  it("reject other files, and formats older or newer than this one", () => {
    expect(() => readSaveInfo(new Uint8Array([1, 2, 3, 4]))).toThrow("not a Geonomics save");
    expect(() => readSaveInfo(new Uint8Array([0x80])) /* an empty msgpack map */).toThrow("not a Geonomics save");
    // The version follows the magic: a float64 4 (0xcb 40 10 00…) becomes 5 (0xcb 40 14 00…) or 3 (0xcb 40 08 00…).
    const at = bytes.indexOf(0xcb);
    const future = bytes.slice();
    future[at + 2] = 0x14;
    expect(() => readSaveInfo(future)).toThrow("newer version of the game (format 5)");
    const past = bytes.slice();
    past[at + 2] = 0x08;
    expect(() => readSaveInfo(past)).toThrow("older version of the game (format 3)");
  });
});
