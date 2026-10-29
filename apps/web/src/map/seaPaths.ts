// Sea routes drawn along the water (specification §9, Map): the shortest path over water cells between two ports,
// smoothed, as flat x, y points. Geometry only, so it is testable without a renderer.
import { MinHeap, type StaticData } from "@geonomics/sim";

/**
 * The shortest way by water from area `a`'s center to area `b`'s, through the centers of the water cells between
 * them, as flat x, y pairs. `shore` lists each area's shore cells. Null without water cells, or with no water path,
 * so the caller draws a straight line.
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
    const d = Math.hypot(water.x - from.x, water.y - from.y);
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
      const total = d + Math.hypot(to.x - water.x, to.y - water.y);
      if (total < best) {
        best = total;
        last = cell;
      }
    }
    for (const next of water.neighbors) {
      const other = waters[next] as StaticData["waters"][number];
      const nd = d + Math.hypot(other.x - water.x, other.y - water.y);
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
  const points = [from.x, from.y];
  for (const cell of cells) {
    const water = waters[cell] as StaticData["waters"][number];
    points.push(water.x, water.y);
  }
  points.push(to.x, to.y);
  return smooth(points);
}

/**
 * Two passes of Chaikin's corner cutting: each corner is replaced by points a quarter and three quarters along its
 * segments, so the path stops zigzagging between cell centers. Both ends stay where they are.
 */
export function smooth(points: readonly number[], passes = 2): number[] {
  let current = [...points];
  for (let pass = 0; pass < passes; pass++) {
    const count = current.length / 2;
    if (count < 3) return current;
    const next = [current[0] as number, current[1] as number];
    for (let i = 0; i < count - 1; i++) {
      const x1 = current[2 * i] as number;
      const y1 = current[2 * i + 1] as number;
      const x2 = current[2 * i + 2] as number;
      const y2 = current[2 * i + 3] as number;
      if (i > 0) next.push(0.75 * x1 + 0.25 * x2, 0.75 * y1 + 0.25 * y2);
      if (i < count - 2) next.push(0.25 * x1 + 0.75 * x2, 0.25 * y1 + 0.75 * y2);
    }
    next.push(current[current.length - 2] as number, current[current.length - 1] as number);
    current = next;
  }
  return current;
}

/** Something to draw dashes on: a PixiJS Graphics, or a recorder in tests. */
export interface PathSink {
  moveTo(x: number, y: number): PathSink;
  lineTo(x: number, y: number): unknown;
}

/** Dashes along a polyline of flat x, y points, the dash pattern carried across its corners. */
export function dashedPath(g: PathSink, points: readonly number[], dash: number, gap: number): void {
  const period = dash + gap;
  let phase = 0; // distance into the current dash-and-gap period
  for (let i = 0; i + 3 < points.length; i += 2) {
    const x1 = points[i] as number;
    const y1 = points[i + 1] as number;
    const x2 = points[i + 2] as number;
    const y2 = points[i + 3] as number;
    const length = Math.hypot(x2 - x1, y2 - y1);
    if (length === 0) continue;
    const ux = (x2 - x1) / length;
    const uy = (y2 - y1) / length;
    let d = 0;
    while (d < length) {
      const drawing = phase < dash;
      const left = (drawing ? dash : period) - phase; // what remains of the current dash or gap
      const end = Math.min(length, d + left);
      if (drawing && end > d) g.moveTo(x1 + ux * d, y1 + uy * d).lineTo(x1 + ux * end, y1 + uy * end);
      if (end === length) phase += end - d;
      else phase = drawing ? dash : 0; // the dash or gap is done: set it exactly, as rounding could stall here
      d = end;
    }
  }
}
