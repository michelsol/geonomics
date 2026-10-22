// Roadmap stage 7: war as an economic activity (specification §7).
import {
  type Army,
  applyCommand,
  type Command,
  createGovernment,
  hashWorld,
  lastTradeFlows,
  runTick,
  type World,
  warmUp,
} from "@geonomics/sim";
import { describe, expect, it } from "vitest";
import { readCatalog } from "./catalogs";
import { scenarios } from "./scenarios";

const small = readCatalog("small");

function order(world: World, government: number, ...commands: Command[]): void {
  const rejections = runTick(
    world,
    commands.map((command) => ({ player: `player${government}`, government, command })),
  );
  expect(rejections).toEqual([]);
}

/** An equipped army of `soldiers` for government 0, standing in `area`, raised between two ticks. */
function equippedArmy(world: World, area: number, soldiers: number): Army {
  expect(
    applyCommand(world, { player: "player0", government: 0, command: { type: "recruitArmy", area, soldiers } }),
  ).toBeNull();
  const army = [...world.armies.values()].at(-1) as Army;
  army.weapons = soldiers;
  return army;
}

describe("weapons", () => {
  it("are made once the government buys them, though nobody else uses them", () => {
    const world = scenarios.chain10.build({ catalog: readCatalog("medium") });
    warmUp(world);
    createGovernment(world, { capital: 0, areas: [0, 1, 2], controller: { kind: "human", player: "player0" } });
    const weapons = world.config.military.weaponsGood;
    const price = 2 * (world.goods[weapons]?.laborValue ?? 0);
    expect(world.areas.every((area) => (area.stock[weapons] as number) < 1)).toBe(true);
    order(world, 0, {
      type: "addStandingOrder",
      order: {
        areas: [1],
        rule: { kind: "buyBelowPrice", good: weapons, maximumPrice: price, maximumDepotQuantity: 200 },
      },
    });
    for (let day = 0; day < 60; day++) runTick(world);
    expect(world.governments[0]?.areaStates.get(1)?.depot[weapons]).toBeGreaterThan(190);
  });
});

describe("the §7 example", () => {
  it("1,000 equipped soldiers take an unfortified area of 10,000 people in about 20 days", () => {
    const world = scenarios.twoAreas.build({ catalog: small });
    warmUp(world);
    createGovernment(world, { capital: 0, controller: { kind: "human", player: "player0" } });
    const east = world.areas[1] as World["areas"][number];
    east.population = 10_000;
    const army = equippedArmy(world, 0, 1000);
    order(
      world,
      0,
      { type: "setArmyStance", army: army.id, stance: "attack" },
      { type: "moveArmy", army: army.id, destination: 1 },
    );
    let arrived = -1;
    let captured = -1;
    for (let day = 1; day <= 60 && captured < 0; day++) {
      runTick(world);
      if (arrived < 0 && army.location.kind === "area" && army.location.area === 1) arrived = day;
      if (east.owner === 0) captured = day;
    }
    expect(arrived).toBeGreaterThan(0);
    const days = captured - arrived;
    expect(days).toBeGreaterThanOrEqual(16);
    expect(days).toBeLessThanOrEqual(24);
  });
});

describe("war between two realms", () => {
  /** chain10 after warm-up, split between government 0 (areas 0–4) and government 1 (areas 5–9). */
  function splitChain(): World {
    const world = scenarios.chain10.build({ catalog: small });
    warmUp(world);
    createGovernment(world, { capital: 0, areas: [0, 1, 2, 3, 4], controller: { kind: "human", player: "player0" } });
    createGovernment(world, { capital: 9, areas: [5, 6, 7, 8, 9], controller: { kind: "human", player: "player1" } });
    return world;
  }
  const border = (world: World) =>
    world.edges.find((edge) => (edge.areaA === 4 && edge.areaB === 5) || (edge.areaA === 5 && edge.areaB === 4));
  const flowsAcross = (world: World) => lastTradeFlows(world).filter((flow) => flow.edge === border(world)?.id).length;

  it("stops trade across the front and restores it with peace, which moves areas and money", () => {
    const world = splitChain();
    runTick(world);
    expect(flowsAcross(world)).toBeGreaterThan(0);

    order(world, 0, { type: "declareWar", target: 1 });
    for (let i = 0; i < 10; i++) {
      runTick(world);
      expect(flowsAcross(world)).toBe(0);
    }

    const treasuries = world.governments.map((government) => government.treasury);
    order(world, 1, {
      type: "proposePeace",
      proposal: {
        from: 1,
        to: 0,
        areaTransfers: [{ area: 5, newOwner: 0 }],
        payment: 1000,
        expiresAtDay: world.gameDay + 10,
      },
    });
    const proposal = world.peaceProposals[0]?.id as number;
    order(world, 0, { type: "answerPeace", proposalId: proposal, accept: true });
    expect(world.relations[0]?.[1]).toBe("peace");
    expect(world.areas[5]?.owner).toBe(0);
    expect(world.governments[0]?.ownedAreas).toEqual([0, 1, 2, 3, 4, 5]);
    // Payments move exactly; the treasuries otherwise only collect tariffs, and no policy is set.
    expect(world.governments[0]?.treasury).toBeCloseTo((treasuries[0] as number) + 1000, 6);
    expect(world.governments[1]?.treasury).toBeCloseTo((treasuries[1] as number) - 1000, 6);

    let resumed = false;
    for (let i = 0; i < 30 && !resumed; i++) {
      runTick(world);
      resumed = lastTradeFlows(world).some((flow) => {
        const edge = world.edges[flow.edge];
        return edge !== undefined && [edge.areaA, edge.areaB].includes(5) && [edge.areaA, edge.areaB].includes(6);
      });
    }
    expect(resumed).toBe(true);
  });

  it("is deterministic", () => {
    const run = () => {
      const world = splitChain();
      order(world, 0, { type: "declareWar", target: 1 });
      const army = equippedArmy(world, 4, 800);
      order(
        world,
        0,
        { type: "setArmyStance", army: army.id, stance: "attack" },
        { type: "moveArmy", army: army.id, destination: 7 },
      );
      for (let i = 0; i < 60; i++) runTick(world);
      return { hash: hashWorld(world), owners: world.areas.map((area) => area.owner) };
    };
    const first = run();
    expect(first.owners.slice(5, 7)).toEqual([0, 0]); // the march took at least two areas
    expect(run()).toEqual(first);
  });
});
