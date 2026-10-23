import { buildSnapshot, buildStaticData, encodePriceTable, type World } from "@geonomics/sim";
import { describe, expect, it } from "vitest";
import { createGame } from "../host/createGame";
import { areasInPolygon, type Point, selectionSummary, splitByPopulation } from "./selectors";
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

/** A square of side 2 × half around a point, as lasso corners. */
const square = (center: Point, half: number): Point[] => [
  { x: center.x - half, y: center.y - half },
  { x: center.x + half, y: center.y - half },
  { x: center.x + half, y: center.y + half },
  { x: center.x - half, y: center.y + half },
];

describe("areas in a polygon", () => {
  it("selects the areas whose center lies inside, in a convex or concave outline", () => {
    const { data } = setup();
    const [a, b] = data.areas as unknown as [Point, Point];
    expect(areasInPolygon(data, square(a, 1e-3))).toEqual([0]);
    const all = areasInPolygon(data, square({ x: 0, y: 0 }, 1e9));
    expect(all.length).toBe(data.areas.length);
    // A U shape around both areas' centers, with its notch between them, holds both but nothing at the notch.
    const xs = [a.x, b.x].sort((p, q) => p - q) as [number, number];
    const y = Math.min(a.y, b.y) - 1e-3;
    const top = Math.max(a.y, b.y) + 1e-3;
    const mid = (xs[0] + xs[1]) / 2;
    const u: Point[] = [
      { x: xs[0] - 1e-3, y },
      { x: xs[1] + 1e-3, y },
      { x: xs[1] + 1e-3, y: top },
      { x: mid + 1e-4, y: top },
      { x: mid + 1e-4, y },
      { x: mid - 1e-4, y },
      { x: mid - 1e-4, y: top },
      { x: xs[0] - 1e-3, y: top },
    ];
    const inside = areasInPolygon(data, u);
    expect(inside).toContain(0);
    expect(inside).toContain(1);
    expect(areasInPolygon(data, u.slice(0, 2))).toEqual([]); // fewer than three corners
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
  it("sums people and weights wages by population, with trade inside the selection cancelling out", () => {
    const { world, data } = setup();
    const own = world.governments[0]?.ownedAreas.slice(0, 2) as [number, number];
    const [a, b] = own.map((id) => world.areas[id]) as [World["areas"][number], World["areas"][number]];
    a.wageLevel = 1;
    b.wageLevel = 2;
    a.population = 1000;
    b.population = 3000;
    a.imported[0] = 5; // 5 units of good 0 go from b to a
    a.exported[0] = 0;
    b.exported[0] = 5;
    b.imported[0] = 0;
    const snapshot = buildSnapshot(world, 0);
    const summary = selectionSummary(data, snapshot, encodePriceTable(world), own);
    expect(summary.population).toBe(4000);
    expect(summary.wageLevel).toBeCloseTo((1 * 1000 + 2 * 3000) / 4000, 5);
    expect(summary.withDetail).toBe(2);
    expect(summary.market[0]?.trade).toBeCloseTo(0, 5);
    expect(summary.owners).toEqual([{ owner: 0, areas: 2 }]);
  });
});

describe("selecting on the map", () => {
  it("draws polygons that replace, add to or remove from the selection", () => {
    const { data, state } = setup();
    const near = (area: number) => square(data.areas[area] as Point, 1e-3);
    const lasso = (corners: Point[]) => {
      state().startLasso(corners[0] as Point);
      for (const corner of corners.slice(1)) state().addLassoPoint(corner);
      state().closeLasso();
    };
    const everything = square({ x: 0, y: 0 }, 1e9);
    lasso(everything);
    expect(state().selection.length).toBe(data.areas.length);
    expect(state().selectedArea).toBeNull(); // several areas: no single one

    state().startLasso(near(4)[0] as Point);
    expect(state().mode).toMatchObject({ kind: "lasso", operation: "add" }); // with a selection, a lasso adds
    state().setLassoOperation("remove");
    for (const corner of near(4).slice(1)) state().addLassoPoint(corner);
    state().closeLasso();
    expect(state().selection).not.toContain(4);
    expect(state().selection.length).toBe(data.areas.length - 1);

    state().selectArea(7); // a plain tap goes back to one area
    expect(state()).toMatchObject({ selection: [7], selectedArea: 7 });
    state().startLasso(near(9)[0] as Point);
    expect(state().mode).toMatchObject({ operation: "replace" });
    for (const corner of near(9).slice(1)) state().addLassoPoint(corner);
    state().closeLasso();
    expect(state()).toMatchObject({ selection: [9], selectedArea: 9 });

    state().startLasso({ x: 0, y: 0 });
    state().addLassoPoint({ x: 1, y: 1 });
    state().closeLasso(); // two corners: cancelled
    expect(state()).toMatchObject({ mode: { kind: "select" }, selection: [9] });
  });

  it("adds and removes single areas with Shift-click, and keeps the selection through a double tap", () => {
    const { state } = setup();
    state().clickArea(2);
    state().clickArea(3, true);
    state().clickArea(5, true);
    expect(state().selection).toEqual([2, 3, 5]);
    state().clickArea(3, true);
    expect(state().selection).toEqual([2, 5]);
    // A double tap's first tap selects one area; the lasso it starts keeps the selection from before.
    state().clickArea(8);
    state().startLasso({ x: 0, y: 0 });
    expect(state().selection).toEqual([2, 5]);
    expect(state().mode).toMatchObject({ operation: "add" });
  });
});

describe("double taps on water", () => {
  it("start a lasso from the selection as it was, not an older one", () => {
    const { state } = setup();
    state().selectAreas([1, 2, 3]);
    state().clickArea(4); // back to one area
    state().clickArea(null); // the double tap's first tap lands on water
    state().startLasso({ x: 0, y: 0 });
    expect(state().selection).toEqual([4]);
    expect(state().mode).toMatchObject({ operation: "replace" });
  });
});
