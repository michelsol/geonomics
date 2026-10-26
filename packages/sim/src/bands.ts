// Wage bands (specification §4, Consumption; §5, Policies): workers buy from the income of their band, and the
// income tax sets one rate per band.

/** Band boundaries in man-hours per worker-hour: under 0.5, 0.5 to 1, 1 to 2, over 2. */
export const WAGE_BAND_BOUNDARIES: readonly number[] = [0.5, 1, 2];
export const WAGE_BAND_COUNT = WAGE_BAND_BOUNDARIES.length + 1;
/** Consumer groups: the wage bands, then the unemployed. */
export const CONSUMER_GROUP_COUNT = WAGE_BAND_COUNT + 1;

/** The band of an hourly wage: the number of boundaries at or below it. */
export function wageBandOf(wage: number): number {
  let band = 0;
  while (band < WAGE_BAND_BOUNDARIES.length && wage >= (WAGE_BAND_BOUNDARIES[band] as number)) band++;
  return band;
}
