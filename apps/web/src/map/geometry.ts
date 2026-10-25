// Map geometry computed once per game: Voronoi cells of the areas and the water cells, shared borders, selection
// outlines, and cell picking.
import type { StaticData } from "@geonomics/sim";
import { Delaunay } from "d3-delaunay";

export interface Border {
  a: number; // area on one side
  b: number; // area on the other side, or -1 for water (a coastline)
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface MapGeometry {
  width: number;
  height: number;
  cells: number[][]; // per area: flat x, y polygon
  waterCells: number[][]; // per water cell: flat x, y polygon
  borders: Border[]; // every segment between two areas, or between an area and water
  pick(x: number, y: number): number | null; // area at a map point, null for water or outside
  /** The frontier of a set of areas, as flat x1, y1, x2, y2 segments: sides between two of them are left out. */
  outline(areas: readonly number[]): number[];
}

// A segment shared by two cells has the same two vertices in both polygons.
const key = (x: number, y: number) => `${x.toFixed(3)},${y.toFixed(3)}`;
const segmentKey = (x1: number, y1: number, x2: number, y2: number) =>
  key(x1, y1) < key(x2, y2) ? `${key(x1, y1)}|${key(x2, y2)}` : `${key(x2, y2)}|${key(x1, y1)}`;

export function buildGeometry(data: StaticData): MapGeometry {
  const areaCount = data.areas.length;
  const points: number[] = [];
  for (const area of data.areas) points.push(area.x, area.y);
  let width = data.map?.width ?? 0;
  let height = data.map?.height ?? 0;
  for (const water of data.waters) points.push(water.x, water.y);
  if (!data.map) {
    for (const area of data.areas) {
      width = Math.max(width, area.x + 100);
      height = Math.max(height, area.y + 100);
    }
  }
  const delaunay = new Delaunay(Float64Array.from(points));
  const voronoi = delaunay.voronoi([0, 0, width, height]);

  const cells: number[][] = [];
  for (let i = 0; i < areaCount; i++) cells.push((voronoi.cellPolygon(i) ?? []).flat());
  const waterCells: number[][] = [];
  for (let i = 0; i < data.waters.length; i++) waterCells.push((voronoi.cellPolygon(areaCount + i) ?? []).flat());

  const owners = new Map<string, number>();
  const borders: Border[] = [];
  const cellCount = points.length / 2;
  for (let i = 0; i < cellCount; i++) {
    const polygon = voronoi.cellPolygon(i);
    if (!polygon) continue;
    for (let k = 0; k + 1 < polygon.length; k++) {
      const [x1, y1] = polygon[k] as [number, number];
      const [x2, y2] = polygon[k + 1] as [number, number];
      const segment = segmentKey(x1, y1, x2, y2);
      const other = owners.get(segment);
      if (other === undefined) {
        owners.set(segment, i);
        continue;
      }
      owners.delete(segment);
      const [a, b] = other < i ? [other, i] : [i, other];
      if (a >= areaCount) continue; // water on both sides
      borders.push({ a, b: b < areaCount ? b : -1, x1, y1, x2, y2 });
    }
  }

  return {
    width,
    height,
    cells,
    waterCells,
    borders,
    outline(areas) {
      // Each side of a selected cell, counted: a side seen twice lies between two selected cells.
      const sides = new Map<string, number[] | null>();
      for (const area of areas) {
        const cell = cells[area] ?? [];
        // Polygons are closed: the last vertex repeats the first.
        for (let k = 0; k + 3 < cell.length; k += 2) {
          const side = [cell[k], cell[k + 1], cell[k + 2], cell[k + 3]] as [number, number, number, number];
          const id = segmentKey(...side);
          sides.set(id, sides.has(id) ? null : side);
        }
      }
      const segments: number[] = [];
      for (const side of sides.values()) if (side) segments.push(...side);
      return segments;
    },
    pick(x, y) {
      if (x < 0 || y < 0 || x > width || y > height) return null;
      const cell = delaunay.find(x, y);
      return cell < areaCount ? cell : null;
    },
  };
}
