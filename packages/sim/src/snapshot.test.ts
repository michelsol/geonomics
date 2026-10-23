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
import { lastMigration } from "./tick/population";
import { runTick } from "./tick/tick";
import { lastTradeFlows, lastTradeTonnage } from "./tick/trade";

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
    expect(snapshot.government?.soldierWage).toBe(world.config.military.soldierWage);
  });

  it("show militia, natural capacity and its maximum", () => {
    const world = realmWorld();
    const neutral = world.areas[3] as (typeof world.areas)[number];
    world.governments[1]?.ownedAreas.splice(0); // a neutral March without going through a capture
    neutral.owner = null;
    neutral.militia = 200;
    neutral.naturalCapacity[0] = 1;
    const snapshot = buildSnapshot(world, 0);
    expect(Array.from(snapshot.areas.militia)).toEqual(world.areas.map((area) => Math.fround(area.militia)));
    expect(snapshot.areas.militia[0]).toBeGreaterThan(0); // owned areas have a militia too
    const goods = world.goods.length;
    const table = buildStaticData(world).naturalCapacityMaximum;
    expect(table.length).toBe(4 * goods);
    expect(table[3 * goods]).toBeCloseTo(neutral.naturalCapacityMaximum[0] as number, 1);
    expect(snapshot.detail.find((d) => d.area === 3)?.naturalCapacity[0]).toBe(1);
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
    // Areas, edges (transport cost, capacity, flags, tonnage, migration), area details, area states.
    expect(buffers.length).toBe(11 + 5 + 4 * 8 + 3 * 7);
    expect(snapshotTransferables(buildSnapshot(realmWorld(), 0, undefined, { flowGood: 0 })).length).toBe(
      buffers.length + 1,
    );
  });

  it("carry the last tick's migration and trade per edge and day", () => {
    const world = realmWorld({ pace: { gameDaysPerTick: 0.5 } });
    // The Valley loses its primary goods and its stock: it imports, and people leave for better-supplied areas.
    const valley = world.areas[1] as (typeof world.areas)[number];
    valley.naturalCapacity.fill(0);
    valley.naturalCapacityMaximum.fill(0);
    valley.stock.fill(0);
    for (let i = 0; i < 20; i++) runTick(world);
    const flows = lastTradeFlows(world);
    expect(flows.length).toBeGreaterThan(0);
    const good = (flows[0] as (typeof flows)[number]).good;
    const snapshot = buildSnapshot(world, null, undefined, { flowGood: good });
    const migration = lastMigration(world);
    const tonnage = lastTradeTonnage(world);
    expect(Array.from(migration).some((v) => v !== 0)).toBe(true);
    for (let e = 0; e < world.edges.length; e++) {
      expect(snapshot.edges.migration[e]).toBeCloseTo((migration[e] as number) / 0.5, 3);
      expect(snapshot.edges.tonnage[2 * e]).toBeCloseTo((tonnage[2 * e] as number) / 0.5, 3);
      expect(snapshot.edges.tonnage[2 * e + 1]).toBeCloseTo((tonnage[2 * e + 1] as number) / 0.5, 3);
    }
    const expected = new Float64Array(2 * world.edges.length);
    for (const flow of flows) {
      if (flow.good !== good) continue;
      const slot = 2 * flow.edge + (world.edges[flow.edge]?.areaA === flow.seller ? 0 : 1);
      expected[slot] = (expected[slot] as number) + flow.quantity / 0.5;
    }
    expect(Array.from(snapshot.edges.goodFlow ?? []).map((v) => Math.round(v * 1000))).toEqual(
      Array.from(expected).map((v) => Math.round(Math.fround(v) * 1000)),
    );
    expect(buildSnapshot(world, null).edges.goodFlow).toBeNull();
    expect(buildSnapshot(world, null, undefined, { flowGood: 99 }).edges.goodFlow).toBeNull();
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
