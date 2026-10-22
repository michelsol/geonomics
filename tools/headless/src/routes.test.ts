// Roadmap stage 4: distant markets connect through sea and air routes.
import {
  type DeepPartial,
  lastTradeFlows,
  lastTradeTonnage,
  runTick,
  type World,
  type WorldConfig,
} from "@geonomics/sim";
import { describe, expect, it } from "vitest";
import { CATALOG_NAMES, type CatalogName, readCatalog } from "./catalogs";
import { ISLAND_ROUTE_EDGE, scenarios } from "./scenarios";

/** Runs an island scenario for a year and totals, per good key, the units carried over the route between islands. */
function islandTraffic(
  scenario: "islands" | "islandsByAir",
  catalog: CatalogName,
  config?: DeepPartial<WorldConfig>,
  everyTick?: (world: World) => void,
) {
  const world = scenarios[scenario].build({ catalog: readCatalog(catalog), config });
  const carried = new Map<string, number>();
  for (let i = 0; i < 365; i++) {
    runTick(world);
    everyTick?.(world);
    for (const flow of lastTradeFlows(world)) {
      if (flow.edge !== ISLAND_ROUTE_EDGE) continue;
      const key = world.goods[flow.good]?.key as string;
      carried.set(key, (carried.get(key) ?? 0) + flow.quantity);
    }
  }
  return { world, carried: (key: string) => carried.get(key) ?? 0, goodsCarried: carried.size };
}

describe.each(CATALOG_NAMES)("with the %s catalog", (catalog) => {
  it("carries bulk goods between islands by sea", () => {
    const { world, carried } = islandTraffic("islands", catalog);
    expect(world.edges[ISLAND_ROUTE_EDGE]?.mode).toBe("sea");
    // Grain grows only on the west island; the east island bakes with grain shipped over.
    expect(carried("grain")).toBeGreaterThan(100 * 365);
    for (const key of ["coal", "timber", "stone_sand"]) {
      if (world.goods.some((g) => g.key === key)) expect(carried(key), key).toBeGreaterThan(0);
    }
  });

  it("flies light, valuable goods and leaves grain and stone at home", () => {
    const { world, carried, goodsCarried } = islandTraffic("islandsByAir", catalog);
    expect(world.edges[ISLAND_ROUTE_EDGE]?.mode).toBe("air");
    expect(goodsCarried).toBeGreaterThanOrEqual(3);
    for (const key of ["grain", "stone_sand", "coal", "timber"]) expect(carried(key), key).toBe(0);
    const light = world.goods.filter((g) => g.laborValue / g.transportWeight > 100).map((g) => g.key);
    expect(light.some((key) => carried(key) > 0)).toBe(true);
  });

  it("never exceeds a route's capacity", () => {
    const check = (world: World) => {
      const tonnage = lastTradeTonnage(world);
      for (const edge of world.edges) {
        const limit = edge.capacityPerDay * world.config.pace.gameDaysPerTick * (1 + 1e-9);
        expect(tonnage[2 * edge.id]).toBeLessThanOrEqual(limit);
        expect(tonnage[2 * edge.id + 1]).toBeLessThanOrEqual(limit);
      }
    };
    let binding = 0;
    const countBinding = (world: World) => {
      check(world);
      const edge = world.edges[ISLAND_ROUTE_EDGE] as World["edges"][number];
      const tonnage = lastTradeTonnage(world);
      if (Math.max(tonnage[2 * edge.id] as number, tonnage[2 * edge.id + 1] as number) > 0.99 * edge.capacityPerDay) {
        binding++;
      }
    };
    islandTraffic("islandsByAir", catalog, undefined, countBinding);
    islandTraffic("islands", catalog, { transport: { seaCapacityPerPortLevel: 20 } }, countBinding);
    expect(binding).toBeGreaterThan(100); // the limit actually binds, so the check means something
  });
});
