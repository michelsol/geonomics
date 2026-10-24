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
export const ERASE = 0xef5d5d; // a brush stroke taking areas out of the selection

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

/**
 * Natural capacity of one good, drawn as diagonal stripes over the terrain: thicker for more, in RESOURCE_LEVELS steps
 * of the square root of the capacity over the best area's. Widths are in pixels of a STRIPE_TILE-pixel tile.
 */
export const STRIPE_TILE = 32;
export const STRIPE_WIDTHS = [2, 5, 10, 17] as const;
export const RESOURCE_LEVELS = STRIPE_WIDTHS.length;
export const STRIPE_COLOR = "rgba(11, 17, 26, 0.7)";
/** The stripe level of an area, or -1 where the good cannot be extracted. */
export function resourceLevel(capacity: number, best: number): number {
  if (!(capacity > 0) || !(best > 0)) return -1;
  return Math.min(RESOURCE_LEVELS - 1, Math.floor(Math.sqrt(capacity / best) * RESOURCE_LEVELS));
}

/** Employment rate: one hue, brighter for more, from nobody to everyone in work. */
export const EMPLOYMENT = [0x1a2340, 0x24477a, 0x2f74b5, 0x63a9e0, 0xc4e4fa];
export function employmentColor(rate: number): number {
  return Number.isFinite(rate) ? ramp(EMPLOYMENT, rate) : NEUTRAL;
}

/** Population: one hue, brighter for more, on a log scale between the map's smallest and largest areas. */
export const POPULATION = [0x2d2447, 0x4b3a86, 0x6f5fd0, 0x9d93ea, 0xd8d3f7];
/** Decades of population the layer spans below the largest area; anything smaller shows as the darkest color. */
export const POPULATION_DECADES = 2;

/** Population on a log scale from the largest area down POPULATION_DECADES, so emptied areas all show darkest. */
export function populationColor(population: number, largest: number): number {
  if (!(largest > 0) || !(population > 0)) return ramp(POPULATION, 0);
  const share = Math.log10(population / largest) / POPULATION_DECADES + 1;
  return ramp(POPULATION, Math.min(1, Math.max(0, share)));
}

/** Flow arrows: bright colors with a dark outline, so they read over any area layer. */
export const MIGRATION_ARROW = 0xf06fa0;
export const TRANSPORT_ARROW = 0xffc94a;
export const ARROW_OUTLINE = 0x0b111a;
export function satisfactionColor(satisfaction: number): number {
  return ramp(SATISFACTION, satisfaction);
}

export function parseColor(css: string): number {
  return Number.parseInt(css.replace("#", ""), 16);
}

export function cssColor(color: number): string {
  return `#${color.toString(16).padStart(6, "0")}`;
}
