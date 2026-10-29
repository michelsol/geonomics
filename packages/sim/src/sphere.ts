// Geometry on the spherical world (specification §4, Map generation): positions are points in km on a sphere of
// radius R centered at the origin. Hand-built worlds keep z = 0 and flat straight-line distances.
/// <reference path="./d3-geo-voronoi.d.ts" />
import { geoDelaunay } from "d3-geo-voronoi";
import type { Point3, World } from "./types";

const DEGREES = 180 / Math.PI;

/** Straight-line distance between two points: the chord on a sphere, which ranks points as the arc does. */
export function chord(p: Point3, q: Point3): number {
  return Math.hypot(p.x - q.x, p.y - q.y, p.z - q.z);
}

/** Distance along the surface of a sphere of radius `radius` between two points on it. */
export function arcDistance(radius: number, p: Point3, q: Point3): number {
  return 2 * radius * Math.asin(Math.min(1, chord(p, q) / (2 * radius)));
}

/** Distance between two positions over the world's surface: the arc on a spherical map, straight on a flat one. */
export function surfaceDistance(world: Pick<World, "map">, p: Point3, q: Point3): number {
  return world.map ? arcDistance(world.map.radius, p, q) : chord(p, q);
}

/** Longitude and latitude of a point, in degrees. */
export function toLonLat(p: Point3): [number, number] {
  const r = Math.hypot(p.x, p.y, p.z) || 1;
  return [Math.atan2(p.y, p.x) * DEGREES, Math.asin(Math.max(-1, Math.min(1, p.z / r))) * DEGREES];
}

/** The point at a longitude and latitude, in degrees, on a sphere of radius `radius`. */
export function fromLonLat(longitude: number, latitude: number, radius: number): Point3 {
  const lambda = longitude / DEGREES;
  const phi = latitude / DEGREES;
  return {
    x: radius * Math.cos(phi) * Math.cos(lambda),
    y: radius * Math.cos(phi) * Math.sin(lambda),
    z: radius * Math.sin(phi),
  };
}

/** A point moved onto the sphere of radius `radius` along the line from the center. */
export function onSphere(p: Point3, radius: number): Point3 {
  const r = Math.hypot(p.x, p.y, p.z) || 1;
  return { x: (p.x * radius) / r, y: (p.y * radius) / r, z: (p.z * radius) / r };
}

/**
 * `count` points spread evenly over a sphere along a Fibonacci spiral, each nudged by up to `jitter` of the mean
 * spacing in a random direction.
 */
export function fibonacciSphere(count: number, radius: number, jitter: number, random: () => number): Point3[] {
  const golden = Math.PI * (3 - Math.sqrt(5));
  const spacing = Math.sqrt((4 * Math.PI) / count) * radius;
  const points: Point3[] = [];
  for (let i = 0; i < count; i++) {
    const z = 1 - (2 * (i + 0.5)) / count;
    const r = Math.sqrt(1 - z * z);
    const theta = golden * i;
    const base = { x: radius * r * Math.cos(theta), y: radius * r * Math.sin(theta), z: radius * z };
    const nudge = jitter * spacing;
    points.push(
      onSphere(
        {
          x: base.x + nudge * (random() - 0.5),
          y: base.y + nudge * (random() - 0.5),
          z: base.z + nudge * (random() - 0.5),
        },
        radius,
      ),
    );
  }
  return points;
}

export interface SphericalVoronoi {
  neighbors: number[][]; // per point, its neighboring cells, sorted
  polygons: Point3[][]; // per point, its cell's corners in order around it, on the sphere
  corners: Point3[]; // every cell corner once, on the sphere: neighboring cells share theirs
  cornerIds: number[][]; // per point, its cell's corners as indices into `corners`, in the order of `polygons`
  /** The point whose cell holds a position, starting the walk from `start` (a nearby point id is fastest). */
  find(p: Point3, start?: number): number;
}

/** Voronoi cells of points on a sphere of radius `radius`. */
export function sphericalVoronoi(points: readonly Point3[], radius: number): SphericalVoronoi {
  const delaunay = geoDelaunay(points.map(toLonLat));
  const corners = delaunay.centers.map(([longitude, latitude]) => fromLonLat(longitude, latitude, radius));
  const cornerIds = points.map((_, i) => delaunay.polygons[i] ?? []);
  return {
    neighbors: points.map((_, i) => [...new Set(delaunay.neighbors[i] ?? [])].sort((a, b) => a - b)),
    polygons: cornerIds.map((ids) => ids.map((corner) => corners[corner] as Point3)),
    corners,
    cornerIds,
    find(p, start) {
      const [longitude, latitude] = toLonLat(p);
      return delaunay.find(longitude, latitude, start);
    },
  };
}

/** The point on the sphere at the mean direction of some points: the center of a cell or of a group of areas. */
export function sphericalMean(points: readonly Point3[], radius: number, weights?: readonly number[]): Point3 {
  let x = 0;
  let y = 0;
  let z = 0;
  for (const [i, p] of points.entries()) {
    const w = weights?.[i] ?? 1;
    x += w * p.x;
    y += w * p.y;
    z += w * p.z;
  }
  return onSphere({ x, y, z }, radius);
}
