// Roadmap stage 9 exit: a full snapshot plus the price table stay under 300 KB on the wire.
import {
  buildSnapshot,
  createConfig,
  encodePriceTable,
  foundGovernments,
  generateMap,
  initializeWorld,
  loadCatalog,
  warmUp,
} from "@geonomics/sim";
import { describe, expect, it } from "vitest";
import large from "../../../data/goods/large.json";
import { DetailRotation } from "./detail";
import { pack } from "./frames";

const BUDGET = 300 * 1024;

describe("message sizes", () => {
  it("keep a snapshot plus the price table under 300 KB on the default map with the large catalog", async () => {
    const catalog = loadCatalog(large);
    const config = createConfig(catalog, { map: { landAreaCount: 1000, governmentCount: 8 } });
    const { world, capitals } = generateMap(catalog, config, 1);
    initializeWorld(world);
    foundGovernments(world, capitals);
    warmUp(world, 20);
    const largest = world.governments.reduce((a, b) => (b.ownedAreas.length > a.ownedAreas.length ? b : a));
    const kb = (bytes: number) => `${(bytes / 1024).toFixed(0)} KB`;

    const table = (await pack({ type: "priceTable", tick: 0, gameDay: 0, table: encodePriceTable(world) })).byteLength;
    const rotation = new DetailRotation();
    rotation.focus = largest.capital;
    let player = 0;
    for (let i = 0; i < 6; i++) {
      const snapshot = buildSnapshot(world, largest.id, undefined, { detailAreas: rotation.pick });
      player = Math.max(player, (await pack({ type: "snapshot", snapshot })).byteLength);
    }
    const spectator = (await pack({ type: "snapshot", snapshot: buildSnapshot(world, null) })).byteLength;
    const everything = (await pack({ type: "snapshot", snapshot: buildSnapshot(world, largest.id) })).byteLength;
    console.log(
      `1,000 areas, large catalog, largest realm of ${largest.ownedAreas.length} areas: snapshot ${kb(player)}` +
        ` (${kb(everything)} with every area's detail), spectator ${kb(spectator)}, price table ${kb(table)}`,
    );
    expect(player + table).toBeLessThan(BUDGET);
    expect(spectator + table).toBeLessThan(BUDGET);
  }, 120_000);
});
