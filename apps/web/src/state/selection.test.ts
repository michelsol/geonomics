import { buildSnapshot, buildStaticData, encodePriceTable, type World } from "@geonomics/sim";
import { describe, expect, it } from "vitest";
import { createGame } from "../host/createGame";
import { actionTarget, areasNear, type Point, selectionSummary, splitByPopulation } from "./selectors";
import { createGameStore } from "./store";

function setup() {
  const world: World = createGame(
    { catalog: "small", areas: 60, seed: 5, realms: 4, aiMix: "balanced", warmupDays: 0 },
    () => {},
  );
  const data = buildStaticData(world);
  const store = createGameStore({ postMessage: () => {} });
  const state = () => store.getState();
  state().receive({ type: "static", data, governments: buildSnapshot(world, null).governments });
  state().chooseRealm(0);
  return { world, data, state };
}

describe("areas near a point", () => {
  it("takes the areas whose center lies within the radius", () => {
    const { data } = setup();
    const a = data.areas[0] as Point;
    expect(areasNear(data, a, 1e-6)).toEqual([0]);
    expect(areasNear(data, a, 1e9).length).toBe(data.areas.length);
    const b = data.areas[1] as Point;
    const between = Math.hypot(a.x - b.x, a.y - b.y);
    expect(areasNear(data, a, between)).toContain(1);
    expect(areasNear(data, a, between * 0.999)).not.toContain(1);
  });
});

describe("the action target", () => {
  it("is the selection's own areas, the whole realm for nothing or all of them, and none for only others' areas", () => {
    const { world, state } = setup();
    const government = buildSnapshot(world, 0).government;
    if (!government) throw new Error("no government");
    const owned = government.ownedAreas;
    const foreign = world.areas.findIndex((area) => area.owner !== 0);
    expect(actionTarget(government, [])).toEqual({ realm: true, areas: owned });
    expect(actionTarget(government, [foreign])).toEqual({ realm: false, areas: [] });
    expect(actionTarget(government, [owned[0] as number, foreign])).toEqual({ realm: false, areas: [owned[0]] });
    expect(actionTarget(government, [...owned, foreign])).toEqual({ realm: true, areas: owned });
    expect(state().selection).toEqual([world.governments[0]?.capital]); // a game opens on the capital
  });
});

describe("splitting by population", () => {
  it("gives whole parts in proportion that sum to the total exactly", () => {
    const population = [100, 300, 600, 0];
    expect(splitByPopulation(1000, [0, 1, 2], population)).toEqual([100, 300, 600]);
    const parts = splitByPopulation(7, [0, 1, 2], population);
    expect(parts.reduce((x, y) => x + y, 0)).toBe(7);
    expect(parts).toEqual([1, 2, 4]);
    expect(splitByPopulation(5, [3], population)).toEqual([5]); // nobody lives there: it all goes there anyway
    expect(splitByPopulation(4, [3, 3], [0, 0, 0, 0])).toEqual([2, 2]);
  });
});

describe("selection summary", () => {
  it("sums people and weights incomes by population, with trade inside the selection cancelling out", () => {
    const { world, data } = setup();
    const own = world.governments[0]?.ownedAreas.slice(0, 2) as [number, number];
    const [a, b] = own.map((id) => world.areas[id]) as [World["areas"][number], World["areas"][number]];
    a.population = 1000;
    b.population = 3000;
    a.imported[0] = 5; // 5 units of good 0 go from b to a
    a.exported[0] = 0;
    b.exported[0] = 5;
    b.imported[0] = 0;
    const snapshot = buildSnapshot(world, 0);
    snapshot.areas.grossIncome[a.id] = 1;
    snapshot.areas.grossIncome[b.id] = 2;
    const summary = selectionSummary(data, snapshot, encodePriceTable(world), own);
    expect(summary.population).toBe(4000);
    expect(summary.grossIncome).toBeCloseTo((1 * 1000 + 2 * 3000) / 4000, 5);
    expect(summary.withDetail).toBe(2);
    expect(summary.market[0]?.trade).toBeCloseTo(0, 5);
    expect(summary.owners).toEqual([{ owner: 0, areas: 2 }]);
  });
});

describe("selecting on the map", () => {
  it("paints strokes that add to the selection, or erase from it", () => {
    const { state } = setup();
    state().selectArea(1);
    state().setMode({ kind: "brush" });
    state().paint([2, 3, 2]);
    expect(state().selection).toEqual([1, 2, 3]);
    expect(state().selectedArea).toBeNull(); // several areas: no single one
    state().paint([3, 4]); // painting over selected areas keeps them once
    expect(state().selection).toEqual([1, 2, 3, 4]);
    state().setBrush({ erase: true });
    expect(state().brush).toEqual({ erase: true, size: "M" });
    state().paint([1, 3, 9]);
    expect(state().selection).toEqual([2, 4]);
    state().paint([4]);
    expect(state()).toMatchObject({ selection: [2], selectedArea: 2 }); // one left: it is the selected area
    state().setBrush({ erase: false, size: "L" });
    state().setMode({ kind: "select" });
    state().setMode({ kind: "brush" });
    expect(state().brush).toEqual({ erase: false, size: "L" }); // the brush keeps its settings
  });

  it("adds and removes single areas with Shift-click", () => {
    const { state } = setup();
    state().clickArea(2);
    state().clickArea(3, true);
    state().clickArea(5, true);
    expect(state().selection).toEqual([2, 3, 5]);
    state().clickArea(3, true);
    expect(state().selection).toEqual([2, 5]);
    state().clickArea(8);
    expect(state()).toMatchObject({ selection: [8], selectedArea: 8 });
  });
});
