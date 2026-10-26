// Bounded time series for the charts, built on the client from successive snapshots and price tables.

export const HISTORY_SAMPLES = 365;
/** Selections of several areas whose mean prices are recorded; the oldest is dropped beyond this. */
export const TRACKED_SELECTIONS = 20;
/** Population, births, starvation, immigration, emigration, necessities met and satisfaction (see DEMOGRAPHY_KEYS). */
export const DEMOGRAPHY_CHANNELS = 7;

/** A ring buffer of samples: one x (game day) and a fixed number of channels per sample. */
export class Series {
  private readonly x: Float64Array;
  private readonly channels: Float32Array[];
  private start = 0;
  length = 0;

  constructor(
    channelCount: number,
    readonly capacity = HISTORY_SAMPLES,
  ) {
    this.x = new Float64Array(capacity);
    this.channels = Array.from({ length: channelCount }, () => new Float32Array(capacity));
  }

  push(x: number, values: ArrayLike<number>): void {
    // A repeated x (a snapshot sent while paused) replaces the last sample instead of adding one.
    const last = this.length > 0 ? (this.start + this.length - 1) % this.capacity : -1;
    let slot: number;
    if (last >= 0 && this.x[last] === x) slot = last;
    else if (this.length < this.capacity) {
      slot = (this.start + this.length) % this.capacity;
      this.length++;
    } else {
      slot = this.start;
      this.start = (this.start + 1) % this.capacity;
    }
    this.x[slot] = x;
    for (let c = 0; c < this.channels.length; c++) (this.channels[c] as Float32Array)[slot] = values[c] ?? Number.NaN;
  }

  /** x values in time order. */
  xs(): number[] {
    return this.ordered((i) => this.x[i] as number);
  }

  /** One channel in time order. */
  channel(c: number): number[] {
    const values = this.channels[c] as Float32Array;
    return this.ordered((i) => values[i] as number);
  }

  private ordered(read: (i: number) => number): number[] {
    const out: number[] = new Array(this.length);
    for (let k = 0; k < this.length; k++) out[k] = read((this.start + k) % this.capacity);
    return out;
  }
}

/** All the series the interface charts. */
export class History {
  readonly goodPrices: Series[]; // per good: lowest, median and highest price in the world
  readonly areaPrices = new Map<number, Series>(); // per tracked area: the price of every good
  readonly selectionPrices = new Map<string, { areas: number[]; series: Series }>(); // per selection: mean prices
  // Per selection, and for the player's realm (the whole world for a spectator): the DEMOGRAPHY_KEYS channels.
  readonly demography = new Map<string, { areas: number[]; series: Series }>();
  readonly realmDemography = new Series(DEMOGRAPHY_CHANNELS);

  constructor(readonly goodCount: number) {
    this.goodPrices = Array.from({ length: goodCount }, () => new Series(3));
  }

  /** Starts recording an area's prices, if it is not already tracked. */
  track(area: number): void {
    if (!this.areaPrices.has(area)) this.areaPrices.set(area, new Series(this.goodCount));
  }

  /** Starts recording the mean prices of several areas; the series of the oldest selection goes past the limit. */
  trackSelection(areas: readonly number[]): Series {
    const key = selectionKey(areas);
    const known = this.selectionPrices.get(key);
    if (known) return known.series;
    const series = new Series(this.goodCount);
    this.selectionPrices.set(key, { areas: [...areas], series });
    for (const old of this.selectionPrices.keys()) {
      if (this.selectionPrices.size <= TRACKED_SELECTIONS) break;
      this.selectionPrices.delete(old);
    }
    return series;
  }

  /** Starts recording the demography of some areas; the series of the oldest selection goes past the limit. */
  trackDemography(areas: readonly number[]): void {
    const key = selectionKey(areas);
    if (this.demography.has(key)) return;
    this.demography.set(key, { areas: [...areas], series: new Series(DEMOGRAPHY_CHANNELS) });
    for (const old of this.demography.keys()) {
      if (this.demography.size <= TRACKED_SELECTIONS) break;
      this.demography.delete(old);
    }
  }

  /** The recorded demography of some areas, or of the realm when none are given. */
  demographyOf(areas: readonly number[]): Series | undefined {
    if (areas.length === 0) return this.realmDemography;
    return this.demography.get(selectionKey(areas))?.series;
  }

  /** The recorded prices of one area, or the mean prices of several. */
  pricesOf(areas: readonly number[]): Series | undefined {
    if (areas.length === 1) return this.areaPrices.get(areas[0] as number);
    return this.selectionPrices.get(selectionKey(areas))?.series;
  }
}

/** The same areas in any order give the same key. */
export function selectionKey(areas: readonly number[]): string {
  return [...areas].sort((a, b) => a - b).join(",");
}
