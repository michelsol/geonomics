# Geographic Economics Sandbox — Design Specification

## 1. Overview

A real-time sandbox where players run governments over regions of a map of areas, on top of a lightweight economy that runs by itself. Each area produces, consumes, trades, sets prices, allocates labor and grows or shrinks its population every tick. Governments act on that economy through taxes, subsidies, market orders, employment and war.

The game runs in a browser, on desktop or mobile. The first human player hosts the game and runs the simulation; other humans join through a link, and AI governments run on the host.

### Design principles

- **Areas, not individuals.** Each area is simulated as a whole. Inhabitants are a number, not agents.
- **One feedback loop drives everything.** Prices signal scarcity, labor moves toward the jobs that add the most value, and goods flow from cheap areas to expensive ones.
- **Cheap per tick.** Cost is roughly proportional to (areas + edges) × goods. A few thousand areas must run comfortably on a phone.
- **The government is a separate actor.** The base economy runs with no players at all. Human and AI governments use the same command interface.
- **Open prices.** Every player, human or AI, sees the current price of every good in every area. Stocks, flows and government internals stay private. Markets themselves stay local: an area trades only with the areas its edges connect it to.
- **Stability before realism.** Every adjustment is damped, bounded and scaled by global pace parameters (section 4).
- **Sandbox first.** There is no mandatory win condition; goals can be layered on later.

## 2. Core concepts

All values are measured in **man-hours**: one hour of work at the reference level of technology. This anchors every price to labor and gives a natural measure of prosperity.

### Labor value

The labor value of a good is the man-hours embodied in one unit, inputs included. It is computed once at startup, in recipe order:

```latex
\text{laborValue}(g) = \text{laborHoursPerUnit}(g) + \sum_{i \in \text{inputs}(g)} \text{quantity}_i \times \text{laborValue}(i)
```

Labor value is the starting price of every good and the reference for price bounds and demand elasticity. Market prices then float around it according to local scarcity.

### Value added and wage level

A worker's **value added** is the market value of what they produce, minus the value of the inputs used, per hour worked. An area's **wage level** is the average value added per worker-hour across its private workers.

A wage level above 1 means local labor is worth more than the reference: good resources, good trade access or scarce products. This is the main prosperity indicator shown to players.

### Money circulation

An area's **savings** is the private money held by its inhabitants. Transactions inside an area cancel out, so savings change only through flows that cross the area's boundary:

| Flow | Direction | When |
| --- | --- | --- |
| Exports to neighbors | Into savings | Trade phase |
| Imports from neighbors | Out of savings | Trade phase |
| Taxes | Savings to treasury | Tax phase |
| Subsidies | Treasury to savings | Tax phase |
| Government and army wages | Treasury to savings | Tax phase |
| Government purchases on the local market | Treasury to savings | Market phase |
| Government sales on the local market | Savings to treasury | Market phase |

Taxing without spending drains an area's savings, so it can no longer import. This is intended: it is the natural cost of over-taxation.

Savings also feed back into demand: an area holding more than its target savings spends more, mostly on comforts and luxuries, and an area with depleted savings cuts back (section 5, Consumption). This pulls savings back toward the target through trade.

When savings cannot cover a tax bill, the shortfall is collected **in kind**. Goods move from the area's stock to the government depot, valued at local prices.

### Time

The simulation advances in **ticks**. Each tick represents a fixed amount of game time (`gameDaysPerTick`), and every rate in the configuration is expressed per game day. Wall-clock speed only changes how many ticks run per second, never the results (section 4).

## 3. Data model

The world is plain serializable data, owned by the simulation worker on the host. Per-good values are stored as `Float64Array`s indexed by `GoodId`, so each phase is a tight loop over typed arrays. `WorldConfig` is defined in section 4.

### Identifiers and world

```typescript
type GoodId = number;        // index into World.goods
type NeedId = number;        // index into World.needs
type AreaId = number;        // index into World.areas
type EdgeId = number;        // index into World.edges
type GovernmentId = number;  // index into World.governments
type ArmyId = number;        // unique id of an army, never reused
type PlayerId = string;      // PeerJS peer id of a connected human player

interface World {
  tick: number;                         // number of ticks simulated since the game started
  gameDay: number;                      // elapsed game time in days (sum of gameDaysPerTick over all ticks)
  config: WorldConfig;                  // all tunable parameters, including pace (section 4)
  needs: Need[];                        // needs of the population, each satisfied by one or more goods
  goods: Good[];                        // catalog of goods, sorted so that every input comes before its outputs
  areas: Area[];                        // every area on the map
  edges: Edge[];                        // every connection between two areas
  governments: Government[];            // every government, human or AI, including eliminated ones
  armies: Map<ArmyId, Army>;            // every army currently in the field
  relations: Relation[][];              // relations[a][b]: diplomatic state between governments a and b (symmetric)
  peaceProposals: PeaceProposal[];      // peace offers waiting for an answer
  nextArmyId: ArmyId;                   // next id to assign to a newly recruited army
  nextOrderId: number;                  // next id to assign to a market or standing order
  randomSeed: number;                   // state of the seeded random generator, so runs are reproducible
}

type Relation = "peace" | "war";
```

### Needs and goods

Inhabitants demand **needs**, not goods. A need such as food or energy can be satisfied by several goods, which then compete as substitutes: when bread is expensive, people eat more fish. Goods that satisfy no need, such as ore or flour, are only used as inputs.

```typescript
type DemandTier = "necessity" | "comfort" | "luxury";

interface Need {
  id: NeedId;                           // index of this need in World.needs
  key: string;                          // stable identifier used in catalog files, for example "food"
  name: string;                         // display name, for example "Food"
  unit: string;                         // what one need unit represents, for display only, for example "2,000 kcal"
  tier: DemandTier;                     // importance of the need
  demandPerPersonPerDay: number;        // need units one inhabitant wants per game day at reference prices
  priceElasticity: number;              // how fast demand falls as the need's price rises above reference (0 = rigid)
  wealthElasticity: number;             // how fast demand rises with purchasing power (luxuries > 0)
  substitutionElasticity: number;       // how strongly consumers switch to the cheaper goods of this need
  referenceUnitPrice: number;           // derived at startup: price of one need unit when all prices equal labor value
}

interface NeedSatisfaction {
  need: NeedId;                         // need this good satisfies
  unitsPerGood: number;                 // need units provided by one unit of the good
  preference: number;                   // relative share of consumption when unit prices are equal
}

interface RecipeInput {
  good: GoodId;                         // input good consumed by the recipe
  quantity: number;                     // units of the input consumed per unit of output
}

interface Good {
  id: GoodId;                           // index of this good in World.goods
  key: string;                          // stable identifier used in catalog files, for example "bread"
  name: string;                         // display name, for example "Bread"
  unit: string;                         // what one unit represents, for display only, for example "kg"
  laborHoursPerUnit: number;            // worker-hours to produce one unit at productivity 1
  inputs: RecipeInput[];                // goods consumed per unit produced; empty for primary goods
  isPrimary: boolean;                   // extracted from nature, limited by an area's natural capacity
  isService: boolean;                   // cannot be stored or transported: produced and consumed in the same tick
  transportWeight: number;              // tonnes of freight per unit, bulk included; multiplies an edge's cost per tonne
  spoilageRatePerDay: number;           // decay rate of stored units: stock *= exp(-spoilageRatePerDay * days)
  depletionPerUnitExtracted: number;    // primary goods: natural capacity lost per unit extracted (0 = renewable)
  regenerationRatePerDay: number;       // primary goods: share of lost capacity recovered per game day
  abundance: "common" | "regional" | "rare" | null; // primary goods: how widely map generation spreads capacity
  satisfies: NeedSatisfaction | null;   // need this good is consumed for; null for pure inputs
  laborValue: number;                   // derived at startup: man-hours embodied in one unit, inputs included
}
```

### Areas and edges

```typescript
interface Area {
  id: AreaId;                           // index of this area in World.areas
  name: string;                         // display name
  position: { x: number; y: number };   // map coordinates, used only for rendering
  owner: GovernmentId | null;           // ruling government, or null for a neutral area
  edges: EdgeId[];                      // connections to neighboring areas

  population: number;                   // inhabitants, soldiers excluded
  savings: number;                      // private money held by the inhabitants, in man-hours
  productivity: number;                 // local multiplier on labor output (terrain, local know-how)
  unemployedWorkers: number;            // workers without a private or government job
  fortificationLevel: number;           // defensive multiplier built by government fortification jobs
  isCoastal: boolean;                   // set by map generation: the area touches navigable water
  portLevel: number;                    // 0 = no port; raises the capacity of the area's sea routes
  portProgress: number;                 // worker-days accumulated toward the next port level
  airportLevel: number;                 // 0 = no airport; raises the capacity of the area's air routes
  airportProgress: number;              // worker-days accumulated toward the next airport level
  siegeProgress: number;                // 0 to 1; the area changes owner when it reaches 1
  besiegingGovernment: GovernmentId | null; // government currently besieging the area, if any

  // Per-good arrays, indexed by GoodId
  stock: Float64Array;                  // units stored privately, available to consume or export
  price: Float64Array;                  // current local market price, in man-hours per unit
  smoothedPrice: Float64Array;          // slow moving average of price, used for job decisions (section 4)
  privateWorkers: Float64Array;         // workers employed in private production of each good
  naturalCapacity: Float64Array;        // primary goods: current maximum extraction per day (0 otherwise)
  naturalCapacityMaximum: Float64Array; // primary goods: capacity the area recovers toward

  // Per-tick results, recomputed every tick, read by the UI and the AI
  produced: Float64Array;               // units produced this tick, private and government combined
  demanded: Float64Array;               // units the population wanted to consume this tick
  inputDemanded: Float64Array;          // units private production requested as inputs this tick, before rationing
  consumed: Float64Array;               // units actually consumed this tick
  imported: Float64Array;               // units received from neighbors this tick
  exported: Float64Array;               // units sent to neighbors this tick
  outputLimitedByInputs: Uint8Array;    // 1 if production of the good was capped by missing inputs this tick
  needDemanded: Float64Array;           // per NeedId: need units the population wanted this tick
  needConsumed: Float64Array;           // per NeedId: need units actually consumed, substitutes included
  satisfaction: number;                 // 0 to 1: tier-weighted share of need demand that was met
  necessitySatisfaction: number;        // 0 to 1: share of necessity need demand that was met
  wageLevel: number;                    // average value added per private worker-hour, in man-hours
}

type EdgeMode = "land" | "sea" | "air";

interface Edge {
  id: EdgeId;                           // index of this edge in World.edges
  mode: EdgeMode;                       // land border, sea route between two ports, or air route between two airports
  areaA: AreaId;                        // first connected area (edges are undirected)
  areaB: AreaId;                        // second connected area
  distance: number;                     // map distance; sea routes use the distance over water
  baseTransportCost: number;            // man-hours to move one tonne across, before infrastructure
  transportCost: number;                // current cost, lowered by infrastructure work (land only)
  infrastructureProgress: number;       // worker-days of road building accumulated toward the next step (land only)
  capacityPerDay: number;               // largest tonnage carried per game day in each direction; Infinity on land
  travelDays: number;                   // game days an army needs to cross this edge; Infinity on air routes
  isActive: boolean;                    // false for an air route dropped by a rebuild; edges are never deleted
  isBlocked: boolean;                   // recomputed each tick: true when war or a siege stops all traffic
}
```

Land edges join neighboring areas and never change. Sea and air edges are **routes**: map generation creates the sea routes, and air routes are rebuilt when airports open or grow (section 5, Sea and air routes). Every system that walks edges, including trade, migration, depot transfers and marching, handles all three modes the same way, apart from the rules listed for each mode. `Area.edges` lists edges of all modes.

### Governments

```typescript
type GovernmentJob =
  | { kind: "produce"; good: GoodId }               // state production; output goes to the local depot
  | { kind: "buildInfrastructure"; edge: EdgeId }   // lowers the transport cost of an adjacent edge
  | { kind: "fortify" }                             // raises the area's fortification level
  | { kind: "buildPort" }                           // coastal areas only: raises the area's port level
  | { kind: "buildAirport" }                        // raises the area's airport level
  | { kind: "research" };                           // raises the realm-wide productivity bonus

interface JobAssignment {
  job: GovernmentJob;                   // what these workers do
  targetWorkers: number;                // number of workers the player wants in this job
  workers: number;                      // workers actually employed; moves toward the target with inertia
}

type PolicyName =
  | "productionTaxRate"                 // per good: share of production value taxed; negative = subsidy
  | "consumptionTaxRate"                // per good: share added to the price consumers pay
  | "importTariffRate"                  // per good: share of the price charged on goods entering across a border
  | "exportTariffRate"                  // per good: share of the price charged on goods leaving across a border
  | "headTaxPerPersonPerDay"            // per area: flat tax per inhabitant per game day, in man-hours
  | "priceCeiling"                      // per good: maximum allowed local price
  | "priceFloor";                       // per good: minimum allowed local price

interface PolicySetting {
  policy: PolicyName;                   // which policy this sets
  good: GoodId | null;                  // the good it applies to; null for per-area policies like head tax
  value: number | null;                 // the rate or price; null removes a ceiling or floor
}

interface ResolvedPolicies {            // flat arrays used by the tick; rebuilt only when a setting changes
  productionTaxRate: Float64Array;      // per good, realm default merged with area overrides
  consumptionTaxRate: Float64Array;     // per good
  importTariffRate: Float64Array;       // per good
  exportTariffRate: Float64Array;       // per good
  headTaxPerPersonPerDay: number;       // for this area
  priceCeiling: Float64Array;           // per good; Infinity when there is no ceiling
  priceFloor: Float64Array;             // per good; 0 when there is no floor
}

interface GovernmentAreaState {
  depot: Float64Array;                  // goods owned by the government in this area, indexed by GoodId
  jobs: JobAssignment[];                // government jobs in this area
  wageOffer: number;                    // wage paid per worker-hour, in man-hours (1 = reference wage)
  policyOverrides: PolicySetting[];     // exceptions to the realm defaults for this area
  resolvedPolicies: ResolvedPolicies;   // realm defaults merged with overrides, ready for the tick
}

interface Government {
  id: GovernmentId;                     // index of this government in World.governments
  name: string;                         // display name of the realm
  color: string;                        // map color of the realm
  controller:                           // who issues this government's commands
    | { kind: "human"; player: PlayerId }
    | { kind: "ai"; personality: string };
  capital: AreaId | null;               // capital area; null once the government is eliminated
  isEliminated: boolean;                // true once the government owns no area
  treasury: number;                     // government money for the whole realm, in man-hours
  ownedAreas: AreaId[];                 // cache of the areas whose owner is this government
  areaStates: Map<AreaId, GovernmentAreaState>; // depot, jobs, wage and policies per owned area
  realmPolicies: PolicySetting[];       // default policies applied to every owned area
  marketOrders: MarketOrder[];          // open buy and sell orders
  standingOrders: StandingOrder[];      // automation rules evaluated every tick
  depotTransfers: DepotTransfer[];      // goods travelling between the government's own depots
  researchLevel: number;                // realm-wide productivity bonus level
  researchProgress: number;             // worker-days accumulated toward the next research level
}

interface MarketOrder {
  id: number;                           // unique id, used to cancel the order
  area: AreaId;                         // owned area whose market the order trades on
  good: GoodId;                         // good to buy or sell
  side: "buy" | "sell";                 // buy into the depot, or sell from it
  remainingQuantity: number;            // units still to trade before the order completes
  limitPrice: number;                   // buy: highest price accepted; sell: lowest price accepted
  maximumQuantityPerDay: number;        // pacing cap, so one order cannot empty a market in a single tick
}

interface DepotTransfer {
  good: GoodId;                         // good being moved
  quantity: number;                     // units in transit (spoil on the way)
  destination: AreaId;                  // depot the goods are delivered to
  daysRemaining: number;                // game days until arrival
}

type StandingRule =
  | { kind: "keepDepotStock"; good: GoodId; targetDaysOfDemand: number; maximumBuyPrice: number }
      // buy until the depot holds this many days of the area's total demand (consumers and producers)
  | { kind: "sellAbovePrice"; good: GoodId; minimumPrice: number; keepDaysOfDemand: number }
      // sell depot surplus above this many days of total demand whenever the price exceeds the minimum
  | { kind: "buyBelowPrice"; good: GoodId; maximumPrice: number; maximumDepotQuantity: number }
      // stockpile whenever the price is low
  | { kind: "supplyArmies"; good: GoodId; daysOfSupply: number };
      // refill armies standing in these areas from the local depot

interface StandingOrder {
  id: number;                           // unique id, used to remove the rule
  areas: AreaId[] | "all";              // areas the rule applies to
  rule: StandingRule;                   // what the rule does
}
```

### Armies and diplomacy

```typescript
type ArmyLocation =
  | { kind: "area"; area: AreaId }                                  // standing in an area
  | { kind: "edge"; edge: EdgeId; from: AreaId; daysTravelled: number }; // marching along an edge

interface Army {
  id: ArmyId;                           // unique id
  owner: GovernmentId;                  // government the army belongs to
  location: ArmyLocation;               // where the army is now
  path: AreaId[];                       // remaining areas to march through, in order
  soldiers: number;                     // number of soldiers
  food: number;                         // units of the food good carried
  weapons: number;                      // units of the weapons good carried
  stance: "hold" | "attack";            // hold: defend only; attack: engage enemies and besiege
}

interface PeaceProposal {
  id: number;                           // unique id, used to answer the proposal
  from: GovernmentId;                   // proposing government
  to: GovernmentId;                     // government asked to accept
  areaTransfers: { area: AreaId; newOwner: GovernmentId }[]; // areas changing hands if accepted
  payment: number;                      // money paid by the proposer to the other side (negative = demanded)
  expiresAtDay: number;                 // game day after which the proposal is discarded
}
```

### Commands

Players and AI act only through commands. The host queues them and applies them at the start of the next tick.

```typescript
type Command =
  | { type: "setRealmPolicy"; setting: PolicySetting }
  | { type: "setAreaPolicy"; area: AreaId; setting: PolicySetting }
  | { type: "clearAreaPolicy"; area: AreaId; policy: PolicyName; good: GoodId | null }
  | { type: "placeMarketOrder"; order: Omit<MarketOrder, "id"> }
  | { type: "cancelMarketOrder"; orderId: number }
  | { type: "transferGoods"; from: AreaId; to: AreaId; good: GoodId; quantity: number }
  | { type: "setJobTarget"; area: AreaId; job: GovernmentJob; targetWorkers: number }
  | { type: "setWageOffer"; area: AreaId; wageOffer: number }
  | { type: "recruitArmy"; area: AreaId; soldiers: number }
  | { type: "disbandArmy"; army: ArmyId; soldiers: number }
  | { type: "moveArmy"; army: ArmyId; destination: AreaId }
  | { type: "setArmyStance"; army: ArmyId; stance: "hold" | "attack" }
  | { type: "supplyArmy"; army: ArmyId; food: number; weapons: number } // load from the local depot
  | { type: "declareWar"; target: GovernmentId }
  | { type: "proposePeace"; proposal: Omit<PeaceProposal, "id"> }
  | { type: "answerPeace"; proposalId: number; accept: boolean }
  | { type: "addStandingOrder"; order: Omit<StandingOrder, "id"> }
  | { type: "removeStandingOrder"; orderId: number };

interface CommandEnvelope {
  player: PlayerId;                     // sender, checked against the government's controller
  government: GovernmentId;             // government the command acts for
  command: Command;                     // the action itself
}
```

Host-only controls (pause, speed, save) are network messages, not simulation commands, so they never touch the world state.

### Command validation

The host validates every command before applying it. A rejected command changes nothing and is answered with a `commandRejected` message giving the reason.

| Check | Rule |
| --- | --- |
| Sender | `player` must be the controller of `government`, and the government must not be eliminated |
| Ownership | Every area, army, order or depot a command references must belong to the sending government |
| Numbers | Every number must be finite; quantities, worker targets, soldiers and prices must be ≥ 0 |
| Tax rates | Production and consumption tax rates and tariffs must be within [−1, 5] |
| Wages | `wageOffer` must be within [0, 10] |
| Recruiting | Soldiers must not exceed the area's unemployed and private workers |
| Jobs | `buildPort` only in coastal areas; `buildInfrastructure` only on an edge touching the area |
| Transfers | Source and destination depots must be connected by a non-blocked path |
| Diplomacy | No war on oneself; peace only with a government at war; a payment must fit in the payer's treasury when the proposal is answered |
| Limits | At most 1,000 open market orders and 200 standing orders per government, so a client cannot slow the host down |

## 4. Pace, stability and convergence

Instability comes from feedback loops that overshoot: prices jump, too many workers switch, supply crashes, and the cycle repeats. Six rules prevent it, and three global pace parameters let a game run calmer or faster without retuning anything.

### Rule 1: two separate clocks

- `maxTicksPerSecond` is the **wall-clock** speed of the host loop. Changing it (pause, 1×, 5×) never changes results, only how fast they arrive.
- `gameDaysPerTick` is the **game time** each tick represents. Every rate in the configuration is per game day and is scaled by it.

### Rule 2: rates become fractions through an exponential

Every "move toward a target" update uses a fraction derived from a rate per day:

```latex
\text{fraction} = 1 - e^{-\text{rate} \times \text{responsiveness} \times \text{gameDaysPerTick}}
```

The update is then `value += fraction × (target − value)`. The fraction always stays between 0 and 1, so the value can never jump past its target, whatever the tick length or responsiveness. Prices use the multiplicative form `price × e^(clamped change)` for the same reason.

Write this once as a helper, `fractionPerTick(ratePerDay, responsiveness)`, and use it everywhere.

### Rule 3: separate the time scales

Each loop must react at least three times slower than the loop it depends on. Fast loops settle before slow loops act on them.

| Loop | Parameter | Default half-life |
| --- | --- | --- |
| Prices | `priceAdjustmentRatePerDay` | 2 days |
| Trade flows | `tradeRatePerDay` | 3 days |
| Smoothed price used for jobs | `priceSmoothingRatePerDay` | 10 days |
| Private job allocation | `laborMobilityRatePerDay` | 20 days |
| Migration | `migrationRatePerDay` | about 70 days |
| Population growth | `growthRatePerDay` | about 19 years to double |

A rate from a half-life: `rate = ln(2) / halfLifeDays`.

### Rule 4: decide jobs on smoothed prices

Workers choose jobs from `smoothedPrice`, a slow moving average, not from the current price. This breaks the classic cobweb cycle, where a one-day price spike pulls in workers who then flood the market.

### Rule 5: hard limits per tick

Even with damping, a guard rail catches surprises:

- A price changes by at most `maxPriceChangePerTick` (default 10%) in one tick.
- Prices stay between `priceFloorMultiple` and `priceCeilingMultiple` times the labor value (defaults 0.1 and 10).
- At most `maxLaborShiftPerTick` of a workforce (default 2%) changes jobs in one tick.
- Stocks, savings, depots and populations are clamped at zero; every division uses a small epsilon.

### Rule 6: start near equilibrium, then warm up

A game starts from a state that is already almost balanced:

1. Prices start at labor value; smoothed prices equal prices.
2. Workers are allocated to cover local demand where local resources allow, and the rest go to the most valuable local jobs.
3. Each area starts with `reserveDaysOf(good)` of total demand in stock.
4. Each area starts with `targetSavingsDays` of income in savings, so savings neither boost nor dampen demand at first.
5. Value added and `wageLevel` are computed once from these starting prices and workers, so the first tick has valid purchasing power and labor targets.
6. The world then runs `warmupDays` with no players, at `warmupResponsivenessBoost` times the normal responsiveness, before the game opens.

### Global pace parameters

Three multipliers change the feel of a game without touching individual rates:

- `economyResponsiveness` scales prices, trade, smoothing and labor. Lower is calmer and more stable; higher is snappier.
- `demographyResponsiveness` scales population growth, starvation and migration.
- `militaryResponsiveness` scales marching, combat and sieges.

To speed up a whole game, raise `gameDaysPerTick` or `maxTicksPerSecond`. To make the economy react faster relative to game time, raise `economyResponsiveness`. Rule 2 keeps both safe.

### Diagnostics

A headless runner (Node) simulates thousands of days and reports, per area and good:

- **Price volatility:** standard deviation of daily log price changes over the last 30 days.
- **Oscillation count:** number of times the direction of a price changes over the last 30 days.
- **Unmet necessities:** share of necessity demand not met.
- **Labor churn:** share of the workforce changing jobs per day.

Two regression scenarios must converge: two areas with complementary resources (price gap settles near transport cost within 60 days), and a 10-area chain (prices settle along a smooth gradient within 200 days).

### WorldConfig

Defaults are starting points for tuning in the headless runner.

```typescript
interface WorldConfig {
  pace: {
    maxTicksPerSecond: number;          // wall-clock cap of the host loop; lower on mobile (default 10)
    gameDaysPerTick: number;            // game days simulated per tick (default 1)
    economyResponsiveness: number;      // multiplier on price, trade, smoothing and labor rates (default 1)
    demographyResponsiveness: number;   // multiplier on growth, starvation and migration rates (default 1)
    militaryResponsiveness: number;     // multiplier on marching, combat and siege rates (default 1)
  };
  economy: {
    hoursPerWorkerDay: number;          // hours worked per worker per game day (default 8)
    workforceShare: number;             // share of the population able to work (default 0.5)
    reserveDays: number;                // days of total demand an area keeps in stock before exporting (default 5)
    maxReserveSpoilageShare: number;    // perishable goods keep a smaller reserve, so spoilage stays under this share of demand (default 0.1)
    priceAdjustmentRatePerDay: number;  // speed at which prices move toward clearing the stock target (default 0.35)
    priceSmoothingRatePerDay: number;   // speed of the smoothed price used for job decisions (default 0.07)
    tradeRatePerDay: number;            // share of exportable surplus that may leave per day (default 0.23)
    tradeGapSensitivity: number;        // trade volume grows with the relative price gap up to this factor (default 2)
    laborMobilityRatePerDay: number;    // speed at which private workers move toward the target allocation (default 0.035)
    laborAllocationTemperature: number; // softness of job choice, relative to wage level; lower = winner takes all (default 0.15)
    maxPriceChangePerTick: number;      // largest relative price change in one tick (default 0.1)
    maxLaborShiftPerTick: number;       // largest share of a workforce changing jobs in one tick (default 0.02)
    priceFloorMultiple: number;         // lowest price as a multiple of labor value (default 0.1)
    priceCeilingMultiple: number;       // highest price as a multiple of labor value (default 10)
    tierWeights: { necessity: number; comfort: number; luxury: number }; // weights in satisfaction (default 3, 2, 1)
    targetSavingsDays: number;          // days of income inhabitants like to hold; neutral point of the savings effect (default 30)
    savingsElasticity: number;          // how strongly savings above or below target change purchasing power (default 0.5)
    savingsFactorMin: number;           // lower clamp of savings relative to target (default 0.25)
    savingsFactorMax: number;           // upper clamp of savings relative to target (default 4)
  };
  transport: {                          // distances in map units; neighboring areas are about 100 apart (read as km)
    landCostPerDistance: number;        // map generation: base land cost per tonne per unit of distance, before terrain (default 0.003)
    seaCostPerDistance: number;         // man-hours per tonne per unit of sea distance (default 0.0004)
    airBaseCost: number;                // man-hours per tonne per flight, whatever the distance (default 3)
    airCostPerDistance: number;         // man-hours per tonne per unit of distance flown (default 0.02)
    seaRoutesPerPort: number;           // map generation links each port to this many nearest ports by sea (default 4)
    airRoutesPerAirport: number;        // each airport links to this many nearest airports (default 3)
    seaCapacityPerPortLevel: number;    // tonnes per day per direction on a sea route, per level of its smaller port (default 1000)
    airCapacityPerAirportLevel: number; // tonnes per day per direction on an air route, per level of its smaller airport (default 20)
    portWorkerDaysPerLevel: number;     // work needed per port level (default 4000)
    airportWorkerDaysPerLevel: number;  // work needed per airport level (default 6000)
    maximumPortLevel: number;           // highest port level (default 3)
    maximumAirportLevel: number;        // highest airport level; airports at this level link to each other as hubs (default 3)
    initialAirportShare: number;        // share of the most populous areas given an airport of level 1 at start (default 0.05)
    seaTravelDaysPerDistance: number;   // game days an army needs per unit of sea distance (default 0.01)
    migrationFactorBySea: number;       // migration over a sea route, relative to a land edge (default 0.5)
    migrationFactorByAir: number;       // migration over an air route, relative to a land edge (default 0.25)
  };
  population: {
    growthRatePerDay: number;           // relative growth per day at full necessity satisfaction (default 0.0001)
    starvationRatePerDay: number;       // relative decline per day when no necessity is met (default 0.003)
    growthSatisfactionThreshold: number;// necessity satisfaction above which population grows (default 0.9)
    migrationRatePerDay: number;        // share of the attractiveness gap that migrates per day (default 0.01)
    migrationWageWeight: number;        // weight of wage level versus satisfaction in attractiveness (default 0.5)
  };
  government: {
    hiringRatePerDay: number;           // share of the gap to target government jobs filled per day (default 0.1)
    quitRatePerDay: number;             // quitting speed per unit of wage shortfall or unpaid share (default 0.1)
    infrastructureWorkerDaysPerStep: number;  // road work needed for one transport cost step (default 2000)
    infrastructureStepFactor: number;   // transport cost multiplier per step (default 0.9)
    minimumTransportCostFactor: number; // transport cost never falls below this share of base (default 0.3)
    fortificationWorkerDaysPerLevel: number;  // work needed per fortification level (default 3000)
    maximumFortificationLevel: number;  // highest fortification level (default 3)
    researchWorkerDaysPerLevel: number; // work needed per research level (default 10000)
    researchProductivityBonus: number;  // productivity added per research level (default 0.05)
  };
  network: {
    priceTableRate: number;             // global price table broadcasts per wall-clock second (default 1)
    snapshotRate: number;               // snapshots per wall-clock second for owned areas and the viewport (default 3)
  };
  military: {
    foodGood: GoodId;                   // good soldiers eat; taken from the goods catalog
    weaponsGood: GoodId;                // good soldiers are equipped with; taken from the goods catalog
    foodPerSoldierPerDay: number;       // units of food eaten per soldier per game day
    weaponWearRatePerDay: number;       // share of carried weapons worn out per day (default 0.005)
    desertionRatePerDay: number;        // share of soldiers leaving per day without food (default 0.05)
    soldierWage: number;                // wage per soldier-hour, in man-hours (default 1)
    combatLethalityPerDay: number;      // losses per day per unit of enemy power over own power per soldier (default 0.05)
    militiaShare: number;               // share of a neutral area's population that defends it (default 0.02)
    siegeRatePerDay: number;            // siege progress per day per unit of power per inhabitant (default 0.25)
    foragingShare: number;              // largest share of an area's food stock an army takes per day (default 0.2)
    battleStockDestructionPerDay: number; // share of an area's stock destroyed per day of fighting (default 0.02)
    battleCivilianLossPerDay: number;   // share of an area's population lost per day of fighting (default 0.002)
  };
  warmupDays: number;                   // game days simulated with no players before the game opens (default 180)
  warmupResponsivenessBoost: number;    // responsiveness multiplier during warm-up (default 3)
}
```

## 5. Economy mechanics

The private economy of every area is five steps: produce, consume, trade, reprice, reallocate labor. Population then reacts slowly to the result. In the formulas below, `days` means `gameDaysPerTick`, and `fraction(rate)` is the helper from section 4, rule 2.

### Workforce

```typescript
workforce = area.population * config.economy.workforceShare
// workforce = sum(privateWorkers) + government workers + unemployedWorkers
hourlyOutputPerWorker(good) =
  config.economy.hoursPerWorkerDay * area.productivity * (1 + researchLevel * researchProductivityBonus)
  / good.laborHoursPerUnit                          // units per worker per day
```

### Production

Goods are processed in catalog order, so inputs made this tick are available to their outputs. Private and government workers on the same primary good share the natural capacity, and output is split between them in proportion to workers.

```typescript
// Primary goods: diminishing returns on nature
laborOutputPerDay = totalWorkers * hourlyOutputPerWorker(good)
outputPerDay      = capacity * (1 - exp(-laborOutputPerDay / capacity))
output            = outputPerDay * days
marginalOutputPerWorker = hourlyOutputPerWorker(good) * exp(-laborOutputPerDay / capacity)
naturalCapacity  -= output * good.depletionPerUnitExtracted

// Crafted goods: limited by labor and by rationed inputs
maximumByLabor  = workers * hourlyOutputPerWorker(good) * days
output          = maximumByLabor * min over inputs of ration[input.good]
outputLimitedByInputs = output < maximumByLabor
marginalOutputPerWorker = outputLimitedByInputs ? 0 : hourlyOutputPerWorker(good)
```

**Input rationing.** Several goods often share one input; electricity, for example, feeds most recipes. A scarce input is split between its users in proportion to what each one requests, not handed to whichever comes first in the catalog. This takes one pass, because catalog order guarantees that when good `i` is reached, all of its production for the tick is done and all of its users come later:

```typescript
// computed when good i is reached, before any of its users produce
requested[i]     = sum over private recipes c using i of maximumByLabor[c] * quantity(c, i)
ration[i]        = min(1, stock[i] / max(requested[i], epsilon))
inputDemanded[i] = requested[i]
```

A user limited by another input takes less than its ration, and the rest stays in stock. Producers draw before consumers in the same tick.

`inputDemanded` matters as much as consumer demand. **Total demand** for a good is `demanded + inputDemanded`, and it is the demand used by the price target, the exportable surplus, government buy orders, standing orders and the initial stock. Without it, intermediate goods such as ore or flour would show no demand and their prices would fall to the floor.

Private production draws inputs from the area's stock. Government production draws from the government depot, with its own rationing over the depot, and is not part of `inputDemanded`. Services are produced like crafted goods but go straight to consumption and never enter stock.

### Consumption

Consumption has three parts: the area's purchasing power, the demand for each need split between the goods that satisfy it, and a spillover pass when some of those goods run out.

**Purchasing power** combines income and savings. Savings near `targetSavingsDays` of income are neutral. More savings raise demand and fewer lower it, mostly for needs with a high `wealthElasticity`:

```typescript
incomePerPersonPerDay = max(wageLevel, 0.1) * hoursPerWorkerDay * workforceShare
savingsDays     = savings / max(population * incomePerPersonPerDay, epsilon)
savingsFactor   = clamp(savingsDays / targetSavingsDays, savingsFactorMin, savingsFactorMax) ** savingsElasticity
purchasingPower = max(wageLevel, 0.1) * savingsFactor
```

The effect stabilizes itself. Consumption inside an area does not move money, but higher demand raises local prices, which pulls in imports and spends savings down toward the target. An area with depleted savings demands less, so its prices fall, it exports more and its savings refill.

**Demand per need** and the **split between substitutes**: each good competes on the price of the need units it provides.

```typescript
consumerPrice[g] = price[g] * (1 + consumptionTaxRate[g])
unitPrice[g]     = consumerPrice[g] / g.satisfies.unitsPerGood         // price of one need unit through g
share[g]         = g.satisfies.preference * unitPrice[g] ** -need.substitutionElasticity
                   / sum of the same over all goods of the need
needPrice        = sum over goods of the need of share[g] * unitPrice[g]

needDemanded = population * need.demandPerPersonPerDay * days
             * (need.referenceUnitPrice / needPrice) ** need.priceElasticity
             * purchasingPower ** need.wealthElasticity
demanded[g]  = needDemanded * share[g] / g.satisfies.unitsPerGood
consumed[g]  = min(stock[g], demanded[g])
```

**Spillover:** after the first pass, the need units left unmet by goods that ran out are spread over the goods of the same need that still have stock, in proportion to `share` and capped by that stock. One pass is enough. `demanded` keeps the value from before spillover, so a scarce good keeps its upward price pressure while its substitutes cover the shortfall. `needConsumed` is the sum of `consumed[g] × unitsPerGood` over the need's goods.

`referenceUnitPrice` is `needPrice` computed once at startup, with every consumer price equal to labor value. At those prices and at a purchasing power of 1, an area demands exactly `demandPerPersonPerDay`. A substitution elasticity of 0 keeps shares fixed by preference; 2 to 4 lets consumers switch strongly toward the cheapest good while keeping some variety.

`necessitySatisfaction` is the sum of `needConsumed` divided by the sum of `needDemanded` over necessity needs. `satisfaction` is the same ratio over all needs, with each need weighted by its tier in `tierWeights`.

### Trade

Trade is computed per edge, per good and per direction, from a snapshot of the state before trade; all flows are applied together afterward. Land, sea and air edges use the same formula. An area splits its exportable surplus of a good evenly between the edges where that good has a positive gap, so an area with many routes does not spread its exports over routes that would not take them.

```typescript
transport  = edge.transportCost * good.transportWeight
tariffs    = crossesBorder ? sellerPrice * exportTariffRate[seller] + sellerPrice * importTariffRate[buyer] : 0
gap        = buyerPrice - sellerPrice - transport - tariffs
if (gap <= 0 || !edge.isActive || edge.isBlocked || good.isService) skip

exportable = max(0, sellerStock - reserveDaysOf(good) * sellerTotalDemandedPerDay) / sellerEdgesWithPositiveGap
quantity   = exportable * fraction(tradeRatePerDay) * min(1, tradeGapSensitivity * gap / buyerPrice)
unitPaid   = sellerPrice + transport + tariffs + gap / 2   // the buyer and seller split the gain
quantity   = min(quantity, buyerSavings / unitPaid)        // the buyer can only spend what it has
```

The seller receives `sellerPrice + gap / 2` per unit. Tariffs go to the respective treasuries. The transport share disappears as labor spent on carrying.

**Capacity.** Sea and air routes carry at most `capacityPerDay × days` tonnes in each direction. When the flows of all goods in one direction exceed it, the route is filled greedily, in order of gap per tonne, so the most profitable cargo goes first. Land edges have infinite capacity and skip this step. Routes are few, so the sort costs little.

Goods reach distant areas by being re-exported over several ticks. Price differences spread through the network like heat, so no area ever needs to know about areas that are not its neighbors.

### Sea and air routes

Sea and air traffic reuse edges instead of adding a separate system. A route is an `Edge` with `mode: "sea"` or `"air"` between two distant areas. Trade, tariffs, blocking, migration and depot transfers then work unchanged, and cost per tick stays proportional to edges × goods. The route graph is kept sparse on purpose. Because prices spread hop by hop, a few routes per port or airport are enough to connect distant markets; joining every airport to every other one would add edges with the square of the number of airports and gain little.

| | Sea routes | Air routes |
| --- | --- | --- |
| Endpoints | Two coastal areas, both with `portLevel` ≥ 1 | Two areas, both with `airportLevel` ≥ 1 |
| Created by | Map generation: each coastal area is linked to its `seaRoutesPerPort` nearest coastal areas by distance over water | Rebuilt whenever an airport opens or grows: each airport is linked to its `airRoutesPerAirport` nearest airports, and airports at `maximumAirportLevel` are all linked to each other as hubs |
| Base transport cost | `seaCostPerDistance × distance` | `airBaseCost + airCostPerDistance × distance` |
| Capacity per day and direction | `seaCapacityPerPortLevel × min(portLevel)` | `airCapacityPerAirportLevel × min(airportLevel)` |
| Suits | Heavy bulk goods over long distances | Light, valuable or perishable goods |
| Armies | Can embark from a port owned by their government; crossing takes `seaTravelDaysPerDistance × distance` | Cannot use them |
| Migration | Multiplied by `migrationFactorBySea` | Multiplied by `migrationFactorByAir` |

- Map generation gives every coastal area a port of level 1, so the base economy trades by sea with no players. It also gives an airport of level 1 to the `initialAirportShare` most populous areas.
- Governments raise port and airport levels with the `buildPort` and `buildAirport` jobs. Captures leave port and airport levels intact. An air route dropped by a rebuild is deactivated (`isActive` set to false) instead of deleted, so edge ids stay stable, and it is reactivated if a later rebuild picks the same pair again.
- Infrastructure jobs do not lower route costs; they raise route capacity through port and airport levels.
- Rebuilding air routes runs only on a change of airport level, which is rare. It is a nearest-neighbor search over the airports, done in phase 10, never as part of the normal per-tick work.
- Blocking works as on land: a route is blocked when its two endpoints belong to governments at war, or when either endpoint is under siege. Naval combat and blockades are possible future additions.

### Prices

Storable goods are priced on stock: the price rises when stock falls below its target and falls when stock exceeds it. Perishable goods keep a smaller target, so their reserve never rots faster than `maxReserveSpoilageShare` of demand: bread keeps about 1 day, fish 1.25 days and electricity a third of a day. Services have no stock, so they are priced on flows within the tick.

```typescript
totalDemandedPerDay = (demanded + inputDemanded) / days
reserveDaysOf(good) = min(reserveDays, maxReserveSpoilageShare / max(good.spoilageRatePerDay, epsilon))

if (good.isService)
  pressure = (demanded - produced) / max(demanded, produced, epsilon)
else
  target   = reserveDaysOf(good) * totalDemandedPerDay
  pressure = (target - stock) / max(target, stock, epsilon)
// pressure is between -1 and 1

logChange  = clamp(priceAdjustmentRatePerDay * economyResponsiveness * days * pressure,
                   -log(1 + maxPriceChangePerTick), log(1 + maxPriceChangePerTick))
price      = clamp(price * exp(logChange),
                   max(laborValue * priceFloorMultiple, policy priceFloor),
                   min(laborValue * priceCeilingMultiple, policy priceCeiling))
smoothedPrice += fraction(priceSmoothingRatePerDay) * (price - smoothedPrice)
```

### Labor allocation

Workers move toward a target allocation that favors jobs with high value added, computed from smoothed prices and after production taxes or subsidies.

```typescript
valueAddedPerHour(good) =
  (smoothedPrice[good] * (1 - productionTaxRate[good])
   - sum over inputs of input.quantity * smoothedPrice[input.good])
  * marginalOutputPerWorker(good) / hoursPerWorkerDay

wageLevel = sum(valueAddedPerHour * privateWorkers) / max(sum(privateWorkers), epsilon)

// Soft choice among producible jobs; "unemployed" is an option with value 0
weight(job)   = exp((valueAddedPerHour(job) - best) / (laborAllocationTemperature * max(wageLevel, epsilon)))
target(job)   = availablePrivateWorkforce * weight(job) / sum(weights)
change(job)   = fraction(laborMobilityRatePerDay) * (target(job) - workers(job))
// scale all changes down if their total exceeds maxLaborShiftPerTick * workforce
```

A good is producible in an area if it is primary with natural capacity there, or crafted with a recipe. Workers stuck without inputs see a marginal output of zero and drift away.

### Population

```typescript
if (necessitySatisfaction >= growthSatisfactionThreshold)
  growth = growthRatePerDay * (necessitySatisfaction - threshold) / (1 - threshold)
else
  growth = -starvationRatePerDay * (threshold - necessitySatisfaction) / threshold
population *= exp(growth * demographyResponsiveness * days)

attractiveness = (1 - migrationWageWeight) * satisfaction
               + migrationWageWeight * wageLevel / (wageLevel + 1)
// per active, non-blocked edge, from the less attractive area to the more attractive one
modeFactor = land: 1, sea: migrationFactorBySea, air: migrationFactorByAir
migrants = population * fraction(migrationRatePerDay) * attractivenessDifference * modeFactor / edgeCount
```

New inhabitants and migrants join `unemployedWorkers` in proportion to `workforceShare`; the labor phase places them. When population falls, from starvation or emigration, the lost workers (the same `workforceShare` of the loss) are taken from `unemployedWorkers` first, then from private jobs in proportion to their size. Government workers and soldiers are not affected.

### Goods catalogs

Needs and goods are loaded from a JSON catalog chosen when a game is created. Three catalogs ship with the game, all in an industrial to modern setting. All numbers are plausible first guesses for tuning in the headless runner.

| Catalog | File | Goods | Needs | Purpose |
| --- | --- | --- | --- | --- |
| Small | `data/goods/small.json` | 5 | food, equipment | Unit tests and convergence scenarios |
| Medium | `data/goods/medium.json` | 14 | food, energy, clothing, household, health | Balancing, short games, slow devices |
| Large | `data/goods/large.json` | 54 | food, energy, shelter, clothing, household, health, mobility, communication, education, leisure | Full games |

**Format.** A catalog holds `name`, `description`, `needs`, `goods` and `military`.

- **Needs and goods** carry the fields of the `Need` and `Good` interfaces, minus the derived ones (`id`, `laborValue`, `referenceUnitPrice`).
- **References** between needs, goods and recipe inputs use string `key`s, resolved to ids at load.
- **`kind`** is `"primary"`, `"crafted"` or `"service"`. The loader derives `isPrimary` and `isService` from it.
- **`military`** names the `foodGood` and `weaponsGood` used for `WorldConfig.military`.

```json
{
  "key": "bread", "name": "Bread", "unit": "kg", "kind": "crafted", "laborHoursPerUnit": 0.2,
  "transportWeight": 0.0012, "spoilageRatePerDay": 0.1, "depletionPerUnitExtracted": 0,
  "regenerationRatePerDay": 0, "abundance": null,
  "inputs": [{"good": "flour", "quantity": 0.007}, {"good": "electricity", "quantity": 0.05}],
  "satisfies": {"need": "food", "unitsPerGood": 1.3, "preference": 1}
}
```

The loader rejects a catalog if any of these hold:

- A key is duplicated or a reference does not resolve.
- An input is listed after the good that uses it.
- A service is used as an input.
- A primary good has inputs or no `abundance`.
- A need has no good satisfying it.

**Conventions used by the shipped catalogs:**

- `transportWeight` is in tonnes per unit, so land transport between neighbors (about 0.3 man-hours per tonne) costs a few percent of the value of most goods. Stone, sand and timber are the exceptions: they barely travel by land and are what sea routes are for.
- Need units are physical where that makes sense (2,000 kcal of food, 10 kWh of energy, 10 passenger-km). Heterogeneous needs such as health, household goods, education and leisure use value units: one unit is one man-hour of that need at reference prices, and each good's `unitsPerGood` equals its labor value.
- Goods that are used together, such as a car and its fuel, are bundled into a service whose recipe consumes both (car travel). Durables enter that service as a small input per use, which stands in for depreciation. The model therefore needs no complementary demand.
- Electricity is a crafted good with a spoilage of 0.3 per day and a near-zero weight. It moves over the grid like any good, but its reserve is only about a third of a day of demand, and imported power loses about a quarter on the way, which stands for grid losses.

**Calibration rule.** At labor-value prices and a purchasing power of 1, the full consumption basket should cost 70–85% of the labor available per person (`hoursPerWorkerDay × workforceShare`, 4 hours by default), and necessities should take roughly 30–40% of the basket. The rest of the labor is left for government jobs, armies and transport. The shipped catalogs use about 73% of the labor; necessities take 32% of the small basket, 29% of the medium one and 35% of the large one.

## 6. Government mechanics

A government touches the private economy through three channels only: policies, market orders and employment. It holds one treasury for the whole realm and one depot per owned area, because money moves instantly but goods must travel.

### Policies

Each policy plugs into exactly one phase of the tick.

| Policy | Applies per | Phase | Effect |
| --- | --- | --- | --- |
| `productionTaxRate` | Good | Labor | Lowers value added, so workers leave the taxed good. Negative values are subsidies. |
| `consumptionTaxRate` | Good | Consumption | Raises the consumer price, so demand drops, mostly for elastic goods. |
| `importTariffRate` | Good | Trade | Added to the cost of goods entering across a border. |
| `exportTariffRate` | Good | Trade | Added to the cost of goods leaving across a border. A very high value acts as a ban. |
| `headTaxPerPersonPerDay` | Area | Taxes | Flat tax per inhabitant. Reliable revenue that drains savings and drives people away. |
| `priceCeiling`, `priceFloor` | Good | Prices | Clamp the local price. Ceilings cause shortages; floors cause gluts. |

The player sets **realm policies** once and adds **area overrides** where needed. The two are merged into `resolvedPolicies` only when a setting changes, never during a normal tick. Neutral areas have all policies at zero.

### Tax collection

```typescript
taxDue = sum over goods of productionTaxRate * privatelyProduced * price
       + sum over goods of consumptionTaxRate * consumed * price
       + headTaxPerPersonPerDay * population * days
// tariffs were already collected in money during trade

paidInMoney = min(taxDue, area.savings)
shortfall   = taxDue - paidInMoney
// shortfall taken in kind: goods move from area stock to the depot, most valuable first, at local price
```

Subsidies (negative production tax) are paid from the treasury into area savings. If the treasury cannot pay every subsidy and wage, all payments are scaled down by the same ratio.

### Market orders

The government is a price taker on its own areas' markets. Orders execute in the market phase, after production and before consumption.

```typescript
// Buy order
if (price <= limitPrice)
  quantity = min(remainingQuantity, maximumQuantityPerDay * days,
                 max(0, stock - reserveDaysOf(good) * totalDemandedPerDay), treasury / price)
  // goods: area stock -> depot; money: treasury -> area savings

// Sell order
if (price >= limitPrice)
  quantity = min(remainingQuantity, maximumQuantityPerDay * days, depot, area.savings / price)
  // goods: depot -> area stock; money: area savings -> treasury
```

A purchase lowers stock, so the price rises in the next price phase. Buying cheaply in good years and selling during a famine is a core strategy.

### Depots and transfers

A `transferGoods` command moves goods between two depots of the same government. The route is the cheapest path through non-blocked edges. Transport cost (sum of `transportCost × transportWeight × quantity` along the route) is paid from the treasury upfront, and goods arrive after the sum of the edges' `travelDays`. Goods spoil in depots and in transit like any stock.

### Hiring and wages

The player sets a target number of workers per job and a wage offer per area. Workers come from `unemployedWorkers` first, then proportionally from private jobs.

```typescript
wageAttractiveness = wageOffer / max(area.wageLevel, epsilon)
if (targetWorkers > workers && wageAttractiveness >= 1)
  workers += fraction(hiringRatePerDay) * (targetWorkers - workers)   // capped by available workforce
if (wageAttractiveness < 1)
  workers -= workers * fraction(quitRatePerDay) * (1 - wageAttractiveness)
if (targetWorkers < workers)
  workers = targetWorkers                                            // firing is instant

wagesPaid = workers * wageOffer * hoursPerWorkerDay * days           // treasury -> area savings
```

Fired and quitting workers return to `unemployedWorkers`. Unpaid workers quit at `quitRatePerDay` times their unpaid share.

### Government jobs

| Job | Effect |
| --- | --- |
| `produce` | Produces a good with the normal recipe, drawing inputs from the depot and adding output to it. |
| `buildInfrastructure` | Adds worker-days to an adjacent edge. Each `infrastructureWorkerDaysPerStep` multiplies its transport cost by `infrastructureStepFactor`, down to `minimumTransportCostFactor` of the base. |
| `fortify` | Adds worker-days toward the next fortification level of the area, up to `maximumFortificationLevel`. |
| `buildPort` | Coastal areas only. Each `portWorkerDaysPerLevel` raises `portLevel` by one, up to `maximumPortLevel`, which raises the capacity of the area's sea routes. |
| `buildAirport` | Each `airportWorkerDaysPerLevel` raises `airportLevel` by one, up to `maximumAirportLevel`. The first level opens air routes; the maximum level makes the airport a hub. |
| `research` | Adds worker-days to the realm's research. Each level adds `researchProductivityBonus` to productivity in every owned area. |

### Standing orders

Standing orders are rules evaluated at the start of every tick. Each one issues the same effects a player command would, such as placing or topping up a market order or loading an army. They keep a large realm manageable, and AI governments are built almost entirely from them.

## 7. War and conquest

War is an economic activity: soldiers are withdrawn from the workforce, eat food, wear out weapons and cut trade. Conquest happens by besieging an undefended area until it changes owner.

### Relations

Every pair of governments is at `peace` or `war`. A `declareWar` command takes effect immediately. Peace needs a `proposePeace` command accepted by the other side; a proposal can transfer areas and include a money payment.

An edge is **blocked** when its two areas belong to governments at war, or when either area is under siege. Blocked edges carry no trade, migration or depot transfers.

### Neutral areas

Areas with no owner defend themselves with a militia of `population × militiaShare` (default 2%). Militia has no equipment and no fortifications. Owned areas rely on armies and fortifications only.

### Armies

- **Recruiting** takes soldiers from the area's unemployed workers first, then from private jobs, and removes them from the population.
- **Disbanding** returns soldiers to the population of the area where the army stands, as unemployed workers.
- **Marching** follows the shortest path by `travelDays`. Crossing an edge takes its `travelDays`, divided by `militaryResponsiveness`.
- **Sea crossings** are allowed only from an area owned by the army's government with `portLevel` ≥ 1, so an invasion by sea needs a friendly port to embark from. Armies never use air routes.
- **Wages** of `soldierWage × hoursPerWorkerDay × soldiers × days` go from the treasury into the savings of the area where the army stands.

### Upkeep

Each tick, an army eats `foodPerSoldierPerDay × soldiers × days` from its carried food:

1. In an owned area, it first refills from the local depot when a `supplyArmies` standing order or a `supplyArmy` command asks for it.
2. In enemy or neutral territory, it **forages**: it takes food from the area's private stock, up to `foragingShare` of that stock per day.
3. When carried food runs out, soldiers desert at `desertionRatePerDay`.

Carried weapons wear out at `weaponWearRatePerDay`.

### Power

```typescript
equipment    = min(1, weapons / max(soldiers, epsilon))
powerPerSoldier = 1 + equipment                       // an equipped soldier counts double
armyPower    = soldiers * powerPerSoldier
defensePower = (sum of defending army power + militia) * (1 + fortificationLevel)
```

Defenders are the owner's armies in the area (any stance) plus militia for neutral areas. Attackers are armies in `attack` stance whose government is at war with the owner, or any attacking army in a neutral area.

### Combat

Combat runs every tick in an area where attackers and defenders are both present. It is a simplified Lanchester model:

```typescript
k = combatLethalityPerDay * militaryResponsiveness * days
attackerSoldiersLost = min(attackerSoldiers, k * defensePower / attackerPowerPerSoldier)
defenderSoldiersLost = min(defenderSoldiers, k * attackPower / defenderPowerPerSoldier)
// losses are shared across the armies of each side in proportion to their soldiers
// militia losses reduce the neutral area's population
```

Each day of fighting also destroys `battleStockDestructionPerDay` of the area's stock and `battleCivilianLossPerDay` of its population.

When several governments attack the same area, they fight the defender together but not each other unless they are also at war. Siege progress goes to the attacker with the most power present.

### Siege and capture

Once no defender is left, attackers besiege the area:

```typescript
siegeProgress += siegeRatePerDay * militaryResponsiveness * days
               * attackPower / ((1 + fortificationLevel) * max(population, 1))
```

With default values, 1,000 equipped soldiers take an unfortified area of 10,000 people in about 20 days. Siege progress decays back to zero once attackers leave.

When `siegeProgress` reaches 1:

- The area's owner becomes the besieger, and its fortification level drops by one.
- The old owner's depot in that area is merged into the new owner's depot there.
- The old owner's government jobs there end; their workers become unemployed.
- The new owner's realm policies apply.
- If it was the old owner's capital, the capital moves to its most populous remaining area.
- A government with no area left is eliminated, and its armies disband where they stand.

### Peace

An accepted proposal sets the relation to `peace`, transfers the listed areas with the same rules as a capture, and moves the payment between treasuries. Payments larger than the payer's treasury are rejected when the proposal is answered.

## 8. Simulation tick

One tick runs eleven phases in a fixed order, and each phase runs over every area before the next one starts. Trade, migration and combat read a snapshot and apply their results together, so the outcome never depends on the order areas are processed in.

```typescript
function runTick(world: World, commands: CommandEnvelope[]): void
```

0. **Commands and automation.** Validate each command against its sender's government and apply it. Evaluate AI decisions and standing orders, which produce the same effects. Rebuild `resolvedPolicies` where a setting changed. Handle war declarations, peace answers and expired proposals. Recompute `Edge.isBlocked`.
1. **Production.** For each good in catalog order: primary goods with diminishing returns on natural capacity, crafted goods limited by labor and by inputs rationed between their users. Private output goes to area stock, government output to depots. Record `produced`, `inputDemanded`, `outputLimitedByInputs` and the marginal output per worker.
2. **Government market and logistics.** Execute buy and sell orders at local prices. Advance depot transfers and deliver those that arrive.
3. **Consumption and army upkeep.** Compute purchasing power from wage level and savings. Compute demand per need at consumer prices including consumption tax, split it between substitutes, consume from stock, then run the spillover pass. Compute `satisfaction` and `necessitySatisfaction`. Armies refill from depots, forage or eat carried food; unfed soldiers desert.
4. **Trade.** From the snapshot, compute flows per active, non-blocked edge of every mode, good and direction, including transport and tariffs. Cap sea and air routes at their capacity. Apply all goods and money movements together. Record `imported` and `exported`.
5. **Taxes, subsidies and wages.** Collect taxes from savings, with the shortfall taken in kind. Pay subsidies, government wages and soldier wages from the treasury, scaled down together if the treasury is short.
6. **Prices.** Move each price toward clearing the stock target of total demand, or for services toward balancing production and demand, within the per-tick limit and the price bounds. Update `smoothedPrice`.
7. **Labor.** Compute value added per job from smoothed prices and production taxes, and update `wageLevel`. Move private workers toward the target allocation within `maxLaborShiftPerTick`. Apply government hiring, quitting and firing.
8. **Military.** Move marching armies. Resolve combat in contested areas. Advance or decay sieges. Transfer captured areas, move capitals and eliminate governments with no area left.
9. **Population.** Apply growth or starvation from `necessitySatisfaction`. Compute migration along active, non-blocked edges from the snapshot, scaled by each edge's mode, and apply it together.
10. **Decay and progress.** Spoil stock, depots, transfers and army supplies. Regenerate natural capacity. Apply infrastructure, fortification, port, airport and research progress. If any port or airport level changed, update the capacity of the routes touching it; if an airport level changed, also rebuild the air routes. Increment `tick` and add `gameDaysPerTick` to `gameDay`.

All randomness (AI choices, tie-breaks, future events) uses the seeded generator in `World.randomSeed`, so a saved game with the same command log replays identically on the same device.

## 9. Architecture and stack

Everything is TypeScript and runs in the browser. The host's browser runs the simulation in a Web Worker; joining players connect through PeerJS, send commands and draw the snapshots they receive.

&#91;embedded content: architecture · host browser, joining players, signaling\]

Only the host simulates. The signaling broker is used only to set up connections; game traffic then flows directly between browsers.

### Stack

| Concern | Choice | Notes |
| --- | --- | --- |
| Language | TypeScript, strict mode | One language for simulation, networking and interface |
| Build | Vite, pnpm workspaces | Fast development server, static output |
| Interface | React | Panels, lobby, policy and order editors |
| Interface state | Zustand | Store fed by snapshots, read by React and the map |
| Map | PixiJS (WebGL 2D) | Driven imperatively from one React component |
| Charts | uPlot | Fast long time series for prices and populations |
| Networking | PeerJS | WebRTC data channels in reliable mode |
| Serialization | @msgpack/msgpack | Binary messages and save files; typed arrays sent as Float32 |
| Tests | Vitest | Unit tests and convergence scenarios |
| End-to-end tests | Playwright | Real browsers, including two-browser multiplayer sessions |
| Lint and format | Biome | One tool for both; independent of the TypeScript version |
| Headless runs | Node with tsx | Balance testing without a browser |
| Distribution | Static hosting, PWA (vite-plugin-pwa) | GitHub Pages, Netlify or Cloudflare Pages; installable on phones |

### Packages

- `packages/sim`: data model, config, tick, commands, AI, map generation, save format. No browser or network dependency.
- `packages/net`: PeerJS host and client wrappers, message types, snapshot encoding.
- `apps/web`: React application, PixiJS map, panels, and the simulation worker entry point.
- `tools/headless`: Node runner, diagnostics and convergence scenarios.

### Host loop

The worker runs a timer loop targeting `1000 / maxTicksPerSecond` milliseconds per tick. Each iteration drains the command queue, runs one tick and, at the snapshot rate, posts a snapshot to the main thread using transferable buffers. When a tick takes longer than its budget, the loop runs as fast as it can and still yields between ticks.

The main thread forwards local and remote commands to the worker, updates its own store from snapshots, and broadcasts them to clients. Pause and speed changes are messages to the worker, never simulation commands.

### Messages

| Message | Direction | Content |
| --- | --- | --- |
| `hello` | Client to host | Player name, protocol version |
| `welcome` | Host to client | Player id, static data: needs, goods, area names and positions, edges, config |
| `lobby` | Host to client | Players and their government assignments |
| `command` | Client to host | One `CommandEnvelope` |
| `commandRejected` | Host to client | The rejected command and the reason |
| `snapshot` | Host to client | Dynamic state at one tick (below) |
| `priceTable` | Host to client | Prices of every good in every area (below) |
| `hostStatus` | Host to client | Running, paused or hidden; current speed |

### Snapshots

The host broadcasts snapshots at `snapshotRate` (default 3 per second), independent of the tick rate. A snapshot contains:

- `tick` and `gameDay`.
- Per area, for every area: owner, population, wage level, satisfaction, port and airport levels, and siege progress.
- Per area, for the receiving player's owned areas and their direct neighbors: savings and the price, stock, produced, consumed, imported and exported arrays at full precision. Other areas' stocks and flows are not sent.
- Per edge: transport cost, capacity, active and blocked state, plus the full data of any route edge created since the last snapshot.
- All armies, relations and pending peace proposals.
- The receiving player's full government state (treasury, depots, jobs, orders); other governments as a public summary.

Typed arrays are sent as `Float32Array`.

### Price table

Prices are public: every client receives the price of every good in every area, whatever it owns. This is the **open prices** principle. The host sends a `priceTable` message at `priceTableRate` (default once per second). The message carries the `tick` and one `Uint16Array` of areas × goods.

To halve the size, each price is quantized on a log scale between the price floor and the price ceiling multiples:

```typescript
q = round(65535 * (ln(price / laborValue) - ln(priceFloorMultiple))
              / (ln(priceCeilingMultiple) - ln(priceFloorMultiple)))
```

With the default bounds, one step is less than 0.01% of the price. With 1,000 areas and 54 goods, the table is about 108 KB. Clients build their own price history from successive tables for the charts. AI governments read the same table and see no more than human players.

The interface uses the table in two places:

- A **price map** colors every area by the price of a chosen good relative to its labor value.
- A **good panel** lists the lowest, median and highest price, each with the area where it occurs, so players can spot trade and arbitrage opportunities at a glance.

### Joining

1. The host creates a PeerJS peer with a random id and shows the link `https://<site>/#join=<peer id>`.
2. The joining player opens the link; their browser creates its own peer and opens a reliable data channel to the host.
3. The client sends `hello`; the host answers `welcome` and assigns a government or spectator role in the lobby.

The free PeerJS cloud broker is enough to start; a self-hosted PeerServer can replace it later. STUN uses public servers by default, and a TURN relay can be added to the connection settings for players on strict networks.

### Hosting on mobile

- Browsers slow down or suspend hidden tabs. The host listens to the Page Visibility API, pauses when hidden and tells clients through `hostStatus`.
- The host requests a Screen Wake Lock while a game runs.
- The default `maxTicksPerSecond` is lower on mobile devices.

### Save and load

The world is serialized with msgpack, keeping typed arrays, plus a save format version number. The host autosaves to IndexedDB at a fixed game-day interval and can export the save as a file. Any player can load a save and host it, which is how a game continues when the host leaves.
