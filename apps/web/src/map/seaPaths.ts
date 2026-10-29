// Sea routes drawn along the water (specification §9, Map): the shortest path over water cells between two ports,
// smoothed, as flat x, y, z points. Geometry only, so it is testable without a renderer.
import { MinHeap, type StaticData } from "@geonomics/sim";

/**
 * The shortest way by water from area `a`'s center to area `b`'s, through the centers of the water cells between
 * them, as flat x, y, z triples. `shore` lists each area's shore cells. Null without water cells, or with no water
 * path, so the caller draws a direct line.
 */
export function waterPath(
  data: Pick<StaticData, "areas" | "waters">,
  shore: readonly (readonly number[])[],
  a: number,
  b: number,
): number[] | null {
  const { areas, waters } = data;
  const from = areas[a];
  const to = areas[b];
  const starts = shore[a] ?? [];
  const ends = new Set(shore[b] ?? []);
  if (!from || !to || waters.length === 0 || starts.length === 0 || ends.size === 0) return null;
  const distance = new Float64Array(waters.length).fill(Number.POSITIVE_INFINITY);
  const via = new Int32Array(waters.length).fill(-1);
  const heap = new MinHeap();
  for (const cell of starts) {
    const water = waters[cell] as StaticData["waters"][number];
    const d = Math.hypot(water.x - from.x, water.y - from.y, water.z - from.z);
    if (d < (distance[cell] as number)) {
      distance[cell] = d;
      heap.push(d, cell);
    }
  }
  // The search ends at the first of b's shore cells taken off the heap with its leg to b's center added.
  let best = Number.POSITIVE_INFINITY;
  let last = -1;
  while (heap.size > 0) {
    const [d, cell] = heap.pop();
    if (d > (distance[cell] as number) || d >= best) continue;
    const water = waters[cell] as StaticData["waters"][number];
    if (ends.has(cell)) {
      const total = d + Math.hypot(to.x - water.x, to.y - water.y, to.z - water.z);
      if (total < best) {
        best = total;
        last = cell;
      }
    }
    for (const next of water.neighbors) {
      const other = waters[next] as StaticData["waters"][number];
      const nd = d + Math.hypot(other.x - water.x, other.y - water.y, other.z - water.z);
      if (nd < (distance[next] as number)) {
        distance[next] = nd;
        via[next] = cell;
        heap.push(nd, next);
      }
    }
  }
  if (last < 0) return null;
  const cells: number[] = [];
  for (let cell = last; cell >= 0; cell = via[cell] as number) cells.push(cell);
  cells.reverse();
  const points = [from.x, from.y, from.z];
  for (const cell of cells) {
    const water = waters[cell] as StaticData["waters"][number];
    points.push(water.x, water.y, water.z);
  }
  points.push(to.x, to.y, to.z);
  return smooth(points);
}

/**
 * Two passes of Chaikin's corner cutting over x, y, z triples: each corner is replaced by points a quarter and three
 * quarters along its segments, so the path stops zigzagging between cell centers. Both ends stay where they are.
 */
export function smooth(points: readonly number[], passes = 2): number[] {
  let current = [...points];
  for (let pass = 0; pass < passes; pass++) {
    const count = current.length / 3;
    if (count < 3) return current;
    const next = current.slice(0, 3);
    for (let i = 0; i < count - 1; i++) {
      const p = current.slice(3 * i, 3 * i + 3) as [number, number, number];
      const q = current.slice(3 * i + 3, 3 * i + 6) as [number, number, number];
      if (i > 0) next.push(...p.map((v, k) => 0.75 * v + 0.25 * (q[k] as number)));
      if (i < count - 2) next.push(...p.map((v, k) => 0.25 * v + 0.75 * (q[k] as number)));
    }
    next.push(...current.slice(current.length - 3));
    current = next;
  }
  return current;
}
