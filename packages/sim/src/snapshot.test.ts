import { describe, expect, it } from "vitest";
import {
  buildSnapshot,
  buildStaticData,
  decodePrice,
  EDGE_BLOCKED,
  encodePriceTable,
  snapshotTransferables,
} from "./snapshot";
import { realmWorld, send } from "./testing";
import { runTick } from "./tick/tick";

describe("snapshots", () => {
  it("send stocks and flows only for the viewer's areas and their neighbors", () => {
    const world = realmWorld();
    runTick(world);
    const asWest = buildSnapshot(world, 0);
    expect(asWest.detail.map((d) => d.area)).toEqual([0, 1, 2, 3]); // the March borders the Valley
    const asEast = buildSnapshot(world, 1);
    expect(asEast.detail.map((d) => d.area)).toEqual([1, 3]);
    expect(buildSnapshot(world, null).detail).toEqual([]);
    expect(asEast.detail[1]?.stock[0]).toBeCloseTo(world.areas[3]?.stock[0] as number, 1);
  });

  it("carry the viewer's full government and a summary of the others", () => {
    const world = realmWorld();
    send(world, { type: "setRealmPolicy", setting: { policy: "headTaxPerPersonPerDay", good: null, value: 0.2 } });
    const snapshot = buildSnapshot(world, 0);
    expect(snapshot.government?.id).toBe(0);
    expect(snapshot.government?.areaStates.map((s) => s.area)).toEqual([0, 1, 2]);
    expect(snapshot.government?.areaStates[0]?.resolved.headTaxPerPersonPerDay).toBe(0.2);
    expect(snapshot.governments[1]).toMatchObject({ id: 1, areaCount: 1, capital: 3, isEliminated: false });
    expect(snapshot.governments[1]).not.toHaveProperty("treasury");
    expect(Array.from(snapshot.areas.owner)).toEqual([0, 0, 0, 1]);
  });

  it("report edge state and edges created since the receiver last knew", () => {
    const world = realmWorld();
    const known = buildStaticData(world).edges.length;
    (world.edges[1] as (typeof world.edges)[number]).isBlocked = true;
    (world.areas[1] as (typeof world.areas)[number]).airportProgress = world.config.transport.airportWorkerDaysPerLevel;
    runTick(world); // the new airport makes air routes
    const snapshot = buildSnapshot(world, 0, known);
    expect(snapshot.newEdges.length).toBeGreaterThan(0);
    expect(snapshot.newEdges.length).toBe(world.edges.length - known);
    expect(snapshot.newEdges.every((edge) => edge.mode === "air")).toBe(true);
    expect((snapshot.edges.flags[1] as number) & EDGE_BLOCKED).toBe(0); // recomputed by the tick: no war
  });

  it("lists every typed-array buffer for transfer, once each", () => {
    const snapshot = buildSnapshot(realmWorld(), 0);
    const buffers = snapshotTransferables(snapshot);
    expect(new Set(buffers).size).toBe(buffers.length);
    expect(buffers.length).toBe(10 + 3 + 4 * 7 + 3 * 7);
  });
});

describe("price table", () => {
  it("round-trips prices within 0.01% and clamps to the bounds", () => {
    const world = realmWorld();
    const area = world.areas[0] as (typeof world.areas)[number];
    area.price[0] = (world.goods[0]?.laborValue as number) * 1.2345;
    area.price[1] = (world.goods[1]?.laborValue as number) * 100;
    const table = encodePriceTable(world);
    expect(table.length).toBe(world.areas.length * world.goods.length);
    const goods = world.goods.length;
    for (const a of world.areas) {
      for (const good of world.goods) {
        const decoded = decodePrice(table[a.id * goods + good.id] as number, good.laborValue, world.config);
        if (a.id === 0 && good.id === 1) continue;
        expect(Math.abs(decoded / (a.price[good.id] as number) - 1)).toBeLessThan(1e-4);
      }
    }
    expect(table[1]).toBe(65535);
    expect(decodePrice(65535, 2, world.config)).toBeCloseTo(2 * world.config.economy.priceCeilingMultiple, 9);
  });
});
