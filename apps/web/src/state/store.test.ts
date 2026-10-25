import { buildSnapshot, buildStaticData, encodePriceTable, type World } from "@geonomics/sim";
import { describe, expect, it } from "vitest";
import { createGame } from "../host/createGame";
import type { ToWorker } from "../host/protocol";
import { DIVERGING, spreadColor } from "../map/colors";
import { Series } from "./history";
import {
  conquestEstimate,
  costOfLiving,
  demographyOf,
  employmentOf,
  priceExtremes,
  priceOf,
  realmResults,
  selectionSummary,
} from "./selectors";
import { createGameStore } from "./store";

function setup() {
  const world: World = createGame(
    { catalog: "small", areas: 60, seed: 5, realms: 4, aiMix: "balanced", warmupDays: 0 },
    () => {},
  );
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

describe("demography", () => {
  it("nets growth and starvation into births & deaths, and counts only migrants crossing the edge", () => {
    const { world } = setup();
    const data = buildStaticData(world);
    const snapshot = buildSnapshot(world, 0);
    const { areaA: a, areaB: b } = data.edges[0] as (typeof data.edges)[number];
    const outward = data.edges.findIndex(
      (edge) => (edge.areaA === a) !== (edge.areaB === a) && edge.areaA !== b && edge.areaB !== b,
    );
    const out = data.edges[outward] as (typeof data.edges)[number];
    snapshot.areas.naturalChange.fill(0);
    snapshot.areas.naturalChange[a] = 5;
    snapshot.areas.naturalChange[b] = -3;
    snapshot.edges.migration.fill(0);
    snapshot.edges.migration[0] = 10; // from a to b: inside the selection
    snapshot.edges.migration[outward] = out.areaA === a ? 4 : -4; // from a, out of the selection
    const both = demographyOf(snapshot, data.edges, [a, b]);
    expect(both).toMatchObject({ naturalChange: 2, immigration: 0, emigration: 4 });
    expect(both.population).toBeCloseTo((world.areas[a]?.population ?? 0) + (world.areas[b]?.population ?? 0), -1);
    expect(demographyOf(snapshot, data.edges, [b])).toMatchObject({ naturalChange: -3, immigration: 10 });
  });
});

describe("cost of living and real net income", () => {
  it("is 1 at labor-value prices, rises with dear food, and divides net income into real net income", () => {
    const { world } = setup();
    for (const area of world.areas) for (const good of world.goods) area.price[good.id] = good.laborValue;
    const data = buildStaticData(world);
    expect(costOfLiving(data, encodePriceTable(world), 0)).toBeCloseTo(1, 3);
    const food = world.goods.filter((good) => good.satisfies && data.needs[good.satisfies.need]?.key === "food");
    expect(food.length).toBeGreaterThan(0);
    for (const good of food) (world.areas[0] as World["areas"][number]).price[good.id] = 2 * good.laborValue;
    const table = encodePriceTable(world);
    const living = costOfLiving(data, table, 0);
    expect(living).toBeGreaterThan(1.05);
    expect(living).toBeLessThan(2);
    const summary = selectionSummary(data, buildSnapshot(world, 0), table, [0]);
    expect(summary.costOfLiving).toBeCloseTo(living, 6);
    expect(summary.netIncome).toBeGreaterThan(0);
    expect(summary.realNetIncome).toBeCloseTo(summary.netIncome / living, 6);
    expect(selectionSummary(data, buildSnapshot(world, 0), null, [0]).costOfLiving).toBeNull();
  });
});

describe("realm results", () => {
  it("give every realm's areas, population, peak and soldiers, fallen realms last", () => {
    const { world } = setup();
    const data = buildStaticData(world);
    const snapshot = buildSnapshot(world, 0);
    const before = snapshot.armies.filter((army) => army.owner === 1).reduce((sum, army) => sum + army.soldiers, 0);
    snapshot.armies.push({ owner: 1, soldiers: 250 } as never);
    const fallen = snapshot.governments[2] as (typeof snapshot.governments)[number];
    snapshot.governments[2] = { ...fallen, isEliminated: true };
    const results = realmResults(data, snapshot, encodePriceTable(world), [0, 1e9]);
    expect(results).toHaveLength(world.governments.length);
    for (const result of results) {
      const government = snapshot.governments[result.id];
      expect(result.areas).toBe(government?.areaCount);
      expect(result.population).toBeCloseTo(government?.population ?? 0, -1);
    }
    expect(results.find((r) => r.id === 1)?.peakPopulation).toBe(1e9);
    expect(results.find((r) => r.id === 1)?.soldiers).toBeCloseTo(before + 250, 6);
    expect(results.at(-1)?.id).toBe(2);
  });

  it("are summed up at the end, with each realm's peak population", () => {
    const { world, state } = setup();
    state().chooseRealm(0);
    state().receive({ type: "snapshot", snapshot: buildSnapshot(world, 0) });
    const first = state().realmPeaks[1] as number;
    for (const area of world.areas) if (area.owner === 1) area.population /= 2;
    state().receive({ type: "snapshot", snapshot: buildSnapshot(world, 0) });
    expect(state().realmPeaks[1]).toBe(first);
    state().endGame();
    const realms = state().summary?.realms ?? [];
    expect(realms.find((r) => r.id === 1)?.peakPopulation).toBe(first);
    expect(realms.find((r) => r.id === 0)?.ranBy).toBe("you");
    expect(realms.find((r) => r.id === 1)?.ranBy).toMatch(/^AI · /);
  });
});

describe("colors against the map's own values", () => {
  it("run from blue at the lowest value through white at the median to red at the highest", () => {
    const scale = { low: 1, median: 2, high: 8 };
    expect(spreadColor(1, scale)).toBe(DIVERGING[0]);
    expect(spreadColor(2, scale)).toBe(DIVERGING[2]);
    expect(spreadColor(8, scale)).toBe(DIVERGING[4]);
    expect(spreadColor(4, scale)).toBe(DIVERGING[3]); // halfway up on a log scale
    expect(spreadColor(2, { low: 2, median: 2, high: 2 })).toBe(DIVERGING[2]); // no spread: white
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
  it("sums private workers, government jobs, infrastructure staff and the unemployed over areas", () => {
    const { world } = setup();
    const snapshot = buildSnapshot(world, 0);
    const government = snapshot.government as NonNullable<typeof snapshot.government>;
    const data = buildStaticData(world);
    const employment = employmentOf(data, snapshot, government, government.ownedAreas);
    let privateWorkers = 0;
    let unemployed = 0;
    let staff = 0;
    for (const id of government.ownedAreas) {
      const area = world.areas[id] as World["areas"][number];
      for (const workers of area.privateWorkers) privateWorkers += workers;
      unemployed += area.unemployedWorkers;
      for (const workers of world.governments[0]?.areaStates.get(id)?.staff ?? []) staff += workers;
    }
    expect(employment.privateTotal).toBeCloseTo(privateWorkers, -1);
    expect(employment.unemployed).toBeCloseTo(unemployed, 0);
    expect(staff).toBeGreaterThan(0); // the starting port and airport
    expect(employment.government).toBeCloseTo(staff, 3);
  });
});

describe("game store", () => {
  it("moves from realm choice to the game and starts the worker", () => {
    const { state, sent } = setup();
    expect(state().screen).toBe("chooseRealm");
    expect(state().governments.length).toBeGreaterThan(0);
    state().chooseRealm(1);
    expect(state().screen).toBe("game");
    expect(sent.at(-1)).toEqual({ type: "start", government: 1, speed: 5 }); // 2× off phones
    expect(state().selectedArea).toBe(state().governments[1]?.capital);
  });

  it("records snapshots and price tables into the chart history", () => {
    const { world, state } = setup();
    state().chooseRealm(0);
    state().receive({ type: "snapshot", snapshot: buildSnapshot(world, 0) });
    expect(state().snapshot?.government?.id).toBe(0);
    expect(state().history?.areaPrices.size).toBeGreaterThan(0);
    state().receive({ type: "priceTable", tick: 0, gameDay: 0, table: encodePriceTable(world) });
    const [low, median, high] = [0, 1, 2].map((c) => state().history?.goodPrices[0]?.channel(c)[0] as number);
    expect(low).toBeLessThanOrEqual(median as number);
    expect(median).toBeLessThanOrEqual(high as number);
  });

  it("asks for the selected good's trade flows only while the transport flows show", () => {
    const { state, sent } = setup();
    state().chooseRealm(0);
    const flowGoods = () => sent.flatMap((m) => (m.type === "setFlowGood" ? [m.good] : []));
    const first = state().selectedGood;
    state().selectGood(first === 2 ? 3 : 2);
    expect(flowGoods()).toEqual([]); // no flows shown: nothing to ask for
    const chosen = state().selectedGood;
    state().openPanel("goods");
    state().setShowTransport(true);
    state().selectGood(4);
    state().openPanel("area");
    expect(flowGoods()).toEqual([chosen, 4, null]);
  });

  it("shows each panel's map layer, and its flows while their checkbox is on", () => {
    const { state } = setup();
    state().chooseRealm(0);
    expect([state().panel, state().layer, state().flows]).toEqual(["area", "realms", "none"]);
    state().openPanel("jobs");
    expect(state().layer).toBe("employment");
    state().openPanel("policies");
    expect(state().layer).toBe("income");
    state().openPanel("population");
    expect([state().layer, state().flows]).toEqual(["population", "none"]);
    state().setShowMigration(true);
    expect(state().flows).toBe("migration");
    state().openPanel("goods");
    expect([state().layer, state().flows]).toEqual(["prices", "none"]); // migration belongs to Population
    state().setShowTransport(true);
    expect(state().flows).toBe("transport");
    state().openPanel("armies");
    expect([state().layer, state().flows]).toEqual(["realms", "none"]);
    state().openPanel("population"); // the checkbox kept its value
    expect(state().flows).toBe("migration");
    state().openPanel("resources");
    expect(state().layer).toBe("resources");
    expect(state().data?.goods[state().selectedResource]?.isPrimary).toBe(true);
  });

  it("goes back to the Area panel for a new game", () => {
    const { world, state } = setup();
    state().openPanel("needs");
    state().receive({ type: "static", data: buildStaticData(world), governments: [] });
    expect([state().panel, state().layer]).toEqual(["area", "realms"]);
  });

  it("records the demography of the realm and of the selection once per game day", () => {
    const { world, state } = setup();
    state().chooseRealm(0);
    const owned = world.governments[0]?.ownedAreas as number[];
    state().selectAreas(owned.slice(0, 2));
    state().receive({ type: "snapshot", snapshot: buildSnapshot(world, 0) });
    state().receive({ type: "snapshot", snapshot: buildSnapshot(world, 0) }); // the same day: replaced
    const history = state().history;
    const realm = history?.demographyOf([]);
    expect(realm?.length).toBe(1);
    const people = owned.reduce((sum, area) => sum + (world.areas[area]?.population ?? 0), 0);
    expect(realm?.channel(0)[0]).toBeCloseTo(people, -1);
    expect(history?.demographyOf(owned.slice(0, 2))?.length).toBe(1);
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
    expect(sent.at(-1)).toEqual({ type: "start", government: 2, speed: 5 });
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
