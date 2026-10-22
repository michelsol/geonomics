// Diagnostics from specification §4: price volatility, oscillation count, unmet necessities and labor churn,
// measured over a trailing window of game days.
import type { World } from "@geonomics/sim";

/** Log price changes under 0.1% are noise and never count as a change of direction. */
const OSCILLATION_THRESHOLD = 1e-3;

export interface GoodDiagnostics {
  key: string;
  volatility: number; // worst area: standard deviation of daily log price changes over the window
  oscillations: number; // worst area: changes of price direction over the window
  priceToLaborValue: number; // mean over areas of price / labor value
}

export interface Diagnostics {
  day: number;
  population: number;
  meanWageLevel: number; // population-weighted
  meanSatisfaction: number; // population-weighted
  unmetNecessities: number; // share of necessity demand not met, averaged over the window
  laborChurn: number; // share of the workforce changing jobs per day, averaged over the window
  worstVolatility: number;
  worstOscillations: number;
  goods: GoodDiagnostics[];
}

export class Recorder {
  private readonly cells: number; // areas × goods
  private readonly logPrices: Float64Array; // ring of (window + 1) samples × cells
  private readonly unmet: Float64Array;
  private readonly churn: Float64Array;
  private readonly previousWorkers: Float64Array;
  private samples = 0;

  constructor(
    private readonly world: World,
    private readonly window = 30,
  ) {
    this.cells = world.areas.length * world.goods.length;
    this.logPrices = new Float64Array((window + 1) * this.cells);
    this.unmet = new Float64Array(window);
    this.churn = new Float64Array(window);
    this.previousWorkers = new Float64Array(this.cells);
    this.copyWorkers(this.previousWorkers);
  }

  /** Records the world as it stands; call once per tick. Assumes one tick per game day for the window. */
  sample(): void {
    const { world, cells } = this;
    const goodCount = world.goods.length;
    const slot = this.samples % (this.window + 1);
    let population = 0;
    let unmet = 0;
    let moved = 0;
    let workforce = 0;
    for (const area of world.areas) {
      population += area.population;
      unmet += area.population * (1 - area.necessitySatisfaction);
      workforce += area.population * world.config.economy.workforceShare;
      for (const good of world.goods) {
        const cell = area.id * goodCount + good.id;
        this.logPrices[slot * cells + cell] = Math.log(area.price[good.id] as number);
        moved += Math.abs((area.privateWorkers[good.id] as number) - (this.previousWorkers[cell] as number));
      }
    }
    this.copyWorkers(this.previousWorkers);
    const days = world.config.pace.gameDaysPerTick;
    this.unmet[this.samples % this.window] = population > 0 ? unmet / population : 0;
    this.churn[this.samples % this.window] = workforce > 0 ? moved / 2 / workforce / days : 0;
    this.samples++;
  }

  report(): Diagnostics {
    const { world } = this;
    const goodCount = world.goods.length;
    const changes = Math.min(this.samples - 1, this.window);
    const goods: GoodDiagnostics[] = world.goods.map((good) => ({
      key: good.key,
      volatility: 0,
      oscillations: 0,
      priceToLaborValue: 0,
    }));

    for (const area of world.areas) {
      for (const good of world.goods) {
        const cell = area.id * goodCount + good.id;
        let sum = 0;
        let sumSquares = 0;
        let direction = 0;
        let oscillations = 0;
        for (let k = changes; k >= 1; k--) {
          const change = this.logPriceAt(this.samples - k, cell) - this.logPriceAt(this.samples - k - 1, cell);
          sum += change;
          sumSquares += change * change;
          if (Math.abs(change) > OSCILLATION_THRESHOLD) {
            const sign = Math.sign(change);
            if (direction !== 0 && sign !== direction) oscillations++;
            direction = sign;
          }
        }
        const mean = changes > 0 ? sum / changes : 0;
        const volatility = changes > 1 ? Math.sqrt(Math.max(0, sumSquares / changes - mean * mean)) : 0;
        const entry = goods[good.id] as GoodDiagnostics;
        entry.volatility = Math.max(entry.volatility, volatility);
        entry.oscillations = Math.max(entry.oscillations, oscillations);
        entry.priceToLaborValue += (area.price[good.id] as number) / good.laborValue / world.areas.length;
      }
    }

    let population = 0;
    let wage = 0;
    let satisfaction = 0;
    for (const area of world.areas) {
      population += area.population;
      wage += area.population * area.wageLevel;
      satisfaction += area.population * area.satisfaction;
    }
    const filled = Math.min(this.samples, this.window);
    const average = (ring: Float64Array) =>
      filled > 0 ? ring.slice(0, filled).reduce((s, v) => s + v, 0) / filled : 0;
    return {
      day: world.gameDay,
      population,
      meanWageLevel: population > 0 ? wage / population : 0,
      meanSatisfaction: population > 0 ? satisfaction / population : 0,
      unmetNecessities: average(this.unmet),
      laborChurn: average(this.churn),
      worstVolatility: Math.max(0, ...goods.map((g) => g.volatility)),
      worstOscillations: Math.max(0, ...goods.map((g) => g.oscillations)),
      goods,
    };
  }

  private logPriceAt(sample: number, cell: number): number {
    return this.logPrices[(sample % (this.window + 1)) * this.cells + cell] as number;
  }

  private copyWorkers(into: Float64Array): void {
    const goodCount = this.world.goods.length;
    for (const area of this.world.areas) into.set(area.privateWorkers, area.id * goodCount);
  }
}

export function formatDiagnostics(d: Diagnostics): string {
  const pct = (v: number) => `${(100 * v).toFixed(2)}%`;
  const lines = [
    `day ${d.day}  population ${Math.round(d.population).toLocaleString("en")}  wage level ${d.meanWageLevel.toFixed(3)}  satisfaction ${pct(d.meanSatisfaction)}`,
    `unmet necessities ${pct(d.unmetNecessities)}  labor churn ${pct(d.laborChurn)}/day  worst volatility ${d.worstVolatility.toFixed(4)}  worst oscillations ${d.worstOscillations}`,
    `  ${"good".padEnd(22)} ${"volatility".padStart(10)} ${"oscill.".padStart(8)} ${"price/LV".padStart(9)}`,
    ...d.goods.map(
      (g) =>
        `  ${g.key.padEnd(22)} ${g.volatility.toFixed(4).padStart(10)} ${String(g.oscillations).padStart(8)} ${g.priceToLaborValue.toFixed(3).padStart(9)}`,
    ),
  ];
  return lines.join("\n");
}
