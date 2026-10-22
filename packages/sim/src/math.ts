// Numeric helpers shared by every phase (specification §4, rules 2 and 5).
import type { WorldConfig } from "./config";
import type { Good } from "./types";

/** Smallest denominator used anywhere a division could hit zero. */
export const EPSILON = 1e-9;

export function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), maximum);
}

/**
 * Rule 2: turns a rate per game day into the fraction of the gap to close in one tick.
 * Always within [0, 1), so a value can never jump past its target.
 */
export function fractionPerTick(ratePerDay: number, responsiveness: number, days: number): number {
  return 1 - Math.exp(-ratePerDay * responsiveness * days);
}

/** Days of total demand an area keeps in stock; perishable goods keep less so spoilage stays bounded. */
export function reserveDaysOf(good: Good, config: WorldConfig): number {
  const { reserveDays, maxReserveSpoilageShare } = config.economy;
  return Math.min(reserveDays, maxReserveSpoilageShare / Math.max(good.spoilageRatePerDay, EPSILON));
}

/** Rate per day from a half-life in days. */
export function rateFromHalfLife(halfLifeDays: number): number {
  return Math.LN2 / halfLifeDays;
}
