// Headless runner: runs a scenario with a catalog and prints the §4 diagnostics.
//   pnpm headless -- --scenario chain10 --catalog medium --days 365 --seed 1 --warmup --csv out/chain.csv
//   pnpm headless -- --all --days 200
import { parseArgs } from "node:util";
import { hashWorld, runTick, warmUp } from "@geonomics/sim";
import { CATALOG_NAMES, type CatalogName, readCatalog } from "./catalogs";
import { CsvWriter } from "./csv";
import { formatDiagnostics, Recorder } from "./diagnostics";
import { SCENARIO_NAMES, type ScenarioName, scenarios } from "./scenarios";

const { values } = parseArgs({
  args: process.argv.slice(2).filter((arg) => arg !== "--"),
  options: {
    scenario: { type: "string", default: "twoAreas" },
    catalog: { type: "string", default: "small" },
    days: { type: "string", default: "365" },
    seed: { type: "string", default: "1" },
    warmup: { type: "boolean", default: false },
    csv: { type: "string" },
    "csv-every": { type: "string", default: "1" },
    all: { type: "boolean", default: false },
    help: { type: "boolean", short: "h", default: false },
  },
});

if (values.help) {
  console.log(`Usage: pnpm headless -- [options]
  --scenario <name>   ${SCENARIO_NAMES.join(", ")} (default twoAreas)
  --catalog <name>    ${CATALOG_NAMES.join(", ")} (default small)
  --days <n>          game days to simulate after initialization (default 365)
  --seed <n>          random seed (default 1)
  --warmup            run the Rule 6 warm-up before the measured days
  --csv <file>        write per-day time series to a CSV file
  --csv-every <n>     write one CSV sample every n days (default 1)
  --all               run every scenario with every catalog and print a summary`);
  process.exit(0);
}

function choice<T extends string>(value: string, allowed: readonly T[], what: string): T {
  if (!allowed.includes(value as T))
    throw new Error(`Unknown ${what} "${value}"; expected one of ${allowed.join(", ")}`);
  return value as T;
}

interface RunOptions {
  scenario: ScenarioName;
  catalog: CatalogName;
  days: number;
  seed: number;
  warmup: boolean;
  csv?: string;
  csvEvery: number;
}

async function run(options: RunOptions) {
  const world = scenarios[options.scenario].build({ catalog: readCatalog(options.catalog), seed: options.seed });
  if (options.warmup) warmUp(world);
  const recorder = new Recorder(world);
  const csv = options.csv ? new CsvWriter(options.csv) : undefined;
  const ticks = Math.round(options.days / world.config.pace.gameDaysPerTick);
  const started = performance.now();
  for (let i = 0; i < ticks; i++) {
    runTick(world);
    recorder.sample();
    if (csv && world.tick % options.csvEvery === 0) csv.write(world);
  }
  const msPerTick = (performance.now() - started) / Math.max(ticks, 1);
  await csv?.close();
  return { world, diagnostics: recorder.report(), msPerTick };
}

const days = Number(values.days);
const seed = Number(values.seed);
if (!Number.isFinite(days) || days < 0 || !Number.isFinite(seed)) throw new Error("--days and --seed must be numbers");

if (values.all) {
  console.log(
    `${"scenario".padEnd(14)}${"catalog".padEnd(9)}${"unmet".padStart(8)}${"churn/day".padStart(11)}${"volatility".padStart(12)}${"oscill.".padStart(9)}${"wage".padStart(8)}${"ms/tick".padStart(9)}`,
  );
  for (const scenario of SCENARIO_NAMES) {
    for (const catalog of CATALOG_NAMES) {
      const { diagnostics: d, msPerTick } = await run({
        scenario,
        catalog,
        days,
        seed,
        warmup: values.warmup,
        csvEvery: 1,
      });
      console.log(
        `${scenario.padEnd(14)}${catalog.padEnd(9)}${`${(100 * d.unmetNecessities).toFixed(2)}%`.padStart(8)}${`${(100 * d.laborChurn).toFixed(3)}%`.padStart(11)}${d.worstVolatility.toFixed(4).padStart(12)}${String(d.worstOscillations).padStart(9)}${d.meanWageLevel.toFixed(3).padStart(8)}${msPerTick.toFixed(2).padStart(9)}`,
      );
    }
  }
} else {
  const scenario = choice(values.scenario, SCENARIO_NAMES, "scenario");
  const catalog = choice(values.catalog, CATALOG_NAMES, "catalog");
  const csvEvery = Math.max(1, Math.round(Number(values["csv-every"])));
  const { world, diagnostics, msPerTick } = await run({
    scenario,
    catalog,
    days,
    seed,
    warmup: values.warmup,
    csv: values.csv,
    csvEvery,
  });
  console.log(`${scenario} with the ${catalog} catalog, seed ${seed}${values.warmup ? ", after warm-up" : ""}`);
  console.log(scenarios[scenario].description);
  console.log(formatDiagnostics(diagnostics));
  console.log(`${msPerTick.toFixed(3)} ms per tick, world hash ${hashWorld(world)}`);
  if (values.csv) console.log(`time series written to ${values.csv}`);
}
