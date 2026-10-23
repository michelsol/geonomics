// Headless runner: runs a scenario with a catalog and prints the §4 diagnostics.
//   pnpm headless -- --scenario chain10 --catalog medium --days 365 --seed 1 --warmup --csv out/chain.csv
//   pnpm headless -- --all --days 200
//   pnpm headless -- --scenario map --catalog large --areas 3000 --days 30 --svg out/map.svg
//   pnpm headless -- --ai balanced --catalog medium --areas 1000 --realms 8 --days 2000 --seed 1
import { parseArgs } from "node:util";
import { type AiMix, hashWorld, runTick, warmUp } from "@geonomics/sim";
import { formatProgress, runAiGame } from "./aiGame";
import { CATALOG_NAMES, type CatalogName, readCatalog } from "./catalogs";
import { CsvWriter } from "./csv";
import { formatDiagnostics, Recorder } from "./diagnostics";
import { SCENARIO_NAMES, type ScenarioName, scenarios } from "./scenarios";
import { writeMapSvg } from "./svg";

const { values } = parseArgs({
  args: process.argv.slice(2).filter((arg) => arg !== "--"),
  options: {
    scenario: { type: "string", default: "twoAreas" },
    catalog: { type: "string", default: "small" },
    days: { type: "string", default: "365" },
    seed: { type: "string", default: "1" },
    areas: { type: "string" },
    svg: { type: "string" },
    warmup: { type: "boolean", default: false },
    csv: { type: "string" },
    "csv-every": { type: "string", default: "1" },
    all: { type: "boolean", default: false },
    ai: { type: "string" },
    realms: { type: "string", default: "8" },
    help: { type: "boolean", short: "h", default: false },
  },
});

if (values.help) {
  console.log(`Usage: pnpm headless -- [options]
  --scenario <name>   ${SCENARIO_NAMES.join(", ")} (default twoAreas)
  --catalog <name>    ${CATALOG_NAMES.join(", ")} (default small)
  --days <n>          game days to simulate after initialization (default 365)
  --seed <n>          random seed (default 1)
  --areas <n>         number of areas of the map scenario (default 1000)
  --svg <file>        write the map as an SVG after the run (map scenario)
  --warmup            run the Rule 6 warm-up before the measured days
  --csv <file>        write per-day time series to a CSV file
  --csv-every <n>     write one CSV sample every n days (default 1)
  --all               run every scenario with every catalog and print a summary
  --ai <mix>          an AI-only game on a generated map: balanced, peaceful or aggressive (with --areas, --realms)
  --realms <n>        realms founded for --ai (default 8)`);
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
  areas?: number;
  csv?: string;
  csvEvery: number;
}

async function run(options: RunOptions) {
  const config = options.areas ? { map: { landAreaCount: options.areas } } : undefined;
  const world = scenarios[options.scenario].build({
    catalog: readCatalog(options.catalog),
    seed: options.seed,
    config,
  });
  if (options.warmup) warmUp(world);
  const recorder = new Recorder(world);
  const csv = options.csv ? new CsvWriter(options.csv) : undefined;
  const ticks = Math.round(options.days / world.config.pace.gameDaysPerTick);
  let tickTime = 0;
  for (let i = 0; i < ticks; i++) {
    const started = performance.now();
    runTick(world);
    tickTime += performance.now() - started;
    recorder.sample();
    if (csv && world.tick % options.csvEvery === 0) csv.write(world);
  }
  const msPerTick = tickTime / Math.max(ticks, 1);
  await csv?.close();
  return { world, diagnostics: recorder.report(), msPerTick };
}

const days = Number(values.days);
const areas = values.areas === undefined ? undefined : Number(values.areas);
const seed = Number(values.seed);
if (!Number.isFinite(days) || days < 0 || !Number.isFinite(seed)) throw new Error("--days and --seed must be numbers");

if (values.ai !== undefined) {
  const mix = choice(values.ai, ["balanced", "peaceful", "aggressive"] as const, "AI mix") as AiMix;
  const catalog = choice(values.catalog, CATALOG_NAMES, "catalog");
  const realms = Number(values.realms);
  console.log(`AI-only game: ${mix} mix, ${realms} realms, ${areas ?? 1000} areas, ${catalog} catalog, seed ${seed}`);
  let startPopulation: number | undefined;
  const report = runAiGame({
    catalog: readCatalog(catalog),
    areas: areas ?? 1000,
    realms,
    mix,
    days,
    seed,
    onProgress: (p) => console.log(formatProgress(p, startPopulation)),
  });
  startPopulation = report.startPopulation;
  console.log(formatProgress(report, report.startPopulation));
  for (const r of report.realms)
    console.log(
      `  ${r.name.padEnd(18)}${r.personality.padEnd(11)}${(r.alive ? "alive" : "fallen").padEnd(8)}areas ${String(r.startAreas).padStart(4)} → ${String(r.areas).padStart(4)}  population ${Math.round(r.startPopulation).toLocaleString("en").padStart(10)} → ${Math.round(r.population).toLocaleString("en").padStart(10)}`,
    );
  console.log(
    `trade ${Math.round(report.startTonnage).toLocaleString("en")} → ${Math.round(report.tonnage).toLocaleString("en")} t/day; longest war ${report.longestWarDays} days; AI ${report.aiMsPerTick.toFixed(3)} ms per tick (max ${report.aiMsPerTickMax.toFixed(1)}), tick ${report.msPerTick.toFixed(2)} ms; ${report.rejectedCommands} AI commands rejected`,
  );
} else if (values.all) {
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
    areas,
    csv: values.csv,
    csvEvery,
  });
  console.log(`${scenario} with the ${catalog} catalog, seed ${seed}${values.warmup ? ", after warm-up" : ""}`);
  console.log(scenarios[scenario].description);
  console.log(formatDiagnostics(diagnostics));
  console.log(
    `${world.areas.length} areas, ${world.edges.length} edges, ${msPerTick.toFixed(3)} ms per tick, price table ${((world.areas.length * world.goods.length * 2) / 1024).toFixed(0)} KB, world hash ${hashWorld(world)}`,
  );
  if (values.csv) console.log(`time series written to ${values.csv}`);
  if (values.svg) {
    writeMapSvg(world, values.svg);
    console.log(`map written to ${values.svg}`);
  }
}
