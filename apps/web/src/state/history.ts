// Bounded time series for the charts, built on the client from successive snapshots and price tables.

export const HISTORY_SAMPLES = 365;

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
  readonly areaStats = new Map<number, Series>(); // per tracked area: population and average wage
  readonly realm = new Series(2); // population and treasury of the player's realm

  constructor(readonly goodCount: number) {
    this.goodPrices = Array.from({ length: goodCount }, () => new Series(3));
  }

  /** Starts recording an area's prices, population and wage, if it is not already tracked. */
  track(area: number): void {
    if (this.areaPrices.has(area)) return;
    this.areaPrices.set(area, new Series(this.goodCount));
    this.areaStats.set(area, new Series(2));
  }
}
