// Seeded random generator (mulberry32). Its whole state is World.randomSeed, so saving the world saves the stream.
import type { World } from "./types";

/** Normalizes any number into a valid 32-bit generator state. */
export function seedFrom(seed: number): number {
  return Math.trunc(seed) >>> 0;
}

/** Returns a float in [0, 1) and advances the world's generator. */
export function nextRandom(world: World): number {
  world.randomSeed = (world.randomSeed + 0x6d2b79f5) >>> 0;
  let t = world.randomSeed;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
