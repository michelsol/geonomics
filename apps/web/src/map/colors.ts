// Color scales of the map layers (specification §10, Map). Colors are 0xRRGGBB numbers, as PixiJS takes them.
import type { Terrain } from "@geonomics/sim";

export const WATER = 0x1d2b3f;
export const NEUTRAL = 0x5b6270;
export const CELL_LINE = 0x0b111a;
export const BORDER = 0xf2f4f8;
export const BLOCKED = 0xff4d4d;
export const SEA_ROUTE = 0x7fb2e8;
export const AIR_ROUTE = 0xe8c37f;
export const SELECTION = 0xffffff;
export const PICKED = 0xffd54a;

export const TERRAIN_COLORS: Record<Terrain, number> = {
  plains: 0x8fb36b,
  forest: 0x4f8a4c,
  hills: 0xb39a62,
  mountains: 0x8c847c,
  desert: 0xd9c38a,
};

type Rgb = [number, number, number];

const toRgb = (color: number): Rgb => [(color >> 16) & 255, (color >> 8) & 255, color & 255];
const fromRgb = ([r, g, b]: Rgb): number => (Math.round(r) << 16) | (Math.round(g) << 8) | Math.round(b);

/** Linear interpolation through evenly spaced color stops, t in [0, 1]. */
export function ramp(stops: readonly number[], t: number): number {
  const x = Math.min(1, Math.max(0, Number.isFinite(t) ? t : 0.5)) * (stops.length - 1);
  const i = Math.min(stops.length - 2, Math.floor(x));
  const a = toRgb(stops[i] as number);
  const b = toRgb(stops[i + 1] as number);
  const f = x - i;
  return fromRgb([a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f]);
}

export const DIVERGING = [0x2c6bb0, 0x8db8e0, 0xf2f2f2, 0xeba07e, 0xc0392b];
export const SATISFACTION = [0xc0392b, 0xe6a03c, 0xe8d85a, 0x6fbf5a, 0x2e8b57];

/** Price relative to labor value: blue below, white at, red above; full color at a factor of PRICE_RANGE. */
export const PRICE_RANGE = 3;
export function priceColor(price: number, laborValue: number): number {
  return ramp(DIVERGING, 0.5 + Math.log(price / laborValue) / (2 * Math.log(PRICE_RANGE)));
}

/** Wage level around the reference of 1: full color at half or double. */
export const WAGE_RANGE = 2;
export function wageColor(wageLevel: number): number {
  return ramp(DIVERGING, 0.5 + Math.log(Math.max(wageLevel, 1e-3)) / (2 * Math.log(WAGE_RANGE)));
}

export function satisfactionColor(satisfaction: number): number {
  return ramp(SATISFACTION, satisfaction);
}

export function parseColor(css: string): number {
  return Number.parseInt(css.replace("#", ""), 16);
}

export function cssColor(color: number): string {
  return `#${color.toString(16).padStart(6, "0")}`;
}
