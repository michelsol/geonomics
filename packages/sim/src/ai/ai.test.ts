import { describe, expect, it } from "vitest";
import { createConfig, type DeepPartial, type WorldConfig } from "../config";
import { aiPersonalities } from "../government";
import { hashWorld } from "../hash";
import { goodId, realmWorld, send, smallCatalog } from "../testing";
import { staffFully } from "../tick/infrastructure";
import { runTick } from "../tick/tick";
import type { Government, Personality, World } from "../types";
import { createWaterCell, createWorld, setWaterDepths } from "../world";
import { lastAiActivity } from ".";
import { seaGains } from "./economy";
import { TRAITS } from "./personalities";
import { perceive } from "./view";

const government = (world: World, id: number) => world.governments[id] as Government;
const taxOf = (g: Government) =>
  g.realmPolicies.find((s) => s.policy === "productionTaxRate" && s.good === null)?.value ?? 0;

/** The test realms with the AI running government `id` as `personality`. */
function aiWorld(personalities: Partial<Record<number, Personality>>, config?: DeepPartial<WorldConfig>): World {
  const world = realmWorld(config);
  for (const [id, personality] of Object.entries(personalities)) {
    const g = government(world, Number(id));
    g.controller = { kind: "ai" };
    g.personality = personality as Personality;
  }
  return world;
}

const days = (world: World, count: number) => {
  for (let i = 0; i < count; i++) runTick(world);
};

describe("personalities", () => {
  it("follow the game's mix, in a seeded order", () => {
    const world = createWorld(smallCatalog, createConfig(smallCatalog), { areas: [], edges: [], seed: 7 });
    const count = (list: Personality[], p: Personality) => list.filter((x) => x === p).length;
    const balanced = aiPersonalities(world, "balanced", 6);
    expect(["trader", "builder", "conqueror"].map((p) => count(balanced, p as Personality))).toEqual([2, 2, 2]);
    expect(count(aiPersonalities(world, "peaceful", 6), "conqueror")).toBe(0);
    expect(count(aiPersonalities(world, "aggressive", 8), "conqueror")).toBe(4);
    const again = createWorld(smallCatalog, createConfig(smallCatalog), { areas: [], edges: [], seed: 7 });
    expect(aiPersonalities(again, "balanced", 6)).toEqual(balanced);
  });
});

describe("the economy", () => {
  it("sets the tax, the soldier wage and a trader's standing orders at the first decision", () => {
    const world = aiWorld({ 1: "trader" });
    days(world, 2);
    const trader = government(world, 1);
    expect(taxOf(trader)).toBeCloseTo(TRAITS.trader.baseTax);
    expect(trader.soldierWage).toBeLessThan(world.config.military.soldierWage);
    const kinds = trader.standingOrders.map((order) => order.rule.kind);
    expect(kinds).toContain("buyBelowPrice");
    expect(kinds).toContain("sellAbovePrice");
  });

  it("raises the tax when the treasury runs short and keeps falling", () => {
    const world = aiWorld({ 1: "builder" });
    days(world, 11); // decisions at ticks 1 and 11
    const builder = government(world, 1);
    builder.treasury = 1;
    (builder.aiMemory as NonNullable<Government["aiMemory"]>).lastTreasury = 1000;
    days(world, 10); // the decision at tick 21 sees the treasury fall
    expect(taxOf(builder)).toBeGreaterThan(TRAITS.builder.baseTax);
  });

  it("builds infrastructure its tax income can run", () => {
    // Cheap staff and building, so the tiny test realm can afford several levels.
    const staffPerLevel = { port: 5, airport: 5, roads: 2, fort: 2 };
    const costPerLevel = { port: 10_000, airport: 20_000, roads: 5_000, fort: 5_000 };
    const world = aiWorld({ 0: "builder" }, { infrastructure: { staffPerLevel, costPerLevel } });
    days(world, 25);
    const builder = government(world, 0);
    const building = [...builder.areaStates.entries()].filter(([area, state]) => {
      const built = world.areas[area] as World["areas"][number];
      const levels = [built.portLevel, built.airportLevel, built.roadLevel, built.fortificationLevel];
      return levels.some((level, k) => (state.targetLevel[k] as number) > level);
    });
    expect(building.length).toBeGreaterThan(0);
    // As many levels as it can afford, not one at a time.
    const levels = building.reduce(
      (sum, [area, state]) =>
        sum +
        [
          world.areas[area]?.portLevel,
          world.areas[area]?.airportLevel,
          world.areas[area]?.roadLevel,
          world.areas[area]?.fortificationLevel,
        ].filter((level, k) => (state.targetLevel[k] as number) > (level as number)).length,
      0,
    );
    expect(levels).toBeGreaterThan(1);
  });

  it("values a port by the sea resources its next level would reach", () => {
    const world = aiWorld({ 0: "trader" });
    const fish = goodId(world, "fish");
    // Off Harbor (0), an empty cell and fish one hop further; off Isle (2), fish in reach already, nothing beyond.
    const cells = [
      createWaterCell(0, { x: -100, y: 0 }, [0], [1], world.goods.length),
      createWaterCell(1, { x: -200, y: 0 }, [], [0], world.goods.length),
      createWaterCell(2, { x: 0, y: 600 }, [2], [], world.goods.length),
    ];
    (cells[1] as World["waters"][number]).naturalCapacityMaximum[fish] = 3000;
    (cells[2] as World["waters"][number]).naturalCapacityMaximum[fish] = 5000;
    world.waters.push(...cells);
    setWaterDepths(world.waters);
    const gains = seaGains(perceive(world, 0), [0, 1, 2]);
    expect(gains.get(0)).toBeCloseTo(3000 * (world.goods[fish]?.laborValue as number), 6);
    expect(gains.get(2)).toBe(0);
    expect(gains.has(1)).toBe(false); // no coast
  });

  it("takes infrastructure down when it cannot pay for it", () => {
    const world = aiWorld({ 0: "builder" });
    const valley = world.areas[1] as World["areas"][number];
    valley.roadLevel = 3;
    valley.fortificationLevel = 3;
    const state = government(world, 0).areaStates.get(1);
    state?.targetLevel.set([0, 0, 3, 3]);
    staffFully(world);
    const levels = () =>
      world.areas.reduce((sum, a) => sum + a.portLevel + a.airportLevel + a.roadLevel + a.fortificationLevel, 0);
    const before = levels();
    government(world, 0).treasury = 1000;
    days(world, 60);
    expect(levels()).toBeLessThan(before);
  });
});

describe("war and peace", () => {
  it("raises a holding army where an attacker marches in", () => {
    const world = aiWorld({ 1: "builder" });
    expect(send(world, { type: "declareWar", target: 1 })).toBeNull();
    expect(send(world, { type: "recruitArmy", area: 1, soldiers: 2000 })).toBeNull();
    const attacker = [...world.armies.values()].at(-1) as NonNullable<ReturnType<World["armies"]["get"]>>;
    send(world, { type: "setArmyStance", army: attacker.id, stance: "attack" });
    send(world, { type: "moveArmy", army: attacker.id, destination: 3 });
    days(world, 12);
    const defenders = [...world.armies.values()].filter((army) => army.owner === 1);
    expect(defenders.length).toBeGreaterThan(0);
    expect(defenders[0]?.stance).toBe("hold");
  });

  it("a conqueror declares war on a weak neighbor and marches on it", () => {
    const world = aiWorld({ 1: "conqueror" }, { military: { militiaShare: 0.001 } });
    (world.areas[2] as World["areas"][number]).population = 5000; // a neighbor at most three times its size
    days(world, TRAITS.conqueror.firstWarDelayDays + 30);
    expect(world.relations[1]?.[0]).toBe("war");
    const attackers = [...world.armies.values()].filter((army) => army.owner === 1 && army.stance === "attack");
    expect(attackers.length).toBeGreaterThan(0);
  });

  it("answers peace: status quo accepted, a demand for its land refused", () => {
    const world = aiWorld({ 1: "builder" });
    days(world, 1);
    expect(send(world, { type: "declareWar", target: 1 })).toBeNull();
    const propose = (areaTransfers: { area: number; newOwner: number }[]) =>
      send(world, {
        type: "proposePeace",
        proposal: { from: 0, to: 1, areaTransfers, payment: 0, expiresAtDay: world.gameDay + 30 },
      });
    expect(propose([{ area: 3, newOwner: 0 }])).toBeNull();
    days(world, 11);
    expect(world.relations[0]?.[1]).toBe("war");
    expect(world.peaceProposals).toEqual([]);
    expect(propose([])).toBeNull();
    days(world, 11);
    expect(world.relations[0]?.[1]).toBe("peace");
  });
});

describe("cadence", () => {
  it("lets at most the configured number of realms decide in one tick", () => {
    const world = aiWorld({ 0: "trader", 1: "builder" }, { ai: { decisionIntervalDays: 1, maxDecisionsPerTick: 1 } });
    const decisions: number[] = [];
    for (let i = 0; i < 6; i++) {
      runTick(world);
      decisions.push(lastAiActivity().decisions);
    }
    expect(Math.max(...decisions)).toBe(1);
    expect(government(world, 0).aiMemory?.lastDecisionDay).not.toBeNull();
    expect(government(world, 1).aiMemory?.lastDecisionDay).not.toBeNull();
  });

  it("replays identically from the same seed", () => {
    const run = () => {
      const world = aiWorld({ 0: "trader", 1: "conqueror" }, { military: { militiaShare: 0.001 } });
      days(world, 150);
      return hashWorld(world);
    };
    expect(run()).toBe(run());
  });
});
