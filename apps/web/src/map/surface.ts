// Shapes drawn on the globe's surface (specification §9, Map): arcs along great circles, arrows that follow them, and
// flat marks placed in the tangent plane at a point. Geometry only, so it is testable without a renderer. Points are
// in km from the globe's center; shapes are returned as flat arrays of x, y, z coordinates.
import type { Point3 } from "@geonomics/sim";
import { ARROW_END, ARROW_MIN_SPAN_PX, ARROW_START } from "./arrows";

const length = (p: Point3) => Math.hypot(p.x, p.y, p.z);
const scale = (p: Point3, k: number): Point3 => ({ x: p.x * k, y: p.y * k, z: p.z * k });
const add = (p: Point3, q: Point3): Point3 => ({ x: p.x + q.x, y: p.y + q.y, z: p.z + q.z });
const cross = (p: Point3, q: Point3): Point3 => ({
  x: p.y * q.z - p.z * q.y,
  y: p.z * q.x - p.x * q.z,
  z: p.x * q.y - p.y * q.x,
});
const unit = (p: Point3): Point3 => scale(p, 1 / (length(p) || 1));
const dot = (p: Point3, q: Point3) => p.x * q.x + p.y * q.y + p.z * q.z;

/** A point moved to `radius` from the center. */
export function lift(p: Point3, radius: number): Point3 {
  return scale(p, radius / (length(p) || 1));
}

/** The angle between two points as seen from the center, in radians. */
export function angleBetween(p: Point3, q: Point3): number {
  return Math.acos(Math.max(-1, Math.min(1, dot(unit(p), unit(q)))));
}

/** The point a share `t` of the way from `p` to `q` along their great circle, at `radius`. */
export function slerp(p: Point3, q: Point3, t: number, radius: number): Point3 {
  const a = unit(p);
  const b = unit(q);
  const omega = angleBetween(a, b);
  if (omega < 1e-9) return lift(a, radius);
  const s = Math.sin(omega);
  return lift(add(scale(a, Math.sin((1 - t) * omega) / s), scale(b, Math.sin(t * omega) / s)), radius);
}

/** Points along the great circle from `p` to `q`, at `radius`, at most `step` km apart. */
export function arc(p: Point3, q: Point3, radius: number, step: number): Point3[] {
  const segments = Math.max(1, Math.ceil((angleBetween(p, q) * radius) / step));
  return Array.from({ length: segments + 1 }, (_, i) => slerp(p, q, i / segments, radius));
}

/** East and north at a point of the sphere, as unit vectors; at a pole, any two at right angles. */
export function tangentFrame(p: Point3): { east: Point3; north: Point3 } {
  const up = unit(p);
  let east = cross({ x: 0, y: 0, z: 1 }, up);
  if (length(east) < 1e-6) east = cross({ x: 0, y: 1, z: 0 }, up);
  east = unit(east);
  return { east, north: cross(up, east) };
}

/**
 * A flat mark placed on the sphere at `center`: `shape` gives x, y pairs in screen pixels around it, x to the east
 * and y to the south (as on a screen with north up), and `px` is one pixel in km. Returns its points at `radius`.
 */
export function placeShape(center: Point3, shape: readonly number[], px: number, radius: number): Point3[] {
  const { east, north } = tangentFrame(center);
  const points: Point3[] = [];
  for (let i = 0; i + 1 < shape.length; i += 2) {
    const x = (shape[i] as number) * px;
    const y = (shape[i + 1] as number) * px;
    points.push(lift(add(center, add(scale(east, x), scale(north, -y))), radius));
  }
  return points;
}

/**
 * Triangles of a flow arrow along the great circle from `from` to `to`: a shaft of `width` km from 20% to 80% of the
 * way, ending in a triangular head, shifted `offset` km to the right of travel as seen from outside the globe. `grow`
 * enlarges it on every side, for a dark outline drawn under it. `px` is one screen pixel in km: the head keeps a
 * readable size, and arrows with less than 14 px of room are left out (null).
 */
export function arrowTriangles(
  from: Point3,
  to: Point3,
  width: number,
  offset: number,
  px: number,
  radius: number,
  grow = 0,
): number[] | null {
  const total = angleBetween(from, to) * radius;
  const span = (ARROW_END - ARROW_START) * total;
  if (span < ARROW_MIN_SPAN_PX * px || total === 0) return null;
  const headHalf = Math.max(width, 3.5 * px);
  const headLength = Math.min(0.5 * span, 2 * headHalf);
  const half = width / 2 + grow;
  const at = (distance: number) => slerp(from, to, Math.min(1, Math.max(0, distance / total)), radius);
  /** The two sides of the arrow `distance` km along, `halfWidth` either side of its middle line. */
  const sides = (distance: number, halfWidth: number): [Point3, Point3] => {
    const p = at(distance);
    const ahead = at(Math.min(total, distance + 0.01 * total));
    const behind = at(Math.max(0, distance - 0.01 * total));
    const travel = unit(add(ahead, scale(behind, -1)));
    const right = unit(cross(travel, unit(p))); // to the right of travel, seen from outside
    const middle = lift(add(p, scale(right, offset)), radius);
    return [lift(add(middle, scale(right, -halfWidth)), radius), lift(add(middle, scale(right, halfWidth)), radius)];
  };
  const start = ARROW_START * total - grow;
  const neck = ARROW_END * total - headLength - grow;
  const tip = ARROW_END * total + 2 * grow;
  const triangles: number[] = [];
  const push = (...points: Point3[]) => {
    for (const p of points) triangles.push(p.x, p.y, p.z);
  };
  // The shaft as a strip of quads, so it bends with the globe; an arrow spanning under 3 degrees is flat enough whole.
  const pieces = total / radius < 0.05 ? 1 : Math.max(1, Math.ceil((neck - start) / (0.05 * total)));
  for (let i = 0; i < pieces; i++) {
    const [l1, r1] = sides(start + ((neck - start) * i) / pieces, half);
    const [l2, r2] = sides(start + ((neck - start) * (i + 1)) / pieces, half);
    push(l1, r1, r2, l1, r2, l2);
  }
  const [left, right] = sides(neck, headHalf + 1.5 * grow);
  const [point] = sides(tip, 0);
  push(left, right, point);
  return triangles;
}
