// Map geometry computed once per game: Voronoi cells of the areas, shared borders, and cell picking.
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
  borders: Border[]; // every segment between two areas, or between an area and water
  pick(x: number, y: number): number | null; // area at a map point, null for water or outside
}

export function buildGeometry(data: StaticData): MapGeometry {
  const areaCount = data.areas.length;
  const points: number[] = [];
  for (const area of data.areas) points.push(area.x, area.y);
  let width = data.map?.width ?? 0;
  let height = data.map?.height ?? 0;
  if (data.map) for (const value of data.map.waterPoints) points.push(value);
  else {
    for (const area of data.areas) {
      width = Math.max(width, area.x + 100);
      height = Math.max(height, area.y + 100);
    }
  }
  const delaunay = new Delaunay(Float64Array.from(points));
  const voronoi = delaunay.voronoi([0, 0, width, height]);

  const cells: number[][] = [];
  for (let i = 0; i < areaCount; i++) cells.push((voronoi.cellPolygon(i) ?? []).flat());

  // A segment shared by two cells has the same two vertices in both polygons.
  const key = (x: number, y: number) => `${x.toFixed(3)},${y.toFixed(3)}`;
  const owners = new Map<string, number>();
  const borders: Border[] = [];
  const cellCount = points.length / 2;
  for (let i = 0; i < cellCount; i++) {
    const polygon = voronoi.cellPolygon(i);
    if (!polygon) continue;
    for (let k = 0; k + 1 < polygon.length; k++) {
      const [x1, y1] = polygon[k] as [number, number];
      const [x2, y2] = polygon[k + 1] as [number, number];
      const segment = key(x1, y1) < key(x2, y2) ? `${key(x1, y1)}|${key(x2, y2)}` : `${key(x2, y2)}|${key(x1, y1)}`;
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
    borders,
    pick(x, y) {
      if (x < 0 || y < 0 || x > width || y > height) return null;
      const cell = delaunay.find(x, y);
      return cell < areaCount ? cell : null;
    },
  };
}
