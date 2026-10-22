// Hand-built worlds for convergence checks before map generation exists (roadmap stage 2). Every scenario works
// with any catalog: primary goods are spread generically and capacities are sized from the reference demand.
import {
  type AreaSpec,
  type Catalog,
  createConfig,
  createWorld,
  type DeepPartial,
  type EdgeSpec,
  initializeWorld,
  nextRandom,
  referenceDemandPerPerson,
  type World,
  type WorldConfig,
} from "@geonomics/sim";

export interface ScenarioOptions {
  catalog: Catalog;
  seed?: number;
  config?: DeepPartial<WorldConfig>;
}

export interface Scenario {
  description: string;
  build(options: ScenarioOptions): World;
}

/** Natural capacity is this many times the demand it has to serve, so extraction stays well short of saturation. */
const CAPACITY_HEADROOM = 2;
const POPULATION = 10_000;
const SPACING = 100; // map units (km) between neighboring areas

function build(options: ScenarioOptions, areas: AreaSpec[], edges: EdgeSpec[], shape?: (world: World) => void): World {
  const config = createConfig(options.catalog, options.config);
  const world = createWorld(options.catalog, config, { areas, edges, seed: options.seed ?? 1 });
  shape?.(world);
  initializeWorld(world);
  return world;
}

function primaryGoods(world: World) {
  return world.goods.filter((good) => good.isPrimary);
}

function totalPopulation(world: World): number {
  return world.areas.reduce((sum, area) => sum + area.population, 0);
}

/** Gives each listed area a share of the world's demand for a primary good, in proportion to its weight. */
function spreadCapacity(world: World, good: number, weights: Map<number, number>): void {
  const demand = (referenceDemandPerPerson(world)[good] as number) * totalPopulation(world);
  let weightSum = 0;
  for (const weight of weights.values()) weightSum += weight;
  for (const [area, weight] of weights) {
    const target = world.areas[area];
    if (!target || weight <= 0) continue;
    const capacity = (CAPACITY_HEADROOM * demand * weight) / weightSum;
    target.naturalCapacity[good] = capacity;
    target.naturalCapacityMaximum[good] = capacity;
  }
}

function line(count: number, name: (i: number) => string, x0 = 0): AreaSpec[] {
  return Array.from({ length: count }, (_, i) => ({
    name: name(i),
    position: { x: x0 + i * SPACING, y: 0 },
    population: POPULATION,
  }));
}

function landChain(from: number, count: number): EdgeSpec[] {
  return Array.from({ length: count - 1 }, (_, i) => ({ a: from + i, b: from + i + 1, mode: "land" as const }));
}

export const scenarios = {
  twoAreas: {
    description: "Two neighbors with complementary resources: primary goods alternate between them",
    build: (options) =>
      build(
        options,
        line(2, (i) => (i === 0 ? "West" : "East")),
        landChain(0, 2),
        (world) => {
          for (const [k, good] of primaryGoods(world).entries()) spreadCapacity(world, good.id, new Map([[k % 2, 1]]));
        },
      ),
  },

  chain10: {
    description: "Ten areas in a line; each primary good is richest at one end and absent at the other",
    build: (options) =>
      build(
        options,
        line(10, (i) => `Chain ${i}`),
        landChain(0, 10),
        (world) => {
          for (const [k, good] of primaryGoods(world).entries()) {
            const weights = new Map<number, number>();
            for (let i = 0; i < 10; i++) weights.set(i, (9 - (k % 2 === 0 ? i : 9 - i)) / 9);
            spreadCapacity(world, good.id, weights);
          }
        },
      ),
  },

  islands: {
    description: "Two islands of three areas joined only by a 500 km sea route between their ports",
    build: (options) => buildIslands(options, "sea"),
  },

  islandsByAir: {
    description:
      "The same two islands joined only by an air route: light goods fly, bulk goods such as building materials cannot",
    build: (options) => buildIslands(options, "air"),
  },

  grid100: {
    description: "A 10 × 10 land grid with seeded random populations, productivity and resources",
    build: (options) => {
      const areas: AreaSpec[] = [];
      const edges: EdgeSpec[] = [];
      for (let y = 0; y < 10; y++) {
        for (let x = 0; x < 10; x++) {
          const id = y * 10 + x;
          areas.push({ name: `Grid ${x},${y}`, position: { x: x * SPACING, y: y * SPACING } });
          if (x > 0) edges.push({ a: id - 1, b: id, mode: "land" });
          if (y > 0) edges.push({ a: id - 10, b: id, mode: "land" });
        }
      }
      return build(options, areas, edges, (world) => {
        for (const area of world.areas) {
          area.population = POPULATION * (0.5 + nextRandom(world));
          area.productivity = 0.8 + 0.4 * nextRandom(world);
        }
        const presence = { common: 0.8, regional: 0.4, rare: 0.15 };
        for (const good of primaryGoods(world)) {
          const weights = new Map<number, number>();
          for (const area of world.areas) {
            if (nextRandom(world) < presence[good.abundance ?? "common"]) weights.set(area.id, 0.5 + nextRandom(world));
          }
          if (weights.size === 0) weights.set(Math.floor(nextRandom(world) * world.areas.length), 1);
          spreadCapacity(world, good.id, weights);
        }
      });
    },
  },
} satisfies Record<string, Scenario>;

export type ScenarioName = keyof typeof scenarios;
export const SCENARIO_NAMES = Object.keys(scenarios) as ScenarioName[];

/** West island holds the even primary goods (grain first, so the bulk staple), East island the odd ones. */
function buildIslands(options: ScenarioOptions, mode: "sea" | "air"): World {
  const west = line(3, (i) => `West ${i}`);
  const east = line(3, (i) => `East ${i}`, 2 * SPACING + 500);
  const coastWest = west[2] as AreaSpec;
  const coastEast = east[0] as AreaSpec;
  for (const coast of [coastWest, coastEast]) {
    coast.isCoastal = true;
    coast.portLevel = mode === "sea" ? 1 : 0;
    coast.airportLevel = mode === "air" ? 1 : 0;
  }
  const edges: EdgeSpec[] = [...landChain(0, 3), ...landChain(3, 3), { a: 2, b: 3, mode, distance: 500 }];
  return build(options, [...west, ...east], edges, (world) => {
    for (const [k, good] of primaryGoods(world).entries()) {
      const island = k % 2 === 0 ? [0, 1, 2] : [3, 4, 5];
      spreadCapacity(world, good.id, new Map(island.map((area) => [area, 1])));
    }
  });
}

/** The edge joining the two islands. */
export const ISLAND_ROUTE_EDGE = 4;
