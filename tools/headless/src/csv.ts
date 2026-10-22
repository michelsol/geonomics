// Time series in long CSV format, one row per day, area and good, for plotting.
import { createWriteStream, mkdirSync, type WriteStream } from "node:fs";
import { dirname } from "node:path";
import type { World } from "@geonomics/sim";

const HEADER =
  "day,area,good,price,smoothedPrice,stock,produced,consumed,imported,exported,privateWorkers,population,wageLevel,savings,satisfaction\n";

export class CsvWriter {
  private readonly out: WriteStream;

  constructor(path: string) {
    mkdirSync(dirname(path), { recursive: true });
    this.out = createWriteStream(path);
    this.out.write(HEADER);
  }

  write(world: World): void {
    const rows: string[] = [];
    for (const area of world.areas) {
      const areaFields = `${area.population},${area.wageLevel},${area.savings},${area.satisfaction}`;
      for (const good of world.goods) {
        const g = good.id;
        rows.push(
          `${world.gameDay},${area.name},${good.key},${area.price[g]},${area.smoothedPrice[g]},${area.stock[g]},${area.produced[g]},${area.consumed[g]},${area.imported[g]},${area.exported[g]},${area.privateWorkers[g]},${areaFields}\n`,
        );
      }
    }
    this.out.write(rows.join(""));
  }

  close(): Promise<void> {
    return new Promise((resolve, reject) =>
      this.out.end((error?: Error | null) => (error ? reject(error) : resolve())),
    );
  }
}
