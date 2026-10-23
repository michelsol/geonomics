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
| Exports to neighbors, transport included | Into savings | Trade phase |
| Imports from neighbors | Out of savings | Trade phase |
| Taxes | Savings to treasury | Tax phase |
| Subsidies | Treasury to savings | Tax phase |
| Government and army wages | Treasury to savings | Tax phase |
| Government purchases on the local market | Treasury to savings | Market phase |
| Government sales on the local market | Savings to treasury | Market phase |
| Transport of government depot transfers | Treasury to the savings of the source area | When the transfer is ordered |

Taxing without spending drains an area's savings, so it can no longer import. This is intended: it is the natural cost of over-taxation.

Transport is paid by the buyer to the exporting area, whose carriers do the work, so trade between neutral areas conserves money.

Savings also feed back into demand and wages: an area holding more than its target savings spends more, mostly on comforts and luxuries, and its workers ask for more; an area with depleted savings cuts back and its workers accept less, so its goods get cheaper and sell abroad (section 5, Consumption and Labor allocation). Both pull savings back toward the target through trade.

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
  map: MapLayout | null;                // geometry of a generated map; null for hand-built worlds
}

interface MapLayout {
  width: number;                        // map size in map units (km)
  height: number;
  waterPoints: Float64Array;            // x, y pairs of the water cells' centers
}
// Area cells for rendering are the Voronoi cells of the area positions followed by the water points.

type Terrain = "plains" | "forest" | "hills" | "mountains" | "desert";

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
  terrains: (Terrain | "coast")[];      // primary goods: where map generation places capacity; empty = anywhere
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
  fortificationProgress: number;        // worker-days accumulated toward the next fortification level
  terrain: Terrain;                     // set by map generation: sets productivity and land transport cost
  isCoastal: boolean;                   // set by map generation: the area touches navigable water
  portLevel: number;                    // 0 = no port; raises the capacity of the area's sea routes
  portProgress: number;                 // worker-days accumulated toward the next port level
  airportLevel: number;                 // 0 = no airport; raises the capacity of the area's air routes
  airportProgress: number;              // worker-days accumulated toward the next airport level
  siegeProgress: number;                // 0 to 1; the area changes owner when it reaches 1
  militia: number;                      // militia still standing (section 7, Militia)
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
  governmentDemanded: Float64Array;     // units governments tried to buy on the market this tick
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
  tradeFlowPerDay: Float64Array;        // per good and direction (index 2 × GoodId, + 1 for B to A): current shipping rate, units per day
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
  good: GoodId | null;                  // the good it applies to; null for head tax, or every good for a per-good policy
  value: number | null;                 // the rate or price; null restores the neutral value (no tax, ceiling or floor)
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
  soldierWage: number;                  // wage paid per soldier-hour, in man-hours (starts at military.soldierWage)
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
  | { kind: "buyBelowPrice"; good: GoodId; maximumPrice: number; maximumDepotQuantity: number };
      // stockpile whenever the price is low

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

Players and AI act only through commands. The host queues them and applies them at the start of the next tick, in order; each command is validated against the state left by the ones before it.

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
  | { type: "setSoldierWage"; wage: number }
  | { type: "declareWar"; target: GovernmentId }
  | { type: "proposePeace"; proposal: Omit<PeaceProposal, "id"> }
  | { type: "answerPeace"; proposalId: number; accept: boolean }
  | { type: "addStandingOrder"; order: Omit<StandingOrder, "id"> }
  | { type: "removeStandingOrder"; orderId: number };

interface CommandEnvelope {
  player: PlayerId;                     // sender, checked against the government's controller; "ai" for AI governments
  government: GovernmentId;             // government the command acts for
  command: Command;                     // the action itself
}
```

Host-only controls (pause, speed, save) are network messages, not simulation commands, so they never touch the world state.

### Command validation

The host validates every command before applying it. A rejected command changes nothing and is answered with a `commandRejected` message giving the reason.

| Check | Rule |
| --- | --- |
| Sender | `player` must be the controller of `government` (`"ai"` for an AI government; the host never accepts that id from the network), and the government must not be eliminated |
| Ownership | Every area, army, order or depot a command references must belong to the sending government |
| Numbers | Every number must be finite; quantities, worker targets, soldiers and prices must be ≥ 0 |
| Policies | Production and consumption tax rates and tariffs must be within [−1, 5]; head tax, ceilings and floors ≥ 0. Head tax takes no good; every other policy takes one good, or none for every good |
| Wages | `wageOffer` and the soldier wage must be within [0, 10] |
| Recruiting | At least one soldier, and no more than the area's unemployed and private workers |
| Armies | `moveArmy` needs a reachable destination under the marching rules; `disbandArmy` at most the army's soldiers |
| Jobs | `buildPort` only in coastal areas; `buildInfrastructure` only on a land edge touching the area; `produce` never a service, and a primary good only where the area has natural capacity for it |
| Goods | Market orders, transfers and standing rules never name a service |
| Transfers | Two different owned areas; the quantity at most what the source depot holds; a non-blocked path between them; a treasury that covers the transport |
| Diplomacy | No war on oneself, an eliminated government or one already at war; peace only with a government at war, from the sending government, expiring in the future, with each listed area going from one side to the other; when accepted, a payment must fit in the payer's treasury and the listed areas must still belong to their side |
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
| Private job allocation | `laborMobilityRatePerDay` | 10 days |
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
2. Workers are allocated to cover local demand where local resources allow. The rest stay unemployed: by the calibration rule that is about a quarter of the workforce, the pool government jobs and armies hire from.
3. Each area starts with `reserveDaysOf(good)` of total demand in stock.
4. Each area starts with `targetSavingsDays` of income in savings, so savings neither boost nor dampen demand at first.
5. Value added and `wageLevel` are computed once from these starting prices and workers, so the first tick has valid purchasing power and labor targets.
6. The world then runs `warmupDays` with no players, at `warmupResponsivenessBoost` times the normal economy responsiveness and with population frozen (demography responsiveness 0), before the game opens.

### Global pace parameters

Three multipliers change the feel of a game without touching individual rates:

- `economyResponsiveness` scales prices, trade, smoothing and labor. Lower is calmer and more stable; higher is snappier.
- `demographyResponsiveness` scales population growth, starvation and migration.
- `militaryResponsiveness` scales marching, combat and sieges.

To speed up a whole game, raise `gameDaysPerTick` or `maxTicksPerSecond`. To make the economy react faster relative to game time, raise `economyResponsiveness`. Rule 2 keeps both safe.

### Diagnostics

A headless runner (Node) simulates thousands of days and reports, per area and good:

- **Price volatility:** standard deviation of daily log price changes over the last 30 days.
- **Oscillation count:** number of times the direction of a price changes over the last 30 days, ignoring daily moves under 0.1%.
- **Unmet necessities:** share of necessity demand not met.
- **Labor churn:** share of the workforce changing jobs per day.

Two regression scenarios must converge: two areas with complementary resources (price gap settles near transport cost within 60 days), and a 10-area chain (prices settle along a smooth gradient within 200 days). A buyer that imports all it uses settles at a gap of `1 / (reserveDaysOf(good) × tradeGapSensitivity)` of its price above transport.

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
    priceAdjustmentRatePerDay: number;  // speed at which the price moves toward the smoothed price times the scarcity premium (default 0.35)
    priceSmoothingRatePerDay: number;   // speed of the smoothed price, the long-run price that jobs follow (default 0.07)
    scarcityPremium: number;            // log premium of the price over the smoothed price at full shortage, discount at full glut (default 0.1)
    priceFlowWeight: number;            // weight of the flow imbalance next to the stock gap in price pressure (default 0.3)
    tradeRatePerDay: number;            // speed at which an edge's shipping rate moves toward its target (default 0.23)
    tradeGapSensitivity: number;        // share of its reserve a buyer imports per day over one edge, per unit of relative price gap (default 20)
    exportReserveShare: number;         // share of its own reserve an area keeps when exporting (default 0.5)
    tradeMargin: number;                // smallest price gap worth trading for, as a share of the higher price (default 0.01)
    laborMobilityRatePerDay: number;    // speed at which private workers move toward the target allocation (default 0.07)
    laborAllocationTemperature: number; // softness of the value-added tilt on labor targets, relative to the reservation wage (default 1)
    reservationWage: number;            // value added per hour below which workers prefer unemployment, at target savings, in man-hours (default 1)
    stockRecoveryDays: number;          // labor plans to bring a stock back to its reserve over this many days (default 5)
    maxPriceChangePerTick: number;      // largest relative price change in one tick (default 0.1)
    maxLaborShiftPerTick: number;       // largest share of a workforce changing jobs in one tick (default 0.02)
    priceFloorMultiple: number;         // lowest price as a multiple of labor value (default 0.1)
    priceCeilingMultiple: number;       // highest price as a multiple of labor value (default 10)
    tierWeights: { necessity: number; comfort: number; luxury: number }; // weights in satisfaction (default 3, 2, 1)
    targetSavingsDays: number;          // days of income inhabitants like to hold; neutral point of the savings effect (default 30)
    savingsElasticity: number;          // how strongly savings above or below target change purchasing power (default 0.5)
    savingsFactorMin: number;           // lower clamp of savings relative to target (default 0.05)
    savingsFactorMax: number;           // upper clamp of savings relative to target (default 16)
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
    airFreightDays: number;             // game days a depot transfer takes over an air route (default 1)
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
    startingTreasuryDays: number;       // starting treasury, in days of the realm's income (default 30)
    standingOrderShareOfDemandPerDay: number; // pacing of standing orders, as a share of the area's daily demand (default 0.2)
  };
  network: {
    priceTableRate: number;             // global price table broadcasts per wall-clock second (default 1)
    snapshotRate: number;               // snapshots per wall-clock second for owned areas and the viewport (default 3)
  };
  military: {
    weaponsGood: GoodId;                // good soldiers are equipped with; taken from the goods catalog
    weaponWearRatePerDay: number;       // share of carried weapons worn out per day (default 0.005)
    desertionRatePerDay: number;        // share of soldiers leaving per day per unit of wage shortfall or unpaid share (default 0.05)
    soldierWage: number;                // starting soldier wage of every government, per soldier-hour, in man-hours (default 1.5)
    combatLethalityPerDay: number;      // losses per day per unit of enemy power over own power per soldier (default 0.05)
    militiaShare: number;               // share of an area's population that defends it as militia (default 0.02)
    siegeRatePerDay: number;            // siege progress per day per unit of power per inhabitant (default 0.25)
    battleStockDestructionPerDay: number; // share of an area's stock destroyed per day of fighting (default 0.02)
    battleCivilianLossPerDay: number;   // share of an area's population lost per day of fighting (default 0.002)
    siegeDecayRatePerDay: number;       // speed at which siege progress decays once the attackers leave (default 0.1)
  };
  map: {                                // map generation (section 5, Map generation)
    landAreaCount: number;              // areas on a generated map (default 1000)
    cellSpacing: number;                // average distance between neighboring cell centers, in km (default 100)
    landShare: number;                  // share of the cells that are land (default 0.45)
    elevationOctaves: number;           // octaves of the elevation noise (default 4)
    meanAreaPopulation: number;         // average starting population of an area (default 10000)
    capacityHeadroom: number;           // world capacity of a primary good as a multiple of its reference demand (default 2.5)
    presence: { common: number; regional: number; rare: number }; // share of eligible areas holding a primary good (default 0.85, 0.3, 0.08)
    extractionLaborShare: number;       // producing areas of a primary good could supply the world with this share of their labor (default 0.1)
    governmentCount: number;            // realms founded, which split the whole map; chosen by the player (default 6)
    minimumIslandAreas: number;         // smaller islands sink (default 2)
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
marginalOutputPerWorker = hourlyOutputPerWorker(good) * min over inputs of ration[input.good]
```

**Input rationing.** Several goods often share one input; electricity, for example, feeds most recipes. A scarce input is split between its users in proportion to what each one requests, not handed to whichever comes first in the catalog. This takes one pass, because catalog order guarantees that when good `i` is reached, all of its production for the tick is done and all of its users come later:

```typescript
// computed when good i is reached, before any of its users produce
requested[i]     = sum over private recipes c using i of maximumByLabor[c] * quantity(c, i)
ration[i]        = min(1, stock[i] / max(requested[i], epsilon))
inputDemanded[i] = requested[i]
```

A user limited by another input takes less than its ration, and the rest stays in stock. Producers draw before consumers in the same tick.

`inputDemanded` matters as much as consumer demand. **Total demand** for a good is `max(demanded, consumed) + inputDemanded + governmentDemanded`: what consumers wanted or, when they fell back on it because a substitute ran out, what they actually ate, plus what producers requested, plus what governments tried to buy. It is the demand used by the price target, the exportable surplus, the labor plan and the initial stock. Government buy orders and standing orders use the inhabitants' part only, without `governmentDemanded`.

Private production draws inputs from the area's stock. Government production draws from the government depot, with its own rationing over the depot, and is not part of `inputDemanded`. Services are produced like crafted goods but go straight to consumption and never enter stock.

### Consumption

Consumption has three parts: the area's purchasing power, the demand for each need split between the goods that satisfy it, and a spillover pass when some of those goods run out.

**Purchasing power** combines income and savings. Savings near `targetSavingsDays` of income are neutral. More savings raise demand and fewer lower it, mostly for needs with a high `wealthElasticity`. The same `savingsFactor` sets the wage workers accept (Labor allocation):

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

`necessitySatisfaction` is the sum of `needConsumed` divided by the sum of `needDemanded` over necessity needs, each valued at its `referenceUnitPrice` so that needs measured in different units add up. `satisfaction` is the same ratio over all needs, with each need also weighted by its tier in `tierWeights`.

### Trade

Trade is computed per edge, per good and per direction, from a snapshot of the state before trade; all flows are applied together afterward. Land, sea and air edges use the same formula. Each edge keeps a **shipping rate** per good and direction (`Edge.tradeFlowPerDay`), which moves toward a target set by the price gap. An area splits its exportable surplus of a good evenly between the edges where that good has a positive gap, and its import demand evenly between the edges it can import it from.

```typescript
transport  = edge.transportCost * good.transportWeight
tariffs    = crossesBorder ? sellerPrice * exportTariffRate[seller] + sellerPrice * importTariffRate[buyer] : 0
gap        = buyerPrice - sellerPrice - transport - tariffs
           - tradeMargin * max(buyerPrice, sellerPrice)          // 0 on an inactive or blocked edge

// The wider the gap, the more of its reserve the buyer refills from this edge each day
targetRate = gap > 0 ? reserveDaysOf(good) * buyerTotalDemandedPerDay
                       * tradeGapSensitivity * gap / buyerPrice / buyerEdgesWithPositiveGap
                     : 0
rate      += fraction(tradeRatePerDay) * (targetRate - rate)
// a fading rate below 1% of the buyer's daily use is set to 0
if (gap <= 0 || good.isService) skip

// The seller keeps part of its reserve and splits the rest between its exporting edges
exportable = max(0, sellerStock - exportReserveShare * reserveDaysOf(good) * sellerTotalDemandedPerDay)
             / sellerEdgesWithPositiveGap
quantity   = min(rate * days, exportable)      // shipments under 0.1% of the buyer's daily use are skipped
unitPaid   = sellerPrice + transport + tariffs + gap / 2   // the buyer and seller split the gain
```

After capacity (below), an area whose imports would cost more than its savings has all of them scaled down by the same ratio: the buyer can only spend what it has, across all its edges and goods together. The seller receives `sellerPrice + transport + gap / 2` per unit, the transport going to its carriers; tariffs go to the respective treasuries.

The rate's inertia keeps trade from sloshing between areas whose prices are almost equal. Scaling by the reserve damps perishable goods as much as durable ones; in exchange they need a wider gap to travel.

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
- Rebuilding air routes runs only on a change of airport level, which is rare. It is a nearest-neighbor search over the airports by straight-line distance, ties going to the lower area id, done in phase 10, never as part of the normal per-tick work. Every port or airport level change also recomputes the capacity of the routes touching that area.
- Blocking works as on land: a route is blocked when its two endpoints belong to governments at war, or when either endpoint is under siege. Naval combat and blockades are possible future additions.

### Prices

Every good has two prices. `smoothedPrice` is the **long-run price**: it drifts while the good stays scarce or abundant, and jobs follow it. `price` is the **market price**: the long-run price times a premium proportional to current scarcity, which trade, consumers and the price table see.

Scarcity is measured by a **pressure** between -1 and 1. Storable goods are priced on stock, with a flow term that reacts before the stock has moved far; exports count in the stock target, so an exporter keeps a reserve for its customers. Perishable goods keep a smaller target, so their reserve never rots faster than `maxReserveSpoilageShare` of demand: bread keeps about 1 day, fish 1.25 days and electricity a third of a day. Services have no stock, so they are priced on flows within the tick.

```typescript
reserveDaysOf(good) = min(reserveDays, maxReserveSpoilageShare / max(good.spoilageRatePerDay, epsilon))
used     = max(demanded, consumed) + inputDemanded + governmentDemanded
         + exportRate * days                                            // exports at the smoothed shipping rates

if (good.isService)
  pressure = (demanded - produced) / max(demanded, produced, epsilon)
else
  target        = reserveDaysOf(good) * used / days
  stockPressure = (target - stock) / max(target, stock, epsilon)
  supplied      = produced + imported - exported
  required      = used + target * (1 - exp(-spoilageRatePerDay * days))  // the reserve's spoilage must be replaced
  flowPressure  = (required - supplied) / max(required, abs(supplied), epsilon)
  pressure      = clamp(stockPressure + priceFlowWeight * flowPressure, -1, 1)

floor          = max(laborValue * priceFloorMultiple, policy priceFloor)
ceiling        = min(laborValue * priceCeilingMultiple, policy priceCeiling)
targetPrice    = smoothedPrice * exp(scarcityPremium * pressure)
logChange      = clamp(fraction(priceAdjustmentRatePerDay) * (log(targetPrice) - log(price)),
                       -log(1 + maxPriceChangePerTick), log(1 + maxPriceChangePerTick))
price          = clamp(price * exp(logChange), floor, ceiling)
smoothedPrice  = clamp(smoothedPrice + fraction(priceSmoothingRatePerDay) * (price - smoothedPrice), floor, ceiling)
```

### Labor allocation

Workers move toward a target allocation: the labor needed to meet total demand, exports included, and to bring the stock back to its reserve, tilted toward jobs whose value added beats the **reservation wage**, the value per hour below which workers would rather stay unemployed. Value added is computed from smoothed prices and after production taxes or subsidies.

```typescript
valueAddedPerHour(good) =
  (smoothedPrice[good] * (1 - productionTaxRate[good])
   - sum over inputs of input.quantity * smoothedPrice[input.good])
  * marginalOutputPerWorker(good) / hoursPerWorkerDay

wageLevel = sum(valueAddedPerHour * privateWorkers) / max(sum(privateWorkers), epsilon)

reservation = reservationWage * savingsFactor          // workers short of savings accept less
needPerDay  = used / days + (isService ? 0 : (reserveDaysOf(good) * used / days - stock) / stockRecoveryDays)
needed(job) = isPrimary ? -capacity * ln(1 - min(needPerDay, 0.95 * capacity) / capacity) / hourlyOutputPerWorker
                        : needPerDay / hourlyOutputPerWorker
target(job) = needed(job) * exp(min(5, (valueAddedPerHour(job) - reservation)
                                       / (laborAllocationTemperature * reservation)))
// scale all targets down together if they exceed the available private workforce; the rest is unemployed
change(job) = fraction(laborMobilityRatePerDay) * (target(job) - workers(job))
// scale all changes down if more than maxLaborShiftPerTick of the workforce would change jobs
```

Each job settles where it adds about the reservation wage: a job adding more grows beyond local need and exports, a job adding less shrinks and its good is imported. Because the reservation wage follows savings, an area importing more than it exports gets cheaper until it exports.

A good is producible in an area if it is primary with natural capacity there, or crafted with a recipe. Workers stuck without inputs see their marginal output fall with the input's ration and drift away.

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
// population and edgeCount (active, non-blocked edges) of the less attractive area
```

Migration reads populations after growth and applies every edge together; migrants leave their savings behind. New inhabitants and migrants join `unemployedWorkers` in proportion to `workforceShare`; the labor phase places them. When population falls, from starvation or emigration, the lost workers (the same `workforceShare` of the loss) are taken from `unemployedWorkers` first, then from private jobs in proportion to their size. Government workers and soldiers are not affected.

### Map generation

A map is generated from a seed, the catalog and `WorldConfig.map`. Every random draw comes from the seeded generator, so the same inputs give the same map.

1. **Cells.** `landAreaCount / landShare` points on a jittered grid with `cellSpacing` spacing over a 3:2 rectangle, relaxed twice toward their Voronoi centroids (Lloyd).
2. **Elevation.** Fractal simplex noise (`elevationOctaves`) minus a radial falloff toward the edges. Cells within 1.5 spacings of the border are water. The sea level is set so the land share gives `landAreaCount` land cells, after water bodies that cannot reach the open sea become land (no lakes) and land masses smaller than `minimumIslandAreas` sink; it is corrected up to four times.
3. **Terrain.** Land cells are ranked by the elevation noise alone: the top 15% are mountains, the next 20% hills. The rest are desert where a moisture noise is low, forest where it is high, and plains otherwise.

| Terrain | Productivity | Land cost factor | Population density |
| --- | --- | --- | --- |
| Plains | 1.0 | 1 | 1.2 |
| Forest | 0.9 | 1.5 | 0.8 |
| Hills | 0.9 | 2 | 0.7 |
| Mountains | 0.7 | 4 | 0.3 |
| Desert | 0.8 | 1.5 | 0.35 |

4. **Areas.** Each land cell is an area. An area is coastal when it borders a water cell; coastal areas get `portLevel` 1. Productivity is the terrain value times 0.9 to 1.1 from noise. Population is the terrain density, ×1.3 on coasts, times 0.6 to 1.4 from noise, scaled to a mean of `meanAreaPopulation`.
5. **Land edges** join neighboring land cells. Distance is between cell centers; `terrainFactor` is the mean land cost factor of the two areas; `travelDays` is `distance / 25 × terrainFactor`.
6. **Sea routes.** Each coastal area is linked to its `seaRoutesPerPort` nearest coastal areas by distance over water (a search over water cells), skipping areas it already shares a land edge with. Then, while some areas cannot reach the others, the shortest water route from the group of area 0 to another group is added.
7. **Natural capacity.** For each primary good, the eligible areas are those whose terrain is in the good's `terrains` (`coast` meaning coastal areas), or all areas if none match. A noise field per good ranks them. The top areas are chosen until both `presence[abundance]` of the eligible areas and enough population to supply world demand with `extractionLaborShare` of its workforce are reached. An area that holds no primary good gets its best-scoring common good, preferring one suited to its terrain. Capacity totals `capacityHeadroom` × reference demand × world population, split in proportion to population × (noise above the cut + 0.2).
8. **Airports.** The `initialAirportShare` most populous areas get airport level 1, then air routes are built (section 5, Sea and air routes).
9. **Capitals.** `governmentCount` capitals: the most populous area, then each next one maximizing hops to the nearest capital over land and sea edges × √population. An area no capital reaches counts one hop beyond the farthest reachable area.

The world is then initialized (Rule 6), a government is founded on each capital (section 6, Founding), and the world is warmed up.

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
- **`terrains`** (optional, primary goods) lists where map generation places the good: `plains`, `forest`, `hills`, `mountains`, `desert` or `coast`.
- **`military`** names the `weaponsGood` used for `WorldConfig.military`.

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
- A terrain is not one of the listed values.

**Conventions used by the shipped catalogs:**

- `transportWeight` is in tonnes per unit, so land transport between neighbors (about 0.3 man-hours per tonne) costs a few percent of the value of most goods. Stone, sand and timber are the exceptions: they barely travel by land and are what sea routes are for.
- Need units are physical where that makes sense (2,000 kcal of food, 10 kWh of energy, 10 passenger-km). Heterogeneous needs such as health, household goods, education and leisure use value units: one unit is one man-hour of that need at reference prices, and each good's `unitsPerGood` equals its labor value.
- Goods that are used together, such as a car and its fuel, are bundled into a service whose recipe consumes both (car travel). Durables enter that service as a small input per use, which stands in for depreciation. The model therefore needs no complementary demand.
- Electricity is a crafted good with a spoilage of 0.3 per day and a near-zero weight. It moves over the grid like any good, but its reserve is only about a third of a day of demand, and imported power loses about a quarter on the way, which stands for grid losses.

**Calibration rule.** At labor-value prices and a purchasing power of 1, the full consumption basket should cost 70–85% of the labor available per person (`hoursPerWorkerDay × workforceShare`, 4 hours by default), and necessities should take roughly 30–40% of the basket. The rest of the labor is left for government jobs, armies and transport. The shipped catalogs use about 73% of the labor; necessities take 32% of the small basket, 29% of the medium one and 35% of the large one.

## 6. Government mechanics

A government touches the private economy through three channels only: policies, market orders and employment. It holds one treasury for the whole realm and one depot per owned area, because money moves instantly but goods must travel.

### Founding

A government is founded on each capital placed by map generation, in capital order.

- **Realm:** the realms split the whole map. Each area joins the capital nearest by distance over active land and sea edges, the earlier capital on a tie; an area with no such path joins the capital nearest in a straight line. No area starts neutral.
- **Color:** each realm in turn takes the palette color (12 colors) least used by its already colored neighbors, then least used overall.
- **Treasury:** starts at `startingTreasuryDays` of the realm's income, `population × workforceShare × hoursPerWorkerDay × wageLevel` summed over its areas.
- **Owned areas:** each starts with an empty depot, no jobs, a `wageOffer` of 1 and no policies.
- **Relations:** every pair of governments starts at peace.
- **Controller:** an idle AI until a player or the AI takes the government over.

### Policies

Each policy plugs into exactly one phase of the tick.

| Policy | Applies per | Phase | Effect |
| --- | --- | --- | --- |
| `productionTaxRate` | Good | Production, Labor | Taxes private output at the market price, and lowers value added, so workers leave the taxed good. Negative values are subsidies. |
| `consumptionTaxRate` | Good | Consumption | Raises the consumer price, so demand drops, mostly for elastic goods. Negative values are subsidies. |
| `importTariffRate` | Good | Trade | Added to the cost of goods entering across a border. |
| `exportTariffRate` | Good | Trade | Added to the cost of goods leaving across a border. A very high value acts as a ban. |
| `headTaxPerPersonPerDay` | Area | Taxes | Flat tax per inhabitant. Reliable revenue that drains savings and drives people away. |
| `priceCeiling`, `priceFloor` | Good | Prices | Clamp the local price. Ceilings cause shortages; floors cause gluts. |

The player sets **realm policies** once and adds **area overrides** where needed.

- A per-good policy set without a good applies to every good. A setting for one good wins over a setting for every good, and an area override wins over any realm setting: settings apply in the order realm every-good, realm one-good, area every-good, area one-good.
- A setting replaces the previous setting of the same policy and good.
- In an override, a null value stands for the neutral value (no tax, no ceiling, no floor), so an override can lift a realm ceiling in one area. A null realm setting removes it.
- Clearing an override falls back to the realm setting.
- Realm settings and overrides are merged into `resolvedPolicies` only when a setting changes or an area changes owner, never during a normal tick.
- Neutral areas have all policies at zero.

### Tax collection

Taxes are owed on this tick's private output and consumption at the market price, plus the head tax:

```typescript
taxDue  = sum over goods of max(0, productionTaxRate) * privatelyProduced * price
        + sum over goods of max(0, consumptionTaxRate) * consumed * price
        + headTaxPerPersonPerDay * population * days
subsidy = the same production and consumption terms for negative rates, as positive amounts
// tariffs were already collected in money during trade

paidInMoney = min(taxDue, area.savings)
shortfall   = taxDue - paidInMoney
// shortfall taken in kind: goods move from area stock to the depot, highest price first, valued at local price
```

The **bill** of a government is the subsidies and wages it owes this tick:
- the subsidies of every owned area;
- government wages, `workers × wageOffer × hoursPerWorkerDay × days` per job.

It is paid from the treasury after taxes are collected. If the treasury cannot pay the whole bill, every payment is scaled by the same `paidShare = treasury / bill`.

### Market orders

The government is a price taker on its own areas' markets. Orders execute in the market phase, after production and before consumption, in order id order, followed by the trades issued by standing orders.

```typescript
// Buy order
if (price <= limitPrice)
  wanted   = min(remainingQuantity, maximumQuantityPerDay * days, treasury / price)
  governmentDemanded += wanted                    // counts in total demand, so producers grow to supply it
  quantity = min(wanted, max(0, stock - reserveDaysOf(good) * inhabitantsDemandedPerTick / days))
  // goods: area stock -> depot; money: treasury -> area savings

// Sell order
if (price >= limitPrice)
  quantity = min(remainingQuantity, maximumQuantityPerDay * days, depot, area.savings / price)
  // goods: depot -> area stock; money: area savings -> treasury
```

`inhabitantsDemandedPerTick` is total demand without `governmentDemanded`, so a government never takes the reserve its inhabitants keep. A completed order is removed; an order on an area the government no longer owns is cancelled.

A purchase lowers stock, so the price rises in the next price phase. Buying cheaply in good years and selling during a famine is a core strategy.

### Depots and transfers

A `transferGoods` command moves goods between two depots of the same government.

- **Route:** the cheapest path by `transportCost` through active, non-blocked edges of every mode.
- **Departure:** the goods leave the source depot at once.
- **Payment:** transport, the sum of `transportCost × transportWeight × quantity` along the route, is paid upfront from the treasury to the savings of the source area, whose carriers do the work.
- **Arrival:** after the sum of the edges' `travelDays`, counting `airFreightDays` for each air route.
- **Losses:** goods spoil in depots and in transit like any stock. Goods arriving at an area the government no longer owns are lost.

### Hiring and wages

The player sets a target number of workers per job and a wage offer per area. Workers come from `unemployedWorkers` first, then proportionally from private jobs.

```typescript
wageAttractiveness = wageOffer / max(area.wageLevel, epsilon)
if (targetWorkers < workers)
  workers = targetWorkers                                            // firing is instant
workers -= workers * fraction(quitRatePerDay) * max(0, 1 - wageAttractiveness, 1 - paidShare)
if (targetWorkers > workers && wageAttractiveness >= 1)
  workers += fraction(hiringRatePerDay) * (targetWorkers - workers)   // capped by available workforce
```

- Hiring, quitting and firing use `economyResponsiveness`.
- Fired and quitting workers return to `unemployedWorkers`.
- A job whose target and workers are both zero is removed.
- If the area's workforce shrinks below its government workers, they are scaled down to fit.

### Government jobs

| Job | Effect |
| --- | --- |
| `produce` | Produces a good with the normal recipe in phase 1. On a primary good, government and private workers share the natural capacity and its output in proportion to workers. A crafted good draws its inputs from the depot, rationed between the government's recipes like private inputs, and adds its output to the depot. |
| `buildInfrastructure` | Adds worker-days to an adjacent land edge. Each `infrastructureWorkerDaysPerStep` multiplies its transport cost by `infrastructureStepFactor`, down to `minimumTransportCostFactor` of the base. |
| `fortify` | Adds worker-days toward the next fortification level of the area, up to `maximumFortificationLevel`. |
| `buildPort` | Coastal areas only. Each `portWorkerDaysPerLevel` raises `portLevel` by one, up to `maximumPortLevel`, which raises the capacity of the area's sea routes. |
| `buildAirport` | Each `airportWorkerDaysPerLevel` raises `airportLevel` by one, up to `maximumAirportLevel`. The first level opens air routes; the maximum level makes the airport a hub. |
| `research` | Adds worker-days to the realm's research. Each `researchWorkerDaysPerLevel` adds `researchProductivityBonus` to productivity in every owned area. |

Worker-days are `workers × days`, accumulated in phase 10.

### Standing orders

Standing orders are rules evaluated at the start of every tick, in each area they name (`"all"` meaning every owned area). Each one issues the same effects a player command would. They keep a large realm manageable, and AI governments are built almost entirely from them.

| Rule | Issues this tick |
| --- | --- |
| `keepDepotStock` | A buy of `targetDaysOfDemand × inhabitants' daily demand − depot`, at most `maximumBuyPrice` |
| `sellAbovePrice` | A sale of `depot − keepDaysOfDemand × inhabitants' daily demand`, at least `minimumPrice` |
| `buyBelowPrice` | A buy of `maximumDepotQuantity − depot`, at most `maximumPrice` |

Their trades execute in the market phase like market orders. Each trade is paced at `standingOrderShareOfDemandPerDay` of the inhabitants' daily demand for the good, of its daily production, or of the trade's own quantity, whichever is largest. The last keeps orders working for goods nobody else uses, such as weapons.

## 7. War and conquest

War is an economic activity: soldiers are withdrawn from the workforce and paid from the treasury, wear out weapons and cut trade. Conquest happens by besieging an undefended area until it changes owner.

### Relations

Every pair of governments is at `peace` or `war`. A `declareWar` command takes effect immediately, on both sides. Peace needs a `proposePeace` command accepted by the other side; a proposal can transfer areas and include a money payment.

An edge is **blocked** when its two areas belong to governments at war, or when either area is under siege. Blocked edges carry no trade, migration or depot transfers. Armies still cross them.

### Militia

Every area defends itself with a militia, beside its owner's armies. `Area.militia` is `population × militiaShare` (default 2%) whenever no attacker is present. Combat depletes it, and militia losses are also losses of population. The militia has no equipment. Once it falls below one soldier and no defending army is left, the attackers besiege the area. A captured area's militia restarts, now defending its new owner. Areas can still become neutral through code paths such as peace terms in later stages; they defend with their militia alone.

### Armies

- **Recruiting** takes soldiers from the area's unemployed workers first, then from private jobs, and removes them from the population. A new army carries nothing and holds.
- **Disbanding** returns soldiers to the population of the area where the army stands (or the area it left, while marching) as unemployed workers. A fully disbanded army leaves what it carries in its government's depot there, or in the area's stock if the government does not own the area.
- **Marching** follows the fastest path by `travelDays` over active land and sea edges. Crossing an edge takes its `travelDays`; each tick an army covers `days × militaryResponsiveness` days of travel, carrying leftover days into the next edge. A new order replans from the area the army stands in or is heading to.
- **Sea crossings** are allowed only from an area owned by the army's government with `portLevel` ≥ 1. This is checked when the path is planned and again when the army sets out; an army that can no longer embark stops. So an invasion by sea needs a friendly port to embark from. Armies never use air routes.
- **Attacking.** An army in `attack` stance attacks every area it stands in that is neutral or owned by a government at war with its own. It stays there until the area falls or the war ends, then follows the rest of its path. An army in `hold` stance never attacks and passes through.
- **Wages** of `government.soldierWage × hoursPerWorkerDay × soldiers × days` go from the treasury into the savings of the area where the army stands (or the area it left). They join the government's bill and are scaled down with it when the treasury is short (section 6, Tax collection). The player sets the wage with `setSoldierWage`.

### Equipment and desertion

- **Equipment** (phase 3). An army standing in an area of its own government takes weapons from the local depot, up to one per soldier. Carried weapons wear out at `weaponWearRatePerDay` in phase 10.
- **Desertion** (phase 7, after taxes). Soldiers desert like government workers quit: at `desertionRatePerDay × max(0, 1 − soldierWage / realm wage level, unpaid share)`, scaled by `militaryResponsiveness`. The realm wage level is the population-weighted mean `wageLevel` of the government's areas; the unpaid share is what the treasury could not pay this tick. Deserters join the population of the army's area as unemployed workers.

An army with fewer than one soldier is disbanded.

### Power

```typescript
equipment    = min(1, weapons / max(soldiers, epsilon))
powerPerSoldier = 1 + equipment                       // an equipped soldier counts double
armyPower    = soldiers * powerPerSoldier
defensePower = (sum of defending army power + militia) * (1 + fortificationLevel)
```

Defenders are the area's militia and its owner's armies in the area (any stance). Attackers are the attacking armies standing there (see Armies).

### Combat

Combat runs every tick in an area where attackers and defenders are both present. It is a simplified Lanchester model:

```typescript
k = combatLethalityPerDay * militaryResponsiveness * days
attackerSoldiersLost = min(attackerSoldiers, k * defensePower / attackerPowerPerSoldier)
defenderSoldiersLost = min(defenderSoldiers, k * attackPower / defenderPowerPerSoldier)
// powers per soldier are averages over each side; militia counts as defenders with power 1
// losses are shared across the armies of each side (and the militia) in proportion to their soldiers
// militia losses reduce the area's population
```

Each tick of fighting also destroys `fraction(battleStockDestructionPerDay)` of the area's stock and kills `fraction(battleCivilianLossPerDay)` of its population.

Several governments attacking the same area fight the defender together. Armies of governments at war with each other fight only in an area owned by one of them; in a neutral or third area they ignore each other.

### Siege and capture

Once no defender is left, the attacking government with the most attack power present besieges the area. It becomes `besiegingGovernment`, and the area's edges are blocked. If another government takes the lead, progress restarts from zero.

```typescript
siegeProgress += siegeRatePerDay * militaryResponsiveness * days
               * leaderAttackPower / ((1 + fortificationLevel) * max(population, 1))
```

With default values, 1,000 equipped soldiers take an unfortified area of 10,000 people in about 20 days, plus a few days to defeat its militia.

Without attackers, siege progress decays:
- by `fraction(siegeDecayRatePerDay)` per tick, scaled by `militaryResponsiveness`;
- also by 0.005 per day, so it reaches zero.

At zero, `besiegingGovernment` is cleared.

When `siegeProgress` reaches 1, the area changes owner. The same rules apply to every transfer, including peace treaties:

- The area's owner becomes the besieger, and its fortification level drops by one. Siege progress and militia are reset.
- The old owner's depot in that area is merged into the new owner's depot there.
- The old owner's government jobs there end; their workers become unemployed. Its market orders on the area are cancelled.
- The new owner's realm policies apply.
- If it was the old owner's capital, the capital moves to its most populous remaining area.
- A government with no area left is eliminated:
  - its armies disband where they stand;
  - its orders, standing orders, depot transfers and peace proposals are dropped;
  - its `capital` becomes null.

### Peace

**Proposing.** A proposal goes from one government to another it is at war with. It lists areas, each owned by one side and going to the other, and a payment from the proposer (negative to demand one). It expires at a future game day; expired proposals are dropped in phase 0.

**Accepting.** The answer is rejected if the payer's treasury cannot cover the payment, or if a listed area has changed hands. On acceptance:
- the relation becomes `peace`;
- the listed areas are transferred with the same rules as a capture, with capitals and eliminations settled after all transfers;
- the payment moves between treasuries;
- every other pending proposal between the two governments is dropped.

## 8. Simulation tick

One tick runs eleven phases in a fixed order, and each phase runs over every area before the next one starts. Trade, migration and combat read a snapshot and apply their results together, so the outcome never depends on the order areas are processed in.

```typescript
function runTick(world: World, commands: CommandEnvelope[]): CommandRejection[] // { envelope, reason }
```

0. **Commands and automation.** Validate each command against its sender's government and apply it, in order; `runTick` returns the rejected ones with their reasons. Rebuild `resolvedPolicies` where a setting changed. Handle war declarations, peace answers and expired proposals. Evaluate AI decisions and standing orders, which produce the same effects. Recompute `Edge.isBlocked`.
1. **Production.** For each good in catalog order: primary goods with diminishing returns on natural capacity, crafted goods limited by labor and by inputs rationed between their users. Private output goes to area stock, government output to depots. Production taxes and subsidies are owed on private output. Record `produced`, `inputDemanded`, `outputLimitedByInputs` and the marginal output per worker.
2. **Government market and logistics.** Execute buy and sell orders at local prices, then the trades issued by standing orders. Advance depot transfers and deliver those that arrive.
3. **Consumption and army equipment.** Compute purchasing power from wage level and savings. Compute demand per need at consumer prices including consumption tax, split it between substitutes, consume from stock, then run the spillover pass. Compute `satisfaction` and `necessitySatisfaction`. Then armies standing in their own areas take weapons from the local depot.
4. **Trade.** From the snapshot, move each edge's shipping rates toward their targets and compute flows per active, non-blocked edge of every mode, good and direction, including transport and tariffs. Cap sea and air routes at their capacity and imports at the buyer's savings. Apply all goods and money movements together. Record `imported` and `exported`.
5. **Taxes, subsidies and wages.** Collect taxes from savings, with the shortfall taken in kind. Pay subsidies, government wages and soldier wages from the treasury, scaled down together if the treasury is short.
6. **Prices.** Measure each good's scarcity against its stock target and flows, or for services against production and demand. Move each price toward the smoothed price times the scarcity premium, within the per-tick limit and the price bounds, then move `smoothedPrice` toward the price.
7. **Labor.** Compute value added per job from smoothed prices and production taxes, and update `wageLevel`. Move private workers toward the labor each job needs, tilted by value added against the reservation wage, within `maxLaborShiftPerTick`. Then apply government hiring, quitting and firing, and soldier desertion.
8. **Military.** Move marching armies. Resolve combat in contested areas and refill the militia of areas without attackers. Advance or decay sieges. Transfer captured areas, move capitals and eliminate governments with no area left.
9. **Population.** Apply growth or starvation from `necessitySatisfaction`. Compute migration along active, non-blocked edges from the snapshot, scaled by each edge's mode, and apply it together.
10. **Decay and progress.** Spoil stock, depots and transfers, and wear out carried weapons. Regenerate natural capacity: `capacity += (maximum - capacity) × (1 - exp(-regenerationRatePerDay × days))`. Apply infrastructure, fortification, port, airport and research progress. If any port or airport level changed, update the capacity of the routes touching it; if an airport level changed, also rebuild the air routes. Increment `tick` and add `gameDaysPerTick` to `gameDay`.

All randomness (AI choices, tie-breaks, future events) uses the seeded generator in `World.randomSeed`, so a saved game with the same command log replays identically on the same device.

## 9. Architecture and stack

Everything is TypeScript and runs in the browser. The host's browser runs the simulation in a Web Worker; joining players connect through PeerJS, send commands and draw the snapshots they receive.

&#91;embedded content: architecture · host browser, joining players, signaling\]

Only the host simulates. The signaling broker is used only to set up connections; game traffic then flows directly between browsers, or through a TURN relay when their networks keep them from reaching each other.

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

The worker runs a timer loop targeting `1000 / maxTicksPerSecond` milliseconds per tick. Each iteration drains the command queue, runs one tick and, at the snapshot rate, builds one snapshot per viewer: the local player's goes to the main thread using transferable buffers, and each joined player's or spectator's is packed (see Encoding) for the main thread to forward. When a tick takes longer than its budget, the loop runs as fast as it can and still yields between ticks. The loop exists from map creation, paused, so players can join while the host chooses its realm.

The main thread forwards local and remote commands to the worker, updates its own store from the local snapshots, and forwards the packed ones to their players. Pause and speed changes are messages to the worker, never simulation commands.

### Messages

From a joining player to the host:

| Message | Content |
| --- | --- |
| `hello` | Protocol version, player name, player token |
| `choose` | A government to take, or none to watch as a spectator |
| `command` | One command; the host acts for the government the player holds |
| `setFlowGood` | The good whose trade flows the player's snapshots carry, or none |
| `focus` | The area the player looks at: its detail comes in every snapshot |
| `leave` | The player leaves for good, freeing its realm |

From the host to a joining player:

| Message | Content |
| --- | --- |
| `welcome` | The player's lobby entry, the static data and the government summaries |
| `refused` | Why the host turned the player away (another protocol version, an invalid token, no game yet) |
| `lobby` | Every player: name, role (choosing, player or spectator), government held, online, host; whether the game started |
| `you` | The player's own entry, when its role changes |
| `notice` | A refused choice, or news from the host |
| `snapshot` | Dynamic state for the player's government (below) |
| `priceTable` | Prices of every good in every area (below) |
| `commandRejected` | The rejected command and the reason |
| `hostStatus` | Paused, the host's tab hidden, speed, ticks per second, milliseconds per tick, tick |

### Encoding

- Messages are msgpack. Typed arrays travel as msgpack extensions holding their little-endian bytes; a `Float32Array` with fewer than a quarter of its entries nonzero travels sparse, as index and value pairs.
- Each message is then compressed with raw deflate and cut into frames of at most 64 KiB, each with a 9-byte header (frame format version, message id, frame index, frame count). Data channels are reliable and ordered, so frames are joined in order.
- Snapshots for joined players are built and packed in the simulation worker; the price table is packed once for all of them.
- **Flow control:** when a player's channel holds more than 1 MiB not yet sent, its snapshots and price tables are skipped until it drains.

### Snapshots

The host broadcasts snapshots at `snapshotRate` (default 3 per second), independent of the tick rate. A snapshot contains:

- `tick` and `gameDay`.
- Per area, for every area: owner, population, wage level, satisfaction, port, airport and fortification levels, siege progress and besieger, and militia.
- The receiving player's **visible areas**, its owned areas and their direct neighbors, and for them savings, unemployed workers, and the price, stock, produced, consumed, imported, exported, private worker and natural capacity arrays. Other areas' stocks and flows are not sent. A joined player receives this detail in turns: each snapshot carries its focused area and the next 48 visible areas, and its interface keeps the last detail of each visible area. The local player receives all of it every time.
- The static data sent once at the start also carries every area's maximum natural capacity per good.
- Per edge: transport cost, capacity, active and blocked state, plus the full data of any route edge created since the last snapshot.
- Per edge, the flows of the last tick, in units per game day: net migrants (positive from area A to area B) and tonnes carried in each direction. When the receiver watches one good, also that good's units carried in each direction. Flows are public, like prices.
- All armies, relations and pending peace proposals.
- The receiving player's full government state (treasury, depots, jobs, orders, policy settings); other governments as a public summary. Policies in force are not sent: the receiver resolves them from the realm settings and the area overrides, as the host does.
- A spectator's snapshot has no visible areas and no government.

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

1. The host clicks Invite players. Its browser creates a PeerJS peer with a random id and shows the link `https://<site>/?<query>#join=<peer id>`. The query keeps the page's settings and always names the host's broker (`peer=`, below), so a joining page built with another broker still finds the host.
2. The joining player opens the link and gives a name; its browser opens a reliable data channel to the host and sends `hello`.
3. The host answers `welcome`, and the player appears in the lobby. Players can join before the host starts and during the game.

**Players.** A joining player is identified by a random token its tab keeps in `sessionStorage`. The host sets the controller of the government it takes to `{ kind: "human", player: token }`. Commands act for the government their connection's player holds; the host never takes the player from the message. A player chooses a realm no one else holds and that is not eliminated, or watches as a spectator. Taking another realm gives the previous one back to the idle AI. Only the host controls time.

**Dropped connections.** A joining player whose connection drops retries after 1, 2, 4 and 8 seconds, then every 8 seconds, and gives up 2 minutes after the drop. A `hello` with the same token, from a reconnection or a reload of the same tab, restores the player's role and realm, and the host sends `welcome` again. While a player is offline, its realm stays reserved for it and idle; the host can release it, and another player can then take it.

**Broker.** The game's own broker is a Cloudflare Worker (`apps/broker`) speaking the PeerServer protocol, with every peer's WebSocket in one Durable Object. A build setting (`VITE_BROKER_URL`) gives its address; a build without it uses the free PeerJS cloud broker. A `?peer=host:port[/path]` query setting points the game at another broker, such as the Worker run locally (`pnpm broker`, port 8787), which the end-to-end tests and local network play use.

- **Protocol.** `GET /peerjs/id` gives a random id. The WebSocket `/peerjs?key=peerjs&id=&token=` answers `OPEN`, or `ID-TAKEN` when another token holds the id; the same token takes the id over. `OFFER`, `ANSWER`, `CANDIDATE`, `LEAVE` and `EXPIRE` go to the peer named by `dst`, with `src` set to the sender's id. Nothing is queued: an offer to an absent peer is answered at once with `EXPIRE`, and other messages to it are dropped. `HEARTBEAT` is ignored, and messages over 64 KB are dropped.
- **Origins.** Pages from origins outside the Worker's `ALLOWED_ORIGINS` list are refused.
- **ICE servers.** Before creating its peer, each browser asks the broker's `GET /ice` for ICE servers: Cloudflare STUN and TURN, with credentials minted by the Worker from its TURN key and valid for 24 hours, without port 53 URLs. A browser reuses them until an hour before they expire. When the broker has no TURN key, does not answer within 5 seconds, or the broker is the PeerJS cloud, PeerJS's default servers apply: Google's public STUN, without a working relay.
- **Relay check.** `?relay=1` allows relayed connections only, to check that TURN works; it travels in the join link like `?peer=`.

### Hosting on mobile

- A host keeps its game running while its tab is hidden: the simulation runs in a worker, which desktop browsers keep running. Phones freeze hidden tabs, so `hostStatus` tells players whether the host's tab is hidden.
- The host requests a Screen Wake Lock while its game runs and its tab is visible, and releases it when paused or hidden.
- The default `maxTicksPerSecond` is lower on mobile devices.

### Save and load

The world is serialized with msgpack, keeping typed arrays, plus a save format version number. The host autosaves to IndexedDB at a fixed game-day interval and can export the save as a file. Any player can load a save and host it, which is how a game continues when the host leaves.

### Single player

A solo game uses the same data flow as a hosted one, without the network. The worker posts five kinds of messages to the main thread:

| Message | When | Content |
| --- | --- | --- |
| `progress` | During map generation and warm-up | A stage name and a share done |
| `static` | Once the world is ready | Config, needs, goods, area names, positions and terrain, edges, map layout, governments' names and colors |
| `snapshot` | At `snapshotRate` | As in Snapshots, for the local player's government |
| `priceTable` | At `priceTableRate` | As in Price table |
| `status` | With every snapshot, and on rejections | Running or paused, target and actual ticks per second, milliseconds per tick, and rejected commands with their reasons |

The main thread sends `create`, `start` (with the local player's government, or none to watch), `command`, `setSpeed`, `pause`, `resume`, `endGame`, and `setFlowGood` to choose the good whose trade flows snapshots carry (none by default). While paused, `setFlowGood` is answered with a snapshot at once. The local player sends commands under the player id `local`.

When hosting, `command` and `setFlowGood` may name a joined player, `player` sets a joined player's government and whether it receives snapshots, and `focus` names the area it looks at. The worker then also posts `remote` messages, packed for one player or for all of them, and rejections name the player they are for.

## 10. Interface

The interface is map-first: the map fills the screen and panels sit beside it on desktop, or below it on a phone. It reads only what a snapshot and the price table carry, so a joined player sees exactly what a solo player sees.

### Screens

1. **Join.** Opening a join link asks for the player's name, then connects; a reload of the same tab rejoins without asking. The host's refusal or an unreachable host is shown.
2. **New game.** The player picks a catalog (small, medium or large), a map size (300, 1,000 or 3,000 areas), the number of realms (4, 6, 8, 12, 16, 24 or 32, at most one per 8 areas; default 8) and a seed. The map is then generated and warmed up in the worker, behind a progress bar. Finally comes the **lobby**: the founded governments with capital, population, area count and the player holding each. Each player picks a free realm, takes a random one or watches. The host can invite players there (a join link with a Copy button), see who is online, and release the realm of a player who went offline. The host's pick starts the game; a joined player enters once the host accepts its pick.
3. **Game.** The map, the top bar and the panels.
4. **End of session.** Shown when the player's government is eliminated, or when the player ends the game. It lists days played, peak and final population, areas held and treasury, and offers a new game. There is no score.

### Map

Areas are the Voronoi cells of their positions, with the water cells around them.

| Layer | Colors each area by |
| --- | --- |
| Realms | Owner color; neutral areas in grey. Realm borders are drawn on every layer |
| Population | Population, one hue on a log scale between the map's smallest and largest areas |
| Prices | The chosen good's price over its labor value, on a log scale from blue (cheap) through white to red (dear) |
| Resources | The chosen good's maximum natural capacity, brighter for more, relative to the best area; grey where there is none |
| Satisfaction | Necessity satisfaction, from red (0) to green (1) |
| Average wage | Wage level (mean value added per private worker-hour) on a log scale |
| Terrain | Terrain type |

**Flows** are a separate choice, drawn over any layer:

| Flows | Draws |
| --- | --- |
| None | Nothing (the default) |
| Migration | An arrow per edge for the net migrants of the last tick |
| Transport | An arrow per edge and direction for the goods carried in the last tick: every good in tonnes, or one good chosen in the legend in its own units |

**Flow arrows** run from 20% to 80% of the segment between two area centers, with a dark outline. Their width grows from 1 to 6 px with the square root of the flow over the largest flow on the map. Transport arrows sit to the right of their direction, so the two directions of an edge stay apart. Flows under 3% of the largest are left out, as are arrows with less than 14 px of room on screen (they appear when zooming in), and at most the 2,500 largest flows are drawn. The legend shows sample arrows with their values.

One layer and one flow choice are active at a time, each with its own legend, stacked bottom left. Every layer also shows:

- **Routes:** sea routes dashed, air routes dotted; blocked edges red.
- **Capitals:** a star.
- **Armies:** a marker in their government's color, with their remaining path.
- **Sieges:** a ring showing their progress.
- **Selection:** the selected area is outlined.

Mouse or one finger pans and the wheel or a pinch zooms around the pointer. A click or tap selects the area under it. While the player moves an army or picks areas for a peace proposal, a click picks the target instead.

### Panels

| Panel | Shows | Actions |
| --- | --- | --- |
| Area | Owner, terrain, population, average wage, satisfaction, port, airport and fortification levels, siege; for own areas and their neighbors, savings per person and unemployed; natural resources (maximum capacity, and current capacity and extraction where detail is sent). Defense of every area: militia, the owner's army power, fortification and defense power; for areas not the player's, also the soldiers needed to win and the siege time. For own areas and their neighbors: price, stock, production, consumption and trade per good. For other areas: prices only | Sort the market table by any column |
| Good | Lowest, median and highest price with their areas; a chart over time of the world's lowest, median and highest price and the selected area's price | Show the good on the price map |
| Realm | Treasury and its change per day, realm population and areas, research level, charts of treasury and population; the players and their realms | Invite players and release offline players' realms (host); end the game, or leave it (joined player) |
| Policies | Every tax and price control, realm-wide and per area; the setting in force for the chosen area, policy and good | Set or remove a policy for all areas or one area, and for one good or all goods. The production tax is chosen first. Taxes and tariffs have a slider from −100% to +100% (the number field takes up to 500%), head tax one from 0 to 2 mh per person per day; ceilings and floors take a number. The value starts at the setting in force, and Set applies it |
| Orders | Depot contents per area, open market orders, standing orders, depot transfers in transit | Place and cancel market orders in any own area; add and remove standing orders; transfer goods between depots |
| Jobs | For one own area or the whole realm: the workforce split between private jobs, government jobs and unemployment, and private workers, output per day and output per worker by good. Per own area: each job's target and workers, and the wage offer | Set job targets and wage offers |
| Armies | Soldier wage, realm average wage, soldiers and their pay per day; weapons in depots and being bought; each army's soldiers, equipment, power, stance, location and path | Set the soldier wage, recruit, buy weapons, set stance, move (then pick the destination on the map), disband |
| Diplomacy | Relations with every government, pending proposals | Declare war; propose peace (payment and areas picked on the map); accept or refuse proposals |

A rejected command is shown as a short message with its reason.

**Joined players** see the host's time state (running at a speed, or paused) instead of the time controls, and a banner while the connection is down, the host has paused, or the host's tab is hidden. **Spectators** get the Area and Goods panels only.

Numbers show at most two decimals, and none from 100 up; from 10,000 they are compact (24.3k, 1.23M). A nonzero value too small to show reads "<0.01". Quantities that are whole by nature, such as people, workers, soldiers and days, show as whole numbers (24,312), compact only from a million.

### Time controls

The top bar holds pause and four speeds: 1×, 2× and 5× (`maxTicksPerSecond` 2, 5 and 10) and max, which runs ticks back to back. It shows the game day, the treasury, the actual ticks per second and the milliseconds per tick. Space toggles pause. A solo game pauses while its tab is hidden; a hosted game keeps running.

### Layout

- **Desktop** (900 px wide and more): the map fills the window, under a top bar. A sidebar on the right holds the panels as tabs. It is 380 px wide by default; dragging the divider between map and sidebar resizes it between 280 px and the smaller of 900 px and 70% of the window, arrow keys nudge it, and a double-click restores the default. The width is remembered on the device.
- **Phone:** the map fills the screen under a compact top bar. The panels sit in a bottom sheet with three heights: a peek showing the selection, half the screen, and full screen. Touch targets are at least 44 px.
