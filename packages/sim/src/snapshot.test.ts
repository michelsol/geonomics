import { describe, expect, it } from "vitest";
import { neutralPolicies, resolveSettings } from "./government";
import {
  buildSnapshot,
  buildStaticData,
  decodePrice,
  EDGE_BLOCKED,
  encodePriceTable,
  snapshotTransferables,
} from "./snapshot";
import { realmWorld, send } from "./testing";
import { lastMigration, lastNaturalChange } from "./tick/population";
import { runTick } from "./tick/tick";
import { lastTradeFlows, lastTradeTonnage } from "./tick/trade";
import { addEdge } from "./world";

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
    // The settings travel, not their resolution: the receiver resolves them as the host does.
    const state = snapshot.government?.areaStates[0];
    const resolved = neutralPolicies(world.goods.length);
    resolveSettings(resolved, snapshot.government?.realmPolicies ?? [], state?.policyOverrides ?? []);
    expect(resolved.headTaxPerPersonPerDay).toBe(0.2);
    expect(state).not.toHaveProperty("resolved");
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
    // Areas, edges (transport cost, capacity, flags, tonnage, migration), area details, depots.
    expect(buffers.length).toBe(15 + 5 + 4 * 11 + 3);
    expect(snapshotTransferables(buildSnapshot(realmWorld(), 0, undefined, { flowGood: 0 })).length).toBe(
      buffers.length + 1,
    );
  });

  it("list the visible areas, and send the detail of those the options pick", () => {
    const world = realmWorld();
    const full = buildSnapshot(world, 0);
    expect(full.visibleAreas).toEqual([0, 1, 2, 3]);
    expect(full.detail.map((d) => d.area)).toEqual([0, 1, 2, 3]);
    const some = buildSnapshot(world, 0, undefined, { detailAreas: (visible) => visible.slice(1, 3) });
    expect(some.visibleAreas).toEqual([0, 1, 2, 3]);
    expect(some.detail.map((d) => d.area)).toEqual([1, 2]);
    expect(buildSnapshot(world, null).visibleAreas).toEqual([]);
  });

  it("carry each area's growth or starvation per day, which with migration makes up its change", () => {
    const world = realmWorld({ pace: { gameDaysPerTick: 0.5 } });
    const valley = world.areas[1] as (typeof world.areas)[number];
    valley.naturalCapacity.fill(0);
    valley.naturalCapacityMaximum.fill(0);
    valley.stock.fill(0);
    for (let i = 0; i < 20; i++) runTick(world);
    const before = world.areas.map((area) => area.population);
    runTick(world);
    const snapshot = buildSnapshot(world, 0);
    const migration = lastMigration(world);
    const natural = lastNaturalChange(world);
    for (const area of world.areas) {
      let migrants = 0;
      for (const edge of world.edges) {
        if (edge.areaA === area.id) migrants -= migration[edge.id] as number;
        if (edge.areaB === area.id) migrants += migration[edge.id] as number;
      }
      expect(area.population - (before[area.id] as number)).toBeCloseTo((natural[area.id] as number) + migrants, 6);
      expect(snapshot.areas.naturalChange[area.id]).toBeCloseTo((natural[area.id] as number) / 0.5, 2);
    }
    expect(snapshot.areas.naturalChange[1]).toBeLessThan(0); // the Valley starves
  });

  it("keep the last tick's flows when an air route opens after them", () => {
    const world = realmWorld({ pace: { gameDaysPerTick: 0.5 } });
    const valley = world.areas[1] as (typeof world.areas)[number];
    valley.naturalCapacity.fill(0);
    valley.naturalCapacityMaximum.fill(0);
    valley.stock.fill(0);
    for (let i = 0; i < 20; i++) runTick(world);
    const before = buildSnapshot(world, 0);
    addEdge(world, { a: 0, b: 3, mode: "air" }); // as the jobs phase does when an airport is built
    const after = buildSnapshot(world, 0);
    expect(Array.from(after.edges.migration.subarray(0, before.edges.migration.length))).toEqual(
      Array.from(before.edges.migration),
    );
    expect(Array.from(after.areas.naturalChange)).toEqual(Array.from(before.areas.naturalChange));
    expect(Array.from(before.edges.migration).some((v) => v !== 0)).toBe(true);
  });

  it("carry each area's employment rate: the workforce share with a job", () => {
    const world = realmWorld();
    const area = world.areas[0] as (typeof world.areas)[number];
    area.unemployedWorkers = 0.25 * area.population * world.config.economy.workforceShare;
    const empty = world.areas[1] as (typeof world.areas)[number];
    empty.population = 0;
    const snapshot = buildSnapshot(world, null);
    expect(snapshot.areas.employmentRate[0]).toBeCloseTo(0.75, 6);
    expect(snapshot.areas.employmentRate[1]).toBeNaN();
  });

  it("carry each area's gross and net income per member of the workforce, and the wage of each private job", () => {
    const world = realmWorld();
    send(world, { type: "setJobTarget", area: 0, job: { kind: "fortify" }, targetWorkers: 50 });
    runTick(world);
    const { hoursPerWorkerDay, workforceShare } = world.config.economy;
    const area = world.areas[0] as (typeof world.areas)[number];
    const state = world.governments[0]?.areaStates.get(0);
    const governmentWorkers = (state?.jobs ?? []).reduce((sum, job) => sum + job.workers, 0);
    expect(governmentWorkers).toBeGreaterThan(0);
    const snapshot = buildSnapshot(world, 0);
    const detail = snapshot.detail[0];
    const workforce = area.population * workforceShare;
    let earned = 0;
    let workers = 0;
    for (const good of world.goods) {
      earned += (area.privateWorkers[good.id] as number) * (detail?.wage[good.id] as number);
      workers += area.privateWorkers[good.id] as number;
    }
    // Without taxes, gross and net income are the same: private wages and government wages over the workforce.
    const governmentPay = governmentWorkers * (state?.wageOffer ?? 0) * hoursPerWorkerDay;
    expect(snapshot.areas.grossIncome[0]).toBeCloseTo((earned + governmentPay) / workforce, 3);
    expect(snapshot.areas.netIncome[0]).toBeCloseTo(snapshot.areas.grossIncome[0] as number, 5);
    // The wage level is the private wages' mean, per hour, from before the tick's last moves between jobs.
    expect(earned / workers / hoursPerWorkerDay).toBeCloseTo(area.wageLevel, 2);

    // A head tax comes off net income, spread over the workforce; an allowance adds to it.
    send(world, { type: "setRealmPolicy", setting: { policy: "headTaxPerPersonPerDay", good: null, value: 0.2 } });
    const taxed = buildSnapshot(world, 0);
    expect(taxed.areas.grossIncome[0]).toBeCloseTo(snapshot.areas.grossIncome[0] as number, 5);
    expect(taxed.areas.netIncome[0]).toBeCloseTo((snapshot.areas.netIncome[0] as number) - 0.2 / workforceShare, 3);
    send(world, { type: "setRealmPolicy", setting: { policy: "headTaxPerPersonPerDay", good: null, value: -0.2 } });
    expect(buildSnapshot(world, 0).areas.netIncome[0]).toBeCloseTo(
      (snapshot.areas.netIncome[0] as number) + 0.2 / workforceShare,
      3,
    );

    (world.areas[1] as (typeof world.areas)[number]).population = 0;
    expect(buildSnapshot(world, 0).areas.grossIncome[1]).toBeNaN();
  });

  it("carry each visible area's demand and consumption per need", () => {
    const world = realmWorld();
    runTick(world);
    const detail = buildSnapshot(world, 0).detail[0];
    const area = world.areas[0] as (typeof world.areas)[number];
    expect(detail?.needDemanded.length).toBe(world.needs.length);
    expect(detail?.needDemanded[0]).toBeCloseTo(area.needDemanded[0] as number, 3);
    expect(detail?.needConsumed[0]).toBeCloseTo(area.needConsumed[0] as number, 3);
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
