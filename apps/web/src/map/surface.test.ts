import { describe, expect, it } from "vitest";
import { angleBetween, arc, arrowTriangles, placeShape, slerp, tangentFrame } from "./surface";

const R = 1000;
const east = { x: R, y: 0, z: 0 };
const north = { x: 0, y: 0, z: R };
const norm = (p: { x: number; y: number; z: number }) => Math.hypot(p.x, p.y, p.z);

describe("shapes on the globe", () => {
  it("follow great circles on the sphere", () => {
    const middle = slerp(east, north, 0.5, R);
    expect(norm(middle)).toBeCloseTo(R, 9);
    expect(middle.x).toBeCloseTo(middle.z, 9);
    const points = arc(east, north, R, 100);
    expect(points[0]?.x).toBeCloseTo(R, 9);
    expect(points.at(-1)?.z).toBeCloseTo(R, 9);
    for (const p of points) expect(norm(p)).toBeCloseTo(R, 9);
    expect(points.length - 1).toBe(Math.ceil(((Math.PI / 2) * R) / 100));
  });

  it("place flat marks in the tangent plane, east to the right and north up", () => {
    const at = { x: R, y: 0, z: 0 }; // on the equator, facing +x: east is +y, north is +z
    const frame = tangentFrame(at);
    expect(frame.east.y).toBeCloseTo(1, 9);
    expect(frame.north.z).toBeCloseTo(1, 9);
    const [right, up] = placeShape(at, [10, 0, 0, -10], 1, R); // 10 px east, then 10 px up (y is down)
    expect(right?.y).toBeGreaterThan(9);
    expect(up?.z).toBeGreaterThan(9);
  });

  it("draw arrows from 20% to 80% of the way, and skip those with too little room", () => {
    const from = { x: R, y: 0, z: 0 };
    const to = slerp(from, { x: 0, y: R, z: 0 }, 0.1, R); // a tenth of a quarter turn away
    const triangles = arrowTriangles(from, to, 4, 0, 1, R) as number[];
    const total = angleBetween(from, to);
    const angles: number[] = [];
    for (let i = 0; i < triangles.length; i += 3) {
      const p = { x: triangles[i] as number, y: triangles[i + 1] as number, z: triangles[i + 2] as number };
      angles.push(angleBetween(from, p) / total);
    }
    expect(Math.min(...angles)).toBeGreaterThan(0.19);
    expect(Math.max(...angles)).toBeLessThan(0.81);
    expect(arrowTriangles(from, to, 4, 0, 100, R)).toBeNull(); // zoomed far out: no room
  });

  it("shift arrows to the right of travel, so opposite flows stay apart", () => {
    // Along the equator from +x toward +y, seen from outside: the right of travel is south (-z).
    const from = { x: R, y: 0, z: 0 };
    const to = slerp(from, { x: 0, y: R, z: 0 }, 0.2, R);
    const ahead = arrowTriangles(from, to, 2, 10, 1, R) as number[];
    const back = arrowTriangles(to, from, 2, 10, 1, R) as number[];
    const meanZ = (t: number[]) => t.filter((_, i) => i % 3 === 2).reduce((a, b) => a + b, 0) / (t.length / 3);
    expect(meanZ(ahead)).toBeLessThan(-5);
    expect(meanZ(back)).toBeGreaterThan(5);
  });
});
