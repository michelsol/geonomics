// The globe's cells (specification §9, Map): the spherical Voronoi cells of every area, then every water cell, as one
// triangle mesh, the borders between them, selection outlines and picking. Built once from the static data, with
// the same cells the map was generated with.
import { type Point3, type StaticData, sphericalVoronoi } from "@geonomics/sim";

/** A side shared by two cells: `a` an area, `b` another area or -1 for water. Sides between two waters are left out. */
export interface Border {
  a: number;
  b: number;
  p: Point3;
  q: Point3;
}

export interface GlobeGeometry {
  radius: number;
  areaCount: number;
  cellCount: number; // areas, then water cells
  /** Triangle fans, one per cell from its center: 3 coordinates per vertex. */
  positions: Float32Array;
  /** Per cell, its first vertex in `positions` and how many it has; its triangles are in `triangles`. */
  firstVertex: Int32Array;
  vertexCount: Int32Array;
  /** Vertex indices, 3 per triangle, cell after cell; `firstTriangle` gives each cell's first. */
  triangles: Uint32Array;
  firstTriangle: Int32Array;
  borders: Border[];
  /** Corners of a cell in order around it, on the sphere. */
  corners(cell: number): Point3[];
  /** The frontier of a set of areas as segments: x1, y1, z1, x2, y2, z2 each. */
  outline(areas: Iterable<number>): number[];
  /** Triangle indices of some cells, for a mesh drawing only them. */
  trianglesOf(cells: Iterable<number>): Uint32Array;
  /** The area whose cell holds a point of the sphere, or null over water. */
  pick(p: Point3): number | null;
}

/** The radius of a generated map, or for a hand-built one the farthest area from the center. */
export function radiusOf(data: Pick<StaticData, "map" | "areas">): number {
  if (data.map) return data.map.radius;
  return Math.max(1, ...data.areas.map((area) => Math.hypot(area.x, area.y, area.z)));
}

export function buildGlobe(data: Pick<StaticData, "map" | "areas" | "waters">): GlobeGeometry {
  const radius = radiusOf(data);
  const areaCount = data.areas.length;
  const sites: Point3[] = [
    ...data.areas.map(({ x, y, z }) => ({ x, y, z })),
    ...data.waters.map(({ x, y, z }) => ({ x, y, z })),
  ];
  const cellCount = sites.length;
  const voronoi = sphericalVoronoi(sites, radius);

  // Triangle fans: the cell's center, then its corners.
  const firstVertex = new Int32Array(cellCount);
  const vertexCount = new Int32Array(cellCount);
  const firstTriangle = new Int32Array(cellCount + 1);
  let vertices = 0;
  let triangleTotal = 0;
  for (let cell = 0; cell < cellCount; cell++) {
    const corners = voronoi.polygons[cell]?.length ?? 0;
    firstVertex[cell] = vertices;
    vertexCount[cell] = corners >= 3 ? corners + 1 : 0;
    firstTriangle[cell] = triangleTotal;
    vertices += vertexCount[cell] as number;
    triangleTotal += corners >= 3 ? corners : 0;
  }
  firstTriangle[cellCount] = triangleTotal;
  const positions = new Float32Array(3 * vertices);
  const triangles = new Uint32Array(3 * triangleTotal);
  for (let cell = 0; cell < cellCount; cell++) {
    if ((vertexCount[cell] as number) === 0) continue;
    const corners = voronoi.polygons[cell] as Point3[];
    const first = firstVertex[cell] as number;
    const site = sites[cell] as Point3;
    positions.set([site.x, site.y, site.z], 3 * first);
    for (const [k, corner] of corners.entries()) positions.set([corner.x, corner.y, corner.z], 3 * (first + 1 + k));
    let t = 3 * (firstTriangle[cell] as number);
    for (let k = 0; k < corners.length; k++) {
      triangles[t++] = first;
      triangles[t++] = first + 1 + k;
      triangles[t++] = first + 1 + ((k + 1) % corners.length);
    }
  }

  // Sides: each pair of consecutive corners of a cell, matched with the neighbor that has the same pair.
  const sides = new Map<number, { cells: number[]; p: Point3; q: Point3 }>();
  const cornerCount = voronoi.corners.length;
  const sideKey = (i: number, j: number) => (i < j ? i * cornerCount + j : j * cornerCount + i);
  for (let cell = 0; cell < cellCount; cell++) {
    const ids = voronoi.cornerIds[cell] ?? [];
    for (let k = 0; k < ids.length; k++) {
      const i = ids[k] as number;
      const j = ids[(k + 1) % ids.length] as number;
      if (i === j) continue;
      const key = sideKey(i, j);
      const side = sides.get(key);
      if (side) side.cells.push(cell);
      else sides.set(key, { cells: [cell], p: voronoi.corners[i] as Point3, q: voronoi.corners[j] as Point3 });
    }
  }
  const borders: Border[] = [];
  const sidesOf: number[][] = Array.from({ length: areaCount }, () => []); // per area, its sides as border indices
  for (const side of sides.values()) {
    const [first, second] = side.cells as [number, number | undefined];
    const land = [first, second ?? cellCount].filter((cell) => cell < areaCount);
    if (land.length === 0) continue; // water against water
    const a = land[0] as number;
    const b = land.length > 1 ? (land[1] as number) : -1;
    sidesOf[a]?.push(borders.length);
    if (b >= 0) sidesOf[b]?.push(borders.length);
    borders.push({ a, b, p: side.p, q: side.q });
  }

  let hint = 0;
  return {
    radius,
    areaCount,
    cellCount,
    positions,
    firstVertex,
    vertexCount,
    triangles,
    firstTriangle,
    borders,
    corners: (cell) => voronoi.polygons[cell] ?? [],
    outline(areas) {
      const inside = new Set(areas);
      const segments: number[] = [];
      for (const area of inside) {
        for (const index of sidesOf[area] ?? []) {
          const border = borders[index] as Border;
          const other = border.a === area ? border.b : border.a;
          if (inside.has(other)) continue; // between two selected areas
          segments.push(border.p.x, border.p.y, border.p.z, border.q.x, border.q.y, border.q.z);
        }
      }
      return segments;
    },
    trianglesOf(cells) {
      const parts: Uint32Array[] = [];
      let total = 0;
      for (const cell of cells) {
        if (cell < 0 || cell >= cellCount) continue;
        const part = triangles.subarray(3 * (firstTriangle[cell] as number), 3 * (firstTriangle[cell + 1] as number));
        parts.push(part);
        total += part.length;
      }
      const result = new Uint32Array(total);
      let at = 0;
      for (const part of parts) {
        result.set(part, at);
        at += part.length;
      }
      return result;
    },
    pick(p) {
      const cell = voronoi.find(p, hint);
      hint = cell;
      return cell >= 0 && cell < areaCount ? cell : null;
    },
  };
}
