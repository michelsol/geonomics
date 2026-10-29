// Map generation (specification §4, Map generation): Voronoi cells on a sphere, elevation and moisture from noise,
// terrain, coasts, water cells, population, resources on land and at sea, land edges, sea lanes and capital positions.
import { createNoise3D, type NoiseFunction3D } from "simplex-noise";
import type { Catalog } from "./catalog";
import type { WorldConfig } from "./config";
import { MinHeap } from "./heap";
import { referenceDemandPerPerson } from "./init";
import { nextRandom, seedFrom } from "./random";
import { LAND_DISTANCE_PER_TRAVEL_DAY } from "./routes";
import { arcDistance, fibonacciSphere, sphericalMean, sphericalVoronoi } from "./sphere";
import type { AreaId, Point3, Terrain, World } from "./types";
import { type AreaSpec, addEdge, createEmptyWorld, createWaterCell, createWorld, setWaterDepths } from "./world";

/** Productivity and land transport cost multiplier of each terrain. */
export const TERRAIN_EFFECTS: Record<Terrain, { productivity: number; landCost: number; density: number }> = {
  plains: { productivity: 1, landCost: 1, density: 1.2 },
  forest: { productivity: 0.9, landCost: 1.5, density: 0.8 },
  hills: { productivity: 0.9, landCost: 2, density: 0.7 },
  mountains: { productivity: 0.7, landCost: 4, density: 0.3 },
  desert: { productivity: 0.8, landCost: 1.5, density: 0.35 },
};

const LLOYD_ITERATIONS = 2;
const JITTER = 0.5; // of the mean cell spacing, before relaxation
const CONTINENT_WEIGHT = 0.8; // weight of the low-frequency noise that gathers land into a few continents
const COASTAL_DENSITY_BONUS = 1.3;
const SYLLABLES = ["ka", "lo", "mi", "ra", "ten", "sor", "vel", "an", "dor", "is", "ul", "ber", "to", "na", "vi"];
const SYLLABLES_END = ["gar", "el", "mon", "ia", "ost", "una", "ard", "en", "ix", "or", "eth", "ana", "us", "ir"];

export interface GeneratedMap {
  world: World; // neutral world, not yet initialized (call initializeWorld, then warmUp)
  capitals: AreaId[]; // spread-out, populous areas for the players' starting capitals
}

/** Generates a map with config.map.landAreaCount areas. The same catalog, config and seed give the same map. */
export function generateMap(catalog: Catalog, config: WorldConfig, seed: number): GeneratedMap {
  const m = config.map;
  const rng = { randomSeed: seedFrom(seed) };
  const random = () => nextRandom(rng);
  const noise = (): NoiseFunction3D => createNoise3D(random);

  // 1. Cells: points spread over a sphere whose surface holds every cell at about cellSpacing apart, jittered, then
  // relaxed toward even spacing.
  const count = Math.max(12, Math.round(m.landAreaCount / m.landShare));
  const s = m.cellSpacing;
  const radius = s * Math.sqrt(count / (4 * Math.PI));
  let points: Point3[] = fibonacciSphere(count, radius, JITTER, random);
  for (let iteration = 0; iteration < LLOYD_ITERATIONS; iteration++) {
    const cells = sphericalVoronoi(points, radius);
    points = points.map((p, i) => {
      const polygon = cells.polygons[i] as Point3[];
      return polygon.length >= 3 ? sphericalMean(polygon, radius) : p;
    });
  }
  const neighbors = sphericalVoronoi(points, radius).neighbors;
  const at = (i: number) => points[i] as Point3;
  const distance = (i: number, j: number) => arcDistance(radius, at(i), at(j));
  /** Fractal noise at a point of the sphere, `scale` km per noise unit. */
  const sample = (field: NoiseFunction3D, i: number | Point3, scale: number, octaves = 1, offset = 0) => {
    const p = typeof i === "number" ? at(i) : i;
    return fractal(field, p.x / scale + offset, p.y / scale + offset, p.z / scale + offset, octaves);
  };

  // 2. Elevation: fractal noise plus a broad continent field; sea level gives the land share.
  const featureScale = Math.sqrt(4 * Math.PI * radius * radius) / 4;
  const elevationNoise = noise();
  const continentNoise = noise();
  const elevation = new Float64Array(count);
  const relief = new Float64Array(count); // the fractal noise alone: ranks hills and mountains
  for (let i = 0; i < count; i++) {
    relief[i] = sample(elevationNoise, i, featureScale, m.elevationOctaves);
    elevation[i] = (relief[i] as number) + CONTINENT_WEIGHT * sample(continentNoise, i, 2 * featureScale, 2);
  }
  const land = new Uint8Array(count);
  const classify = (share: number): number => {
    const seaLevel = quantile(elevation, 1 - share);
    for (let i = 0; i < count; i++) land[i] = (elevation[i] as number) > seaLevel ? 1 : 0;
    // No lakes: water apart from the world ocean, the largest body of water, becomes land. Islands too small to matter
    // sink.
    const waters = components(count, neighbors, (i) => !land[i]).sort((a, b) => b.length - a.length);
    for (const component of waters.slice(1)) for (const i of component) land[i] = 1;
    for (const component of components(count, neighbors, (i) => land[i] === 1)) {
      if (component.length < m.minimumIslandAreas) for (const i of component) land[i] = 0;
    }
    return land.reduce((sum, value) => sum + value, 0);
  };
  // Filling lakes and sinking islets moves the land count, so the sea level is corrected a few times.
  let share = m.landShare;
  for (let attempt = 0; attempt < 4; attempt++) {
    const landCount = classify(share);
    if (Math.abs(landCount - m.landAreaCount) <= 0.01 * m.landAreaCount) break;
    share = Math.min(0.95, (share * m.landAreaCount) / Math.max(landCount, 1));
    if (attempt === 3) classify(share);
  }

  // 3. Terrain from elevation rank among land cells and moisture.
  const landCells: number[] = [];
  for (let i = 0; i < count; i++) if (land[i]) landCells.push(i);
  const byElevation = [...landCells].sort((a, b) => (relief[a] as number) - (relief[b] as number) || a - b);
  const elevationRank = new Float64Array(count);
  for (const [rank, i] of byElevation.entries()) elevationRank[i] = rank / Math.max(byElevation.length - 1, 1);
  const moistureNoise = noise();
  const terrainOf = (i: number): Terrain => {
    const rank = elevationRank[i] as number;
    if (rank >= 0.85) return "mountains";
    if (rank >= 0.65) return "hills";
    const moisture = sample(moistureNoise, i, featureScale, 3);
    if (moisture < -0.3) return "desert";
    if (moisture > 0.2) return "forest";
    return "plains";
  };

  // 4–5. Areas: land cells in index order, with terrain, coast, population and productivity.
  const areaOf = new Int32Array(count).fill(-1);
  for (const [id, cell] of landCells.entries()) areaOf[cell] = id;
  const variation = noise();
  const terrains = landCells.map(terrainOf);
  const coastal = landCells.map((cell) => (neighbors[cell] as number[]).some((n) => !land[n]));
  const densities = landCells.map((cell, id) => {
    const local = 0.6 + 0.8 * (0.5 + 0.5 * sample(variation, cell, 2 * s));
    return TERRAIN_EFFECTS[terrains[id] as Terrain].density * (coastal[id] ? COASTAL_DENSITY_BONUS : 1) * local;
  });
  const meanDensity = densities.reduce((a, b) => a + b, 0) / Math.max(densities.length, 1);
  const areas: AreaSpec[] = landCells.map((cell, id) => {
    const terrain = terrains[id] as Terrain;
    const local = 0.5 + 0.5 * sample(variation, cell, 3 * s, 1, 100); // offset from the density sample
    return {
      name: areaName(random),
      position: at(cell),
      population: (m.meanAreaPopulation * (densities[id] as number)) / meanDensity,
      productivity: TERRAIN_EFFECTS[terrain].productivity * (0.9 + 0.2 * local),
      terrain,
      isCoastal: coastal[id] as boolean,
    };
  });

  const world = createWorld(catalog, config, { areas, edges: [], seed: rng.randomSeed });
  world.map = { radius };

  // Water cells: every cell that is not land, in cell order, with their water and land neighbors.
  const waterOf = new Int32Array(count).fill(-1);
  for (let cell = 0, next = 0; cell < count; cell++) if (!land[cell]) waterOf[cell] = next++;
  for (let cell = 0; cell < count; cell++) {
    const id = waterOf[cell] as number;
    if (id < 0) continue;
    const around = neighbors[cell] as number[];
    world.waters.push(
      createWaterCell(
        id,
        at(cell),
        around.filter((n) => land[n]).map((n) => areaOf[n] as number),
        around.filter((n) => !land[n]).map((n) => waterOf[n] as number),
        catalog.goods.length,
      ),
    );
  }
  setWaterDepths(world.waters);

  // 6. Land edges between neighboring land cells.
  const linked = new Set<string>();
  for (const cell of landCells) {
    for (const other of neighbors[cell] as number[]) {
      if (other <= cell || !land[other]) continue;
      const a = areaOf[cell] as number;
      const b = areaOf[other] as number;
      const terrainFactor =
        (TERRAIN_EFFECTS[terrains[a] as Terrain].landCost + TERRAIN_EFFECTS[terrains[b] as Terrain].landCost) / 2;
      const d = distance(cell, other);
      addEdge(world, {
        a,
        b,
        mode: "land",
        distance: d,
        terrainFactor,
        travelDays: (d / LAND_DISTANCE_PER_TRAVEL_DAY) * terrainFactor,
      });
      linked.add(pairKey(a, b));
    }
  }

  // 7. Sea lanes: each coastal area to its nearest coasts by distance over water, then enough lanes to join every
  // island. Sea routes between ports follow them once the realms have ports (rebuildSeaRoutes).
  const seaRoutes = new Map<string, { a: AreaId; b: AreaId; distance: number }>();
  for (const [id, cell] of landCells.entries()) {
    if (!coastal[id]) continue;
    const found = nearestByWater([cell], config.transport.seaRoutesPerPort, (other) => {
      const target = areaOf[other] as number;
      return target !== id && !linked.has(pairKey(id, target));
    });
    for (const route of found) {
      const b = areaOf[route.cell] as number;
      const key = pairKey(id, b);
      if (!seaRoutes.has(key)) seaRoutes.set(key, { a: Math.min(id, b), b: Math.max(id, b), distance: route.distance });
    }
  }
  for (const route of [...seaRoutes.values()].sort((p, q) => p.a - q.a || p.b - q.b)) {
    addEdge(world, { a: route.a, b: route.b, mode: "sea", distance: route.distance, lane: true });
  }
  joinIslands();

  // 8. Natural capacity of primary goods, placed by terrain and a noise field per good, on land areas and on the
  // water cells ports can reach. Every area holds at least one primary good, so none is left with nothing to work on
  // or to sell. A water cell has no people: it counts as a share of the population of the coast nearest to it.
  const demand = referenceDemandPerPerson(createEmptyWorld(catalog, config, 0));
  const totalPopulation = world.areas.reduce((sum, area) => sum + area.population, 0);
  const reachable = config.infrastructure.maximumLevel;
  const coastPopulation = nearestCoastPopulation(world);
  const sites = [
    ...world.areas.map((area) => ({ position: area.position, population: area.population })),
    ...world.waters.map((water) => ({
      position: water.position,
      population: m.waterCellPopulationShare * (coastPopulation[water.id] as number),
    })),
  ];
  const areaCount = world.areas.length;
  const primaries = world.goods.filter((good) => good.isPrimary);
  const suits = (good: World["goods"][number], site: number) => {
    if (site >= areaCount) {
      const depth = (world.waters[site - areaCount] as World["waters"][number]).depth;
      return good.terrains.some((t) =>
        t === "sea" ? depth <= reachable : t === "offshore" && depth >= 2 && depth <= reachable,
      );
    }
    const area = world.areas[site] as World["areas"][number];
    return (
      good.terrains.length === 0 || good.terrains.some((t) => (t === "coast" ? area.isCoastal : area.terrain === t))
    );
  };
  const scores = primaries.map(() => {
    const field = noise();
    return sites.map((site) => sample(field, site.position, featureScale));
  });
  const weights = primaries.map(() => new Float64Array(sites.length));
  for (const [k, good] of primaries.entries()) {
    const score = scores[k] as number[];
    let eligible = sites.map((_, site) => site).filter((site) => suits(good, site));
    if (eligible.length === 0) eligible = world.areas.map((area) => area.id);
    const ranked = eligible.sort((p, q) => (score[q] as number) - (score[p] as number) || p - q);
    // Enough producing places that their workforce could supply the world with extractionLaborShare of its labor.
    const laborShare =
      ((demand[good.id] as number) * good.laborHoursPerUnit) /
      (config.economy.hoursPerWorkerDay * config.economy.workforceShare);
    const neededPopulation = Math.min(1, laborShare / m.extractionLaborShare) * totalPopulation;
    const minimumCount = Math.max(1, Math.round(m.presence[good.abundance ?? "common"] * ranked.length));
    let count = 0;
    let population = 0;
    while (count < ranked.length && (count < minimumCount || population < neededPopulation)) {
      population += sites[ranked[count] as number]?.population as number;
      count++;
    }
    const chosen = ranked.slice(0, count);
    const cutoff = score[chosen[chosen.length - 1] as number] as number;
    for (const site of chosen) {
      (weights[k] as Float64Array)[site] =
        ((score[site] as number) - cutoff + 0.2) * (sites[site]?.population as number);
    }
  }
  for (const area of world.areas) {
    if (weights.some((w) => (w[area.id] as number) > 0)) continue;
    const candidates = primaries
      .map((good, k) => ({ good, k }))
      .filter(({ good }) => good.abundance === "common")
      .sort(
        (p, q) =>
          Number(suits(q.good, area.id)) - Number(suits(p.good, area.id)) ||
          ((scores[q.k] as number[])[area.id] as number) - ((scores[p.k] as number[])[area.id] as number) ||
          p.k - q.k,
      );
    const pick = candidates[0] ?? { k: 0 };
    (weights[pick.k] as Float64Array)[area.id] = 0.2 * area.population;
  }
  for (const [k, good] of primaries.entries()) {
    const w = weights[k] as Float64Array;
    const weightSum = w.reduce((a, b) => a + b, 0);
    const total = m.capacityHeadroom * (demand[good.id] as number) * totalPopulation;
    for (const [site, weight] of w.entries()) {
      const capacity = weightSum > 0 ? (total * weight) / weightSum : 0;
      const cell = site < areaCount ? world.areas[site] : world.waters[site - areaCount];
      if (!cell) continue;
      cell.naturalCapacity[good.id] = capacity;
      cell.naturalCapacityMaximum[good.id] = capacity;
    }
  }

  // 9. Capitals: the most populous area, then each next one far from the others and populous. An area no capital
  // reaches over land or sea counts as one hop beyond the farthest reachable area, so islands come early but are
  // still ranked by population.
  const capitals: AreaId[] = [];
  const hops = new Float64Array(world.areas.length).fill(Number.POSITIVE_INFINITY);
  for (let k = 0; k < Math.min(m.governmentCount, world.areas.length); k++) {
    let farthest = 0;
    for (const h of hops) if (Number.isFinite(h)) farthest = Math.max(farthest, h);
    let best = -1;
    let bestScore = -1;
    for (const area of world.areas) {
      if (capitals.includes(area.id)) continue;
      const h = hops[area.id] as number;
      const score = k === 0 ? area.population : (Number.isFinite(h) ? h : farthest + 1) * Math.sqrt(area.population);
      if (score > bestScore) {
        best = area.id;
        bestScore = score;
      }
    }
    capitals.push(best);
    updateHops(world, best, hops);
  }
  world.randomSeed = rng.randomSeed;
  return { world, capitals };

  /**
   * Bounded Dijkstra over water from start cells; returns the nearest accepted land cells by water distance, each
   * with the start cell its route leaves from.
   */
  function nearestByWater(starts: number[], wanted: number, accept: (cell: number) => boolean) {
    const best = new Map<number, { distance: number; from: number }>();
    const dist = new Float64Array(count).fill(Number.POSITIVE_INFINITY);
    const origin = new Int32Array(count);
    const heap = new MinHeap();
    for (const start of starts) {
      dist[start] = 0;
      origin[start] = start;
      heap.push(0, start);
    }
    let kth = Number.POSITIVE_INFINITY;
    while (heap.size > 0) {
      const [d, cell] = heap.pop();
      if (d > (dist[cell] as number) || d > kth) continue;
      for (const next of neighbors[cell] as number[]) {
        const nd = d + distance(cell, next);
        if (!land[next]) {
          if (nd < (dist[next] as number)) {
            dist[next] = nd;
            origin[next] = origin[cell] as number;
            heap.push(nd, next);
          }
        } else if (!land[cell] && accept(next) && nd < (best.get(next)?.distance ?? Number.POSITIVE_INFINITY)) {
          best.set(next, { distance: nd, from: origin[cell] as number });
          if (best.size >= wanted) {
            kth = [...best.values()].map((b) => b.distance).sort((a, b) => a - b)[wanted - 1] as number;
          }
        }
      }
    }
    return [...best.entries()]
      .map(([cell, route]) => ({ cell, distance: route.distance, from: route.from }))
      .sort((p, q) => p.distance - q.distance || p.cell - q.cell)
      .slice(0, wanted);
  }

  /** Adds the shortest sea route from the main landmass's group to the nearest other group until all are joined. */
  function joinIslands(): void {
    for (;;) {
      const group = groupOf(world);
      const main = group[0] as number;
      const starts = landCells.filter((_, id) => coastal[id] && group[id] === main);
      if (world.areas.every((area) => group[area.id] === main)) return;
      const [nearest] = nearestByWater(starts, 1, (cell) => group[areaOf[cell] as number] !== main);
      if (!nearest) throw new Error("Map generation: an island cannot be reached by sea");
      const from = areaOf[nearest.from] as number;
      const to = areaOf[nearest.cell] as number;
      addEdge(world, {
        a: Math.min(from, to),
        b: Math.max(from, to),
        mode: "sea",
        distance: nearest.distance,
        lane: true,
      });
    }
  }
}

/** Connected group of each area over active edges, numbered from the group of area 0. */
function groupOf(world: World): Int32Array {
  const group = new Int32Array(world.areas.length).fill(-1);
  let next = 0;
  for (const area of world.areas) {
    if (group[area.id] !== -1) continue;
    const stack = [area.id];
    group[area.id] = next;
    while (stack.length > 0) {
      const current = stack.pop() as number;
      for (const id of world.areas[current]?.edges ?? []) {
        const edge = world.edges[id];
        if (!edge?.isActive) continue;
        const other = edge.areaA === current ? edge.areaB : edge.areaA;
        if (group[other] === -1) {
          group[other] = next;
          stack.push(other);
        }
      }
    }
    next++;
  }
  return group;
}

/** Lowers each area's hop count to the nearest capital with a breadth-first search from a new capital. */
function updateHops(world: World, from: AreaId, hops: Float64Array): void {
  const distance = new Float64Array(world.areas.length).fill(Number.POSITIVE_INFINITY);
  distance[from] = 0;
  const queue = [from];
  for (let head = 0; head < queue.length; head++) {
    const current = queue[head] as number;
    for (const id of world.areas[current]?.edges ?? []) {
      const edge = world.edges[id];
      if (!edge?.isActive || edge.mode === "air") continue;
      const other = edge.areaA === current ? edge.areaB : edge.areaA;
      if (distance[other] === Number.POSITIVE_INFINITY) {
        distance[other] = (distance[current] as number) + 1;
        queue.push(other);
      }
    }
  }
  for (let i = 0; i < hops.length; i++) hops[i] = Math.min(hops[i] as number, distance[i] as number);
}

function fractal(noise: NoiseFunction3D, x: number, y: number, z: number, octaves: number): number {
  let value = 0;
  let amplitude = 1;
  let frequency = 1;
  let total = 0;
  for (let octave = 0; octave < octaves; octave++) {
    value += amplitude * noise(x * frequency, y * frequency, z * frequency);
    total += amplitude;
    amplitude *= 0.5;
    frequency *= 2;
  }
  return value / total;
}

function quantile(values: Float64Array, share: number): number {
  const sorted = Float64Array.from(values).sort();
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor(share * sorted.length)))] as number;
}

function components(count: number, neighbors: number[][], inside: (i: number) => boolean): number[][] {
  const seen = new Uint8Array(count);
  const result: number[][] = [];
  for (let i = 0; i < count; i++) {
    if (seen[i] || !inside(i)) continue;
    const component = [i];
    seen[i] = 1;
    for (let head = 0; head < component.length; head++) {
      for (const n of neighbors[component[head] as number] as number[]) {
        if (!seen[n] && inside(n)) {
          seen[n] = 1;
          component.push(n);
        }
      }
    }
    result.push(component);
  }
  return result;
}

/**
 * Per water cell, the population of the coast nearest to it: the most populous coast it touches, or for a cell out at
 * sea, the largest such population among its neighbors one hop nearer to land.
 */
function nearestCoastPopulation(world: World): Float64Array {
  const result = new Float64Array(world.waters.length);
  const byDepth = [...world.waters].sort((a, b) => a.depth - b.depth || a.id - b.id);
  for (const water of byDepth) {
    let best = 0;
    if (water.depth === 1) for (const area of water.coasts) best = Math.max(best, world.areas[area]?.population ?? 0);
    else {
      for (const id of water.neighbors) {
        const other = world.waters[id];
        if (other && other.depth === water.depth - 1) best = Math.max(best, result[id] as number);
      }
    }
    result[water.id] = best;
  }
  return result;
}

function areaName(random: () => number): string {
  const pick = (list: string[]) => list[Math.floor(random() * list.length)] as string;
  const name = (random() < 0.5 ? pick(SYLLABLES) : pick(SYLLABLES) + pick(SYLLABLES)) + pick(SYLLABLES_END);
  return name.charAt(0).toUpperCase() + name.slice(1);
}

const pairKey = (a: number, b: number) => (a < b ? `${a}-${b}` : `${b}-${a}`);
