// Shortest paths over the area graph, used by depot transfers and marching armies.
import { MinHeap } from "./heap";
import type { AreaId, Edge, EdgeId, World } from "./types";

export interface PathStep {
  edge: EdgeId; // edge crossed
  to: AreaId; // area reached by crossing it
}

export interface Path {
  steps: PathStep[]; // in order from the start; empty when start and destination are the same
  cost: number; // sum of the step weights
}

/**
 * Dijkstra from one area to another. `weight` gives the cost of crossing an edge out of an area, or null when the
 * edge cannot be used from there. Returns null when the destination cannot be reached.
 */
export function shortestPath(
  world: World,
  from: AreaId,
  to: AreaId,
  weight: (edge: Edge, from: AreaId) => number | null,
): Path | null {
  const count = world.areas.length;
  const distance = new Float64Array(count).fill(Number.POSITIVE_INFINITY);
  const via = new Int32Array(count).fill(-1);
  const heap = new MinHeap();
  distance[from] = 0;
  heap.push(0, from);
  while (heap.size > 0) {
    const [d, area] = heap.pop();
    if (d > (distance[area] as number)) continue;
    if (area === to) break;
    for (const id of world.areas[area]?.edges ?? []) {
      const edge = world.edges[id] as Edge;
      const w = weight(edge, area);
      if (w === null) continue;
      const next = edge.areaA === area ? edge.areaB : edge.areaA;
      const nd = d + w;
      if (nd < (distance[next] as number)) {
        distance[next] = nd;
        via[next] = id;
        heap.push(nd, next);
      }
    }
  }
  if (!Number.isFinite(distance[to] as number)) return null;
  const steps: PathStep[] = [];
  for (let area = to; area !== from; ) {
    const edge = world.edges[via[area] as number] as Edge;
    steps.push({ edge: edge.id, to: area });
    area = edge.areaA === area ? edge.areaB : edge.areaA;
  }
  steps.reverse();
  return { steps, cost: distance[to] as number };
}
