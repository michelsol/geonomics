import { buildSnapshot, buildStaticData, encodePriceTable, type World } from "@geonomics/sim";
import { describe, expect, it } from "vitest";
import { createGame } from "../host/createGame";
import type { ToWorker } from "../host/protocol";
import { Series } from "./history";
import { conquestEstimate, employmentOf, priceExtremes, priceOf } from "./selectors";
import { createGameStore } from "./store";

function setup() {
  const world: World = createGame({ catalog: "small", areas: 60, seed: 5, realms: 4, warmupDays: 0 }, () => {});
  const sent: ToWorker[] = [];
  const store = createGameStore({ postMessage: (message) => sent.push(message) });
  const state = () => store.getState();
  state().receive({
    type: "static",
    data: buildStaticData(world),
    governments: buildSnapshot(world, null).governments,
  });
  return { world, sent, store, state };
}

describe("Series", () => {
  it("keeps the last samples in time order and replaces a repeated day", () => {
    const series = new Series(1, 3);
    for (const day of [1, 2, 3, 4]) series.push(day, [day * 10]);
    series.push(4, [41]);
    expect(series.xs()).toEqual([2, 3, 4]);
    expect(series.channel(0)).toEqual([20, 30, 41]);
  });
});

describe("selectors", () => {
  it("find the lowest, median and highest price of a good", () => {
    const { world } = setup();
    const grain = 0;
    for (const area of world.areas)
      area.price[grain] = (world.goods[grain]?.laborValue as number) * (1 + area.id / 100);
    const data = buildStaticData(world);
    const table = encodePriceTable(world);
    const extremes = priceExtremes(data, table, grain);
    expect(extremes.low.area).toBe(0);
    expect(extremes.high.area).toBe(world.areas.length - 1);
    expect(extremes.median.price).toBeGreaterThan(extremes.low.price);
    expect(priceOf(data, table, 3, grain)).toBeCloseTo(world.areas[3]?.price[grain] as number, 3);
  });
});

describe("conquest estimate", () => {
  it("needs attack power above the militia's and armies', and sieges for population over power", () => {
    const { world } = setup();
    expect(world.areas.every((area) => area.owner !== null)).toBe(true); // the map is fully claimed
    const enemy = world.areas.find((area) => area.owner === 1) as World["areas"][number];
    enemy.militia = 300;
    enemy.population = 15_000;
    const data = buildStaticData(world);
    const estimate = conquestEstimate(data, buildSnapshot(world, 0), enemy.id);
    expect(estimate).toMatchObject({ militia: 300, armyPower: 0, defensePower: 300 });
    expect(estimate.equippedNeeded).toBe(150);
    expect(estimate.unequippedNeeded).toBe(300);
    // siegeRatePerDay × power / population per day: 0.25 × 2,000 / 15,000 = 1/30 of the siege per day.
    expect(estimate.siegeDaysPer1000Equipped).toBeCloseTo(30, 1);

    // An equipped army of the owner adds twice its soldiers.
    world.armies.set(99, {
      id: 99,
      owner: 1,
      location: { kind: "area", area: enemy.id },
      path: [],
      soldiers: 100,
      weapons: 100,
      stance: "hold",
    });
    expect(conquestEstimate(data, buildSnapshot(world, 0), enemy.id).defensePower).toBe(500);
  });
});

describe("employment", () => {
  it("sums private workers, government jobs and the unemployed over areas", () => {
    const { world } = setup();
    const snapshot = buildSnapshot(world, 0);
    const government = snapshot.government as NonNullable<typeof snapshot.government>;
    const data = buildStaticData(world);
    const employment = employmentOf(data, snapshot, government, government.ownedAreas);
    let privateWorkers = 0;
    let unemployed = 0;
    for (const id of government.ownedAreas) {
      const area = world.areas[id] as World["areas"][number];
      for (const workers of area.privateWorkers) privateWorkers += workers;
      unemployed += area.unemployedWorkers;
    }
    expect(employment.privateTotal).toBeCloseTo(privateWorkers, -1);
    expect(employment.unemployed).toBeCloseTo(unemployed, 0);
    expect(employment.government).toBe(0);
  });
});

describe("game store", () => {
  it("moves from realm choice to the game and starts the worker", () => {
    const { state, sent } = setup();
    expect(state().screen).toBe("chooseRealm");
    expect(state().governments.length).toBeGreaterThan(0);
    state().chooseRealm(1);
    expect(state().screen).toBe("game");
    expect(sent.at(-1)).toEqual({ type: "start", government: 1 });
    expect(state().selectedArea).toBe(state().governments[1]?.capital);
  });

  it("records snapshots and price tables into the chart history", () => {
    const { world, state } = setup();
    state().chooseRealm(0);
    state().receive({ type: "snapshot", snapshot: buildSnapshot(world, 0) });
    expect(state().snapshot?.government?.id).toBe(0);
    expect(state().history?.realm.length).toBe(1);
    expect(state().history?.areaPrices.size).toBeGreaterThan(0);
    state().receive({ type: "priceTable", tick: 0, gameDay: 0, table: encodePriceTable(world) });
    const [low, median, high] = [0, 1, 2].map((c) => state().history?.goodPrices[0]?.channel(c)[0] as number);
    expect(low).toBeLessThanOrEqual(median as number);
    expect(median).toBeLessThanOrEqual(high as number);
  });

  it("asks for one good's trade flows only while the transport flows show it, whatever the area layer", () => {
    const { state, sent } = setup();
    state().chooseRealm(0);
    const flowGoods = () => sent.flatMap((m) => (m.type === "setFlowGood" ? [m.good] : []));
    state().setFlows("transport");
    expect(flowGoods()).toEqual([]); // all goods: tonnage needs no request
    state().setTransportGood(2);
    expect(state().selectedGood).toBe(2);
    state().setLayer("population"); // the area layer does not change the flows
    state().selectGood(3);
    state().setFlows("migration");
    state().setTransportGood("all");
    expect(flowGoods()).toEqual([2, 3, null]);
    expect(state().layer).toBe("population");
  });

  it("turns map clicks into army moves and peace picks by mode", () => {
    const { state, sent } = setup();
    state().chooseRealm(0);
    state().setMode({ kind: "moveArmy", army: 7 });
    state().clickArea(12);
    expect(sent.at(-1)).toEqual({ type: "command", command: { type: "moveArmy", army: 7, destination: 12 } });
    expect(state().mode.kind).toBe("select");
    state().setMode({ kind: "pickPeaceAreas" });
    state().clickArea(3);
    state().clickArea(4);
    state().clickArea(3);
    expect(state().peaceAreas).toEqual([4]);
    state().setMode({ kind: "select" });
    state().clickArea(9);
    expect(state().selectedArea).toBe(9);
  });

  it("shows rejections as toasts and ends the session when the realm is eliminated", () => {
    const { world, state, sent } = setup();
    state().chooseRealm(0);
    state().receive({ type: "rejected", to: "local", command: { type: "declareWar", target: 0 }, reason: "nope" });
    expect(state().toasts.at(-1)?.text).toBe("declareWar: nope");
    (world.governments[0] as World["governments"][number]).isEliminated = true;
    state().receive({ type: "snapshot", snapshot: buildSnapshot(world, 0) });
    expect(state().screen).toBe("ended");
    expect(state().summary?.eliminated).toBe(true);
    expect(sent.at(-1)).toEqual({ type: "endGame" });
  });

  it("keeps the last detail of visible areas when a joined player receives them in turns", () => {
    const { world, state } = setup();
    state().chooseRealm(0);
    const full = buildSnapshot(world, 0);
    expect(full.visibleAreas.length).toBeGreaterThan(2);
    const [first, second, ...rest] = full.visibleAreas as [number, number, ...number[]];
    state().receive({ type: "snapshot", snapshot: buildSnapshot(world, 0, undefined, { detailAreas: () => [first] }) });
    expect(state().snapshot?.detail.map((d) => d.area)).toEqual([first]);
    state().receive({
      type: "snapshot",
      snapshot: buildSnapshot(world, 0, undefined, { detailAreas: () => [second] }),
    });
    expect(state().snapshot?.detail.map((d) => d.area)).toEqual([first, second]);
    state().receive({ type: "snapshot", snapshot: buildSnapshot(world, 0, undefined, { detailAreas: () => rest }) });
    expect(state().snapshot?.detail.map((d) => d.area)).toEqual(full.visibleAreas);
  });

  it("lets a joined player enter only once the host accepts its choice", () => {
    const { state, sent } = setup();
    state().setSession({ role: "client" });
    state().chooseRealm(2);
    expect(sent.at(-1)).toEqual({ type: "start", government: 2 });
    expect(state().screen).toBe("chooseRealm"); // waiting for the host
    const you = { id: "bob", name: "Bob", role: "player" as const, government: 2, online: true, isHost: false };
    state().enterAs(you);
    expect(state().screen).toBe("game");
    expect(state().viewer).toBe(2);
    state().enterAs({ ...you, role: "choosing", government: null }); // the host released the realm
    expect(state().screen).toBe("chooseRealm");
    state().enterAs({ ...you, role: "spectator", government: null });
    expect(state()).toMatchObject({ screen: "game", viewer: null });
  });
});
