[Specification](README.md) · section 2 of 10

## 2. Data model

The world is plain serializable data, owned by the simulation worker on the host. Per-good values are stored as `Float64Array`s indexed by `GoodId`, so each phase is a tight loop over typed arrays. `WorldConfig` is defined in section 3.

### Identifiers and world

```typescript
type GoodId = number;        // index into World.goods
type NeedId = number;        // index into World.needs
type AreaId = number;        // index into World.areas
type EdgeId = number;        // index into World.edges
type GovernmentId = number;  // index into World.governments
type ArmyId = number;        // unique id of an army, never reused
type PlayerId = string;      // PeerJS peer id of a connected human player
type WaterId = number;       // index into World.waters

interface World {
  tick: number;                         // number of ticks simulated since the game started
  gameDay: number;                      // elapsed game time in days (sum of gameDaysPerTick over all ticks)
  config: WorldConfig;                  // all tunable parameters, including pace (section 3)
  needs: Need[];                        // needs of the population, each satisfied by one or more goods
  goods: Good[];                        // catalog of goods, sorted so that every input comes before its outputs
  areas: Area[];                        // every area on the map
  waters: WaterCell[];                  // every water cell of a generated map; empty for hand-built worlds
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
  width: number;                        // map size in map units (km): the rectangle the cells tile
  height: number;
}
// Cells for rendering are the Voronoi cells of the area positions followed by the water cells' positions.

// A cell of sea (section 4, Map generation): no people, owner or market, but natural capacity that the ports
// reaching it extract (section 5, Infrastructure).
interface WaterCell {
  id: WaterId;                          // index of this cell in World.waters
  position: { x: number; y: number };   // map coordinates of the cell's center
  depth: number;                        // hops over water from the nearest land; 1 for a cell touching a coast
  neighbors: WaterId[];                 // neighboring water cells
  coasts: AreaId[];                     // neighboring land areas, all coastal
  naturalCapacity: Float64Array;        // per good: current maximum extraction per day, after depletion
  naturalCapacityMaximum: Float64Array; // per good: capacity the cell recovers toward
}

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
  terrains: (Terrain | "coast" | "sea" | "offshore")[]; // primary goods: where map generation places capacity; empty = anywhere on land
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
  terrain: Terrain;                     // set by map generation: sets productivity and land transport cost
  isCoastal: boolean;                   // set by map generation: the area touches navigable water
  // Infrastructure (section 5, Infrastructure): built levels, 0 (none) to infrastructure.maximumLevel
  portLevel: number;                    // coastal areas only: raises the capacity of the area's sea routes
  airportLevel: number;                 // raises the capacity of the area's air routes
  roadLevel: number;                    // lowers the transport cost of the area's land edges
  fortificationLevel: number;           // multiplies the area's defense
  staffing: Float64Array;               // per kind (port, airport, roads, fort): staffed share of the quota, 0 to 1
  siegeProgress: number;                // 0 to 1; the area changes owner when it reaches 1
  militia: number;                      // militia still standing (section 6, Militia)
  besiegingGovernment: GovernmentId | null; // government currently besieging the area, if any

  // Per-good arrays, indexed by GoodId
  stock: Float64Array;                  // units stored privately, available to consume or export
  price: Float64Array;                  // current local market price, in man-hours per unit
  smoothedPrice: Float64Array;          // slow moving average of price, used for job decisions (section 3)
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
  averageWage: number;                  // average value added per private worker-hour, in man-hours
}

type EdgeMode = "land" | "sea" | "air";

interface Edge {
  id: EdgeId;                           // index of this edge in World.edges
  mode: EdgeMode;                       // land border, sea route between two ports, or air route between two airports
  isLane: boolean;                      // sea lane between neighboring coasts: armies sail it, goods and migrants do not
  areaA: AreaId;                        // first connected area (edges are undirected)
  areaB: AreaId;                        // second connected area
  distance: number;                     // map distance; sea routes use the distance over water
  baseTransportCost: number;            // man-hours to move one tonne across, before roads
  transportCost: number;                // current cost, lowered by the roads of both areas (land only)
  capacityPerDay: number;               // largest tonnage carried per game day in each direction; Infinity on land
  travelDays: number;                   // game days an army needs to cross this edge; Infinity on air routes
  isActive: boolean;                    // false for a route dropped by a rebuild; edges are never deleted
  isBlocked: boolean;                   // recomputed each tick: true when war or a siege stops all traffic
  tradeFlowPerDay: Float64Array;        // per good and direction (index 2 × GoodId, + 1 for B to A): current shipping rate, units per day
}
```

Land edges join neighboring areas and never change. Map generation lays **sea lanes** between neighboring coasts. Sea and air edges between ports or airports are **routes**, rebuilt when ports or airports open, close or grow (section 4, Sea and air routes). Every system that walks edges, including trade, migration and marching, handles all three modes the same way, apart from the rules listed for each mode. `Area.edges` lists edges of all modes.

### Governments

```typescript
type GovernmentJob = { kind: "produce"; good: GoodId }; // state production; output goes to the local depot

type InfrastructureKind = "port" | "airport" | "roads" | "fort"; // per-kind arrays follow this order

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
  | "staffWageShare"                    // per area: infrastructure staff pay, as a share of the area's average wage
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
  staffWageShare: number | null;        // for this area; null: infrastructure.defaultStaffWageShare
  priceCeiling: Float64Array;           // per good; Infinity when there is no ceiling
  priceFloor: Float64Array;             // per good; 0 when there is no floor
}

interface GovernmentAreaState {
  depot: Float64Array;                  // goods owned by the government in this area, indexed by GoodId
  jobs: JobAssignment[];                // government jobs in this area
  wageOffer: number;                    // wage paid per worker-hour, in man-hours (1 = reference wage)
  targetLevel: Uint8Array;              // per InfrastructureKind: the level to build up to
  buildDays: Float64Array;              // per InfrastructureKind: days of construction done toward the next level
  staff: Float64Array;                  // per InfrastructureKind: workers running the built levels
  policyOverrides: PolicySetting[];     // exceptions to the realm defaults for this area
  resolvedPolicies: ResolvedPolicies;   // realm defaults merged with overrides, ready for the tick
}

interface Government {
  id: GovernmentId;                     // index of this government in World.governments
  name: string;                         // display name of the realm
  color: string;                        // map color of the realm
  controller:                           // who issues this government's commands
    | { kind: "human"; player: PlayerId }
    | { kind: "ai" };
  personality: "trader" | "builder" | "conqueror" | "idle"; // how the AI runs the realm whenever it controls it
  aiMemory: AiMemory | null;            // what the AI keeps between decisions (section 10); null before its first
  capital: AreaId | null;               // capital area; null once the government is eliminated
  isEliminated: boolean;                // true once the government owns no area
  treasury: number;                     // government money for the whole realm, in man-hours
  ownedAreas: AreaId[];                 // cache of the areas whose owner is this government
  areaStates: Map<AreaId, GovernmentAreaState>; // depot, jobs, wage and policies per owned area
  realmPolicies: PolicySetting[];       // default policies applied to every owned area
  marketOrders: MarketOrder[];          // open buy and sell orders
  standingOrders: StandingOrder[];      // automation rules evaluated every tick
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
  | { type: "setJobTarget"; area: AreaId; job: GovernmentJob; targetWorkers: number }
  | { type: "setWageOffer"; area: AreaId; wageOffer: number }
  | { type: "setInfrastructureTarget"; area: AreaId; kind: InfrastructureKind; level: number }
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
| Policies | Production and consumption tax rates and tariffs must be within [−1, 5]; head tax any finite number (negative: an allowance); ceilings and floors ≥ 0; the staff wage within [0, 5]. Head tax and the staff wage take no good; every other policy takes one good, or none for every good |
| Wages | `wageOffer` and the soldier wage must be within [0, 10] |
| Recruiting | At least one soldier, and no more than the area's unemployed and private workers |
| Armies | `moveArmy` needs a reachable destination under the marching rules; `disbandArmy` at most the army's soldiers |
| Jobs | `produce` never a service, and a primary good only where the area has natural capacity for it |
| Infrastructure | A level is a whole number within [0, `maximumLevel`]; a port above 0 only in a coastal area |
| Goods | Market orders and standing rules never name a service |
| Diplomacy | No war on oneself, an eliminated government or one already at war; peace only with a government at war, from the sending government, expiring in the future, with each listed area going from one side to the other; when accepted, a payment must fit in the payer's treasury and the listed areas must still belong to their side |
| Limits | At most 1,000 open market orders and 200 standing orders per government, so a client cannot slow the host down |
