# Implementation Roadmap

This roadmap turns [specification.md](specification.md) into a playable game in twelve stages. Each stage ends with something that runs and is tested, so the work can pause after any stage without leaving loose ends.

Section numbers (§) refer to the specification.

## Ground rules

- **Simulation first, interface later.** Stages 1 to 7 build the whole simulation in `packages/sim` and check it in the headless runner. Nothing in them needs a browser.
- **Spec first for unspecified areas.** Map generation (stage 5), the interface (stage 8) and the AI (stage 10) are not yet in the specification. Each of those stages starts by writing its section and agreeing on it before any code.
- **The spec stays true.** When implementation shows that a rule must change, update the specification in the same change.
- **Determinism.** The same seed and the same command log must produce the same world, bit for bit, on the same device. From stage 3 on, a test hashes the world after N ticks and compares two runs.
- **Budgets.** One tick for 3,000 areas × 54 goods must stay under 30 ms on a desktop and 100 ms on a mid-range phone. A full snapshot plus price table must stay under 300 KB. The headless runner reports both from stage 5 on.
- **Tuning is continuous.** Every stage that touches the economy ends with a headless run of all three catalogs (`data/goods/`) and, if needed, retuned numbers.

## Workspace

| Path | Package | Holds |
| --- | --- | --- |
| `packages/sim` | `@geotrade/sim` | Data model, config, catalog loader, tick, commands, AI, map generation, save format. No browser or network dependency. |
| `packages/net` | `@geotrade/net` | PeerJS host and client, message types, snapshot and price table encoding |
| `apps/web` | `@geotrade/web` | React interface, PixiJS map, simulation worker entry point |
| `tools/headless` | `@geotrade/headless` | Node runner, diagnostics, convergence scenarios, benchmarks |
| `data/goods` | — | Goods catalogs (small, medium, large) |

Internal packages are consumed as TypeScript source (their `exports` point at `src/`), so there is no build step between packages.

| Command (repo root) | Does |
| --- | --- |
| `pnpm dev` | Starts the Vite development server for the web app |
| `pnpm build` | Builds the web app into `apps/web/dist` |
| `pnpm test` / `pnpm test:watch` | Runs every Vitest project |
| `pnpm typecheck` | Type-checks every package with TypeScript 7 |
| `pnpm lint` / `pnpm format` | Checks or fixes lint and formatting with Biome |
| `pnpm headless` | Runs the headless runner |
| `pnpm e2e` | Runs the Playwright browser tests |

---

## Stage 0: Foundations ✅

**Goal:** a workspace where building, testing, linting and deploying already work.

- Toolchain: Node 24 LTS, pnpm, TypeScript 7, Vite 8, Vitest 5, Biome, Playwright (Chromium), GitHub CLI.
- Workspace skeleton with empty entry points, CI workflow and GitHub Pages workflow.
- Economy gaps patched in the specification: total demand including inputs, input rationing, reserves for perishable goods, flow pricing for services, command validation.

**Still to do by hand:**

1. Run `gh auth login`.
2. Create the GitHub repository.
3. Rename the `master` branch to `main` (the workflows deploy from `main`).
4. Push.
5. In the repository settings, set Pages to deploy from GitHub Actions.

**Exit:** `pnpm typecheck`, `pnpm lint`, `pnpm test` and `pnpm build` pass locally and in CI.

## Stage 1: Simulation kernel

**Goal:** the static parts of the world, fully typed and tested.

- Types from §3: `World`, `Need`, `Good`, `Area`, `Edge`, `Government`, orders, armies, commands.
- `WorldConfig` with every default from §4, plus a function that builds a config from partial overrides.
- Catalog loader (§5 Goods catalogs):
  - parse JSON
  - resolve keys to ids
  - derive `isPrimary` and `isService`
  - compute `laborValue` in catalog order and `referenceUnitPrice` per need
  - reject every invalid case the specification lists
- Helpers:
  - `fractionPerTick` (§4, rule 2)
  - `reserveDaysOf`
  - a seeded random generator whose state lives in `World.randomSeed`
  - a world hash used by the determinism tests
- Per-area typed-array allocation sized by the number of goods and needs.

**Exit:**
- All three shipped catalogs load.
- About ten broken catalog fixtures are each rejected with a clear message.
- Labor values match the reference figures from the catalog validator.

## Stage 2: Scenarios and headless runner

**Goal:** a way to run and measure the economy before any map exists.

- Scenario builder: create small worlds by hand (areas, edges, natural capacities, populations), with a chosen catalog.
- Scenarios:
  - two areas with complementary resources
  - a chain of 10 areas
  - an island pair joined only by sea
  - a 100-area grid
- `tools/headless` CLI: choose a scenario, catalog, number of days and seed. It prints the §4 diagnostics (price volatility, oscillation count, unmet necessities, labor churn) and can write time series to CSV for plotting.
- World initialization following Rule 6 (§4): prices at labor value, workers placed to cover demand, starting stock and savings, initial `wageLevel`.

**Exit:** the runner prints diagnostics for every scenario, even if the economy does nothing yet.

## Stage 3: Private economy

**Goal:** the base economy runs on its own and converges (§5).

- Phase 1, production:
  - primary goods with diminishing returns and depletion
  - crafted goods with input rationing
  - services
  - `inputDemanded`
- Phase 3, consumption: purchasing power from wage level and savings, demand per need, split between substitutes, spillover, satisfaction.
- Phase 4, trade on land edges: surplus split over edges with a positive gap, the buyer's savings limit, money flows.
- Phase 6, prices: stock pressure on total demand, flow pressure for services, limits, `smoothedPrice`.
- Phase 7, labor allocation: value added, soft job choice, the shift limit, `wageLevel`.
- Phase 9, population: growth, starvation, migration, and taking lost workers from the right jobs.
- Phase 10, decay: exponential spoilage, natural capacity regeneration.
- Warm-up run (Rule 6).

**Exit:**
- The two §4 regression scenarios converge with the small catalog: the price gap settles near the transport cost within 60 days, and the 10-area chain reaches a smooth gradient within 200 days.
- Both then converge with the medium and large catalogs.
- No NaN or negative stock over 5,000 days.
- Determinism test passes.
- Substitution works: cutting fish capacity raises the bread share and keeps food satisfaction.
- Savings above target drain through imports.

## Stage 4: Sea and air routes

**Goal:** distant markets connect through routes (§5, Sea and air routes).

- Edge modes, `distance`, `capacityPerDay` and `isActive`.
- Capacity filling in order of gap per tonne.
- Air route rebuild: nearest airports plus links between hubs; dropped routes are deactivated, never deleted.
- Port and airport levels feed route capacity.
- Migration factor per mode.

**Exit:**
- In the island scenario, bulk goods travel by sea.
- With air only, light and valuable goods fly while grain and stone stay home.
- Route capacity is never exceeded.
- Rebuilding routes keeps edge ids stable.

## Stage 5: Map generation

**Spec first:** add a map generation section to the specification. It covers:
- the area count and shape, using Voronoi cells from `d3-delaunay`
- elevation and water from noise (`simplex-noise`)
- coasts and sea distance computed by a search over water cells
- terrain types that set `productivity` and land transport cost
- placing natural capacity from each primary good's `abundance`
- starting population
- land edges with `travelDays`
- sea routes and initial airports
- neutral starting state and the positions of the players' capitals

**Build:** the generator in `packages/sim`, plus a debug view in the headless runner that writes an SVG of the map.

**Exit:**
- The same seed produces the same map.
- Every land area is reachable.
- Every primary good appears somewhere.
- A 3,000-area map with the large catalog runs a tick within budget.
- The warm-up converges without collapsing any area.

## Stage 6: Government

**Goal:** players can act on the economy (§6) through commands (§3).

- Command queue, validation (§3, Command validation) and rejection reasons.
- Policies: realm defaults, area overrides, `resolvedPolicies` rebuilt only when a setting changes.
- Phase 5: taxes, collection in kind, subsidies, wages, and payments scaled down when the treasury runs short.
- Phase 2: market orders and depot transfers, including pathfinding over all edge modes.
- Phase 7 additions: hiring, quitting, firing.
- Government jobs: production, infrastructure, fortification, port, airport, research.
- Standing orders evaluated each tick.

**Exit:**
- A unit test covers every command, valid and invalid.
- Taxing without spending drains savings and imports.
- Buying in a glut and selling in a famine is profitable.
- Building infrastructure lowers transport cost step by step.

## Stage 7: War and conquest

**Goal:** war as an economic activity (§7).

- Relations, `declareWar`, peace proposals and their expiry, edge blocking.
- Armies:
  - recruiting
  - disbanding
  - marching, by sea only from an owned port and never by air
  - wages
  - upkeep
  - foraging
  - desertion
  - weapon wear
- Phase 8: combat (Lanchester model), siege progress and decay, capture with all its consequences, capital moves, elimination.

**Exit:**
- The §7 example holds within 20%: 1,000 equipped soldiers take an unfortified area of 10,000 people in about 20 days.
- Blocked edges stop trade and migration.
- Peace transfers areas and money.

## Stage 8: Web app, single player

**Spec first:** add an interface section to the specification. It covers:
- the screens: lobby, game and end-of-session
- the map layers: realms, price map, satisfaction, wage level, routes
- the panels: area, good and price table, government, policies, orders, jobs, armies, diplomacy
- the time controls
- the layout on phone and on desktop

**Build:**
- Simulation worker host loop (§9, Host loop): a fixed-rate timer, the command queue, and snapshots posted as transferable buffers.
- Zustand store fed by snapshots.
- PixiJS map: areas, borders, routes, armies; pan and zoom with mouse and touch.
- React panels that issue commands.
- uPlot charts for prices and populations.
- Price map overlay and good panel, built on the price table (§9, Price table).

**Exit:** a solo game can be played start to finish in the browser on desktop and phone, at an acceptable frame rate on a 3,000-area map.

## Stage 9: Multiplayer

**Goal:** friends join through a link (§9).

- `packages/net`:
  - PeerJS host and client wrappers
  - the message types
  - msgpack encoding
  - snapshots with per-player detail
  - the global price table quantized to `Uint16`
- Lobby, government assignment, spectators.
- Join link `#join=<peer id>`.
- `hostStatus`, pausing when the host's tab is hidden, Screen Wake Lock.
- Reconnecting after a dropped connection.

**Exit:**
- A Playwright test runs two browser contexts: one hosts, one joins, both issue commands and see each other's realms.
- Measured snapshot sizes stay within budget.

## Stage 10: AI governments

**Spec first:** add an AI section to the specification. It covers:
- the personalities: trader, builder, conqueror
- how each is built from standing orders plus a few rules (when to tax, which jobs to staff, when to declare war or propose peace)
- how often decisions run, and a limit on how much host time they may use per tick

**Build:** the AI in `packages/sim`, issuing the same commands as human players and reading only what a human player sees: its own state, public summaries and the price table.

**Exit:**
- In 2,000-day headless runs with only AI realms, every personality survives on an average map, and realms grow and trade.
- Wars start and end.

## Stage 11: Persistence, PWA and release

- Save and load with msgpack, including typed arrays and a format version. Autosave to IndexedDB, export to a file, load from a file to host a game.
- PWA: manifest, icons, offline cache (`vite-plugin-pwa`), installable on phones.
- Mobile polish: a lower default tick rate on phones, layouts that work by touch.
- Release: the GitHub Pages workflow deploys `main`; add a short player guide.

**Exit:**
- Saving, reloading and replaying the same commands reproduces the same world hash.
- The PWA installs and starts offline on Android and iOS.
- The game is live on GitHub Pages.

---

## Open questions to settle along the way

| Question | Settle by |
| --- | --- |
| How many areas and governments a default map has, and how big an area is in population | Stage 5 |
| Whether players start with a single area or a small realm, and with how much treasury | Stage 5 |
| Whether there is a soft goal (score, prosperity ranking) despite sandbox-first | Stage 8 |
| Whether a dropped human player's government is handed to the AI | Stage 9 |
| Naval combat and blockades on sea routes (listed as future work in §5) | After stage 11 |
| Research gating modern recipes from the large catalog | After stage 11 |
