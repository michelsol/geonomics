// Data model from specification §3. The world is plain serializable data; per-good values are typed arrays
// indexed by GoodId so each tick phase is a tight loop.
import type { WorldConfig } from "./config";

export type GoodId = number; // index into World.goods
export type NeedId = number; // index into World.needs
export type AreaId = number; // index into World.areas
export type EdgeId = number; // index into World.edges
export type GovernmentId = number; // index into World.governments
export type ArmyId = number; // unique id of an army, never reused
export type PlayerId = string; // PeerJS peer id of a connected human player

export interface World {
  tick: number; // number of ticks simulated since the game started
  gameDay: number; // elapsed game time in days (sum of gameDaysPerTick over all ticks)
  config: WorldConfig; // all tunable parameters, including pace (section 4)
  needs: Need[]; // needs of the population, each satisfied by one or more goods
  goods: Good[]; // catalog of goods, sorted so that every input comes before its outputs
  areas: Area[]; // every area on the map
  edges: Edge[]; // every connection between two areas
  governments: Government[]; // every government, human or AI, including eliminated ones
  armies: Map<ArmyId, Army>; // every army currently in the field
  relations: Relation[][]; // relations[a][b]: diplomatic state between governments a and b (symmetric)
  peaceProposals: PeaceProposal[]; // peace offers waiting for an answer
  nextArmyId: ArmyId; // next id to assign to a newly recruited army
  nextOrderId: number; // next id to assign to a market or standing order
  randomSeed: number; // state of the seeded random generator, so runs are reproducible
  map: MapLayout | null; // geometry of a generated map; null for hand-built worlds
}

/** What rendering needs beyond area positions: Voronoi cells are rebuilt from area positions then water points. */
export interface MapLayout {
  width: number; // map units (km)
  height: number;
  waterPoints: Float64Array; // x, y pairs of the water cells' centers
}

export type Terrain = "plains" | "forest" | "hills" | "mountains" | "desert";

export type Relation = "peace" | "war";

// Needs and goods

export type DemandTier = "necessity" | "comfort" | "luxury";

export interface Need {
  id: NeedId; // index of this need in World.needs
  key: string; // stable identifier used in catalog files, for example "food"
  name: string; // display name, for example "Food"
  unit: string; // what one need unit represents, for display only, for example "2,000 kcal"
  tier: DemandTier; // importance of the need
  demandPerPersonPerDay: number; // need units one inhabitant wants per game day at reference prices
  priceElasticity: number; // how fast demand falls as the need's price rises above reference (0 = rigid)
  wealthElasticity: number; // how fast demand rises with purchasing power (luxuries > 0)
  substitutionElasticity: number; // how strongly consumers switch to the cheaper goods of this need
  referenceUnitPrice: number; // derived at startup: price of one need unit when all prices equal labor value
}

export interface NeedSatisfaction {
  need: NeedId; // need this good satisfies
  unitsPerGood: number; // need units provided by one unit of the good
  preference: number; // relative share of consumption when unit prices are equal
}

export interface RecipeInput {
  good: GoodId; // input good consumed by the recipe
  quantity: number; // units of the input consumed per unit of output
}

export type Abundance = "common" | "regional" | "rare";
export type TerrainAffinity = Terrain | "coast";

export interface Good {
  id: GoodId; // index of this good in World.goods
  key: string; // stable identifier used in catalog files, for example "bread"
  name: string; // display name, for example "Bread"
  unit: string; // what one unit represents, for display only, for example "kg"
  laborHoursPerUnit: number; // worker-hours to produce one unit at productivity 1
  inputs: RecipeInput[]; // goods consumed per unit produced; empty for primary goods
  isPrimary: boolean; // extracted from nature, limited by an area's natural capacity
  isService: boolean; // cannot be stored or transported: produced and consumed in the same tick
  transportWeight: number; // tonnes of freight per unit, bulk included; multiplies an edge's cost per tonne
  spoilageRatePerDay: number; // decay rate of stored units: stock *= exp(-spoilageRatePerDay * days)
  depletionPerUnitExtracted: number; // primary goods: natural capacity lost per unit extracted (0 = renewable)
  regenerationRatePerDay: number; // primary goods: share of lost capacity recovered per game day
  abundance: Abundance | null; // primary goods: how widely map generation spreads capacity
  terrains: TerrainAffinity[]; // primary goods: where map generation places capacity; empty = anywhere
  satisfies: NeedSatisfaction | null; // need this good is consumed for; null for pure inputs
  laborValue: number; // derived at startup: man-hours embodied in one unit, inputs included
}

// Areas and edges

export interface Area {
  id: AreaId; // index of this area in World.areas
  name: string; // display name
  position: { x: number; y: number }; // map coordinates, used only for rendering
  owner: GovernmentId | null; // ruling government, or null for a neutral area
  edges: EdgeId[]; // connections to neighboring areas

  population: number; // inhabitants, soldiers excluded
  savings: number; // private money held by the inhabitants, in man-hours
  productivity: number; // local multiplier on labor output (terrain, local know-how)
  unemployedWorkers: number; // workers without a private or government job
  fortificationLevel: number; // defensive multiplier built by government fortification jobs
  fortificationProgress: number; // worker-days accumulated toward the next fortification level
  terrain: Terrain; // set by map generation: sets productivity and land transport cost
  isCoastal: boolean; // set by map generation: the area touches navigable water
  portLevel: number; // 0 = no port; raises the capacity of the area's sea routes
  portProgress: number; // worker-days accumulated toward the next port level
  airportLevel: number; // 0 = no airport; raises the capacity of the area's air routes
  airportProgress: number; // worker-days accumulated toward the next airport level
  siegeProgress: number; // 0 to 1; the area changes owner when it reaches 1
  militia: number; // militia still standing; back to population × militiaShare when no attacker is present
  besiegingGovernment: GovernmentId | null; // government currently besieging the area, if any

  // Per-good arrays, indexed by GoodId
  stock: Float64Array; // units stored privately, available to consume or export
  price: Float64Array; // current local market price, in man-hours per unit
  smoothedPrice: Float64Array; // slow moving average of price, used for job decisions (section 4)
  privateWorkers: Float64Array; // workers employed in private production of each good
  naturalCapacity: Float64Array; // primary goods: current maximum extraction per day (0 otherwise)
  naturalCapacityMaximum: Float64Array; // primary goods: capacity the area recovers toward

  // Per-tick results, recomputed every tick, read by the UI and the AI
  produced: Float64Array; // units produced this tick, private and government combined
  demanded: Float64Array; // units the population wanted to consume this tick
  inputDemanded: Float64Array; // units private production requested as inputs this tick, before rationing
  governmentDemanded: Float64Array; // units governments tried to buy on the market this tick
  consumed: Float64Array; // units actually consumed this tick
  imported: Float64Array; // units received from neighbors this tick
  exported: Float64Array; // units sent to neighbors this tick
  outputLimitedByInputs: Uint8Array; // 1 if production of the good was capped by missing inputs this tick
  needDemanded: Float64Array; // per NeedId: need units the population wanted this tick
  needConsumed: Float64Array; // per NeedId: need units actually consumed, substitutes included
  satisfaction: number; // 0 to 1: tier-weighted share of need demand that was met
  necessitySatisfaction: number; // 0 to 1: share of necessity need demand that was met
  wageLevel: number; // average value added per private worker-hour, in man-hours
}

export type EdgeMode = "land" | "sea" | "air";

export interface Edge {
  id: EdgeId; // index of this edge in World.edges
  mode: EdgeMode; // land border, sea route between two ports, or air route between two airports
  areaA: AreaId; // first connected area (edges are undirected)
  areaB: AreaId; // second connected area
  distance: number; // map distance; sea routes use the distance over water
  baseTransportCost: number; // man-hours to move one tonne across, before infrastructure
  transportCost: number; // current cost, lowered by infrastructure work (land only)
  infrastructureProgress: number; // worker-days of road building accumulated toward the next step (land only)
  capacityPerDay: number; // largest tonnage carried per game day in each direction; Infinity on land
  travelDays: number; // game days an army needs to cross this edge; Infinity on air routes
  isActive: boolean; // false for an air route dropped by a rebuild; edges are never deleted
  isBlocked: boolean; // recomputed each tick: true when war or a siege stops all traffic
  tradeFlowPerDay: Float64Array; // per good and direction (2 × GoodId, + 1 for B to A): current shipping rate in units
}

// Governments

export type GovernmentJob =
  | { kind: "produce"; good: GoodId } // state production; output goes to the local depot
  | { kind: "buildInfrastructure"; edge: EdgeId } // lowers the transport cost of an adjacent edge
  | { kind: "fortify" } // raises the area's fortification level
  | { kind: "buildPort" } // coastal areas only: raises the area's port level
  | { kind: "buildAirport" }; // raises the area's airport level

export interface JobAssignment {
  job: GovernmentJob; // what these workers do
  targetWorkers: number; // number of workers the player wants in this job
  workers: number; // workers actually employed; moves toward the target with inertia
}

export type PolicyName =
  | "productionTaxRate" // per good: share of production value taxed; negative = subsidy
  | "consumptionTaxRate" // per good: share added to the price consumers pay
  | "importTariffRate" // per good: share of the price charged on goods entering across a border
  | "exportTariffRate" // per good: share of the price charged on goods leaving across a border
  | "headTaxPerPersonPerDay" // per area: flat tax per inhabitant per game day, in man-hours
  | "priceCeiling" // per good: maximum allowed local price
  | "priceFloor"; // per good: minimum allowed local price

export interface PolicySetting {
  policy: PolicyName; // which policy this sets
  good: GoodId | null; // the good it applies to; null for head tax, or every good for a per-good policy
  value: number | null; // the rate or price; null removes a ceiling or floor
}

export interface ResolvedPolicies {
  productionTaxRate: Float64Array; // per good, realm default merged with area overrides
  consumptionTaxRate: Float64Array; // per good
  importTariffRate: Float64Array; // per good
  exportTariffRate: Float64Array; // per good
  headTaxPerPersonPerDay: number; // for this area
  priceCeiling: Float64Array; // per good; Infinity when there is no ceiling
  priceFloor: Float64Array; // per good; 0 when there is no floor
}

export interface GovernmentAreaState {
  depot: Float64Array; // goods owned by the government in this area, indexed by GoodId
  jobs: JobAssignment[]; // government jobs in this area
  wageOffer: number; // wage paid per worker-hour, in man-hours (1 = reference wage)
  policyOverrides: PolicySetting[]; // exceptions to the realm defaults for this area
  resolvedPolicies: ResolvedPolicies; // realm defaults merged with overrides, ready for the tick
}

export type GovernmentController = { kind: "human"; player: PlayerId } | { kind: "ai" };

/** How an AI runs the realm (specification §11); "idle" never acts, for test worlds. */
export type Personality = "trader" | "builder" | "conqueror" | "idle";

/** The personality mix of a new game's realms. */
export type AiMix = "balanced" | "peaceful" | "aggressive";

/** One war as an AI remembers it. */
export interface AiWar {
  enemy: GovernmentId; // the government at war with this one
  startDay: number; // game day the war began, or the AI first noticed it
  areasAtStart: number; // areas this government owned then
  enemyAreasAtStart: number; // areas the enemy owned then
  lastCaptureDay: number; // game day of this government's last capture in the war
  declaredByMe: boolean; // this government declared it
  lastProposalDay: number | null; // game day of this government's last peace proposal
  target: AreaId | null; // enemy area the main army marches on
}

/** What an AI keeps between decisions: plain data, saved with the world. */
export interface AiMemory {
  nextDecisionTick: number; // tick of the next decision
  createdDay: number; // game day the AI first took the realm over
  lastDecisionDay: number | null; // game day of the last decision; null before the first
  lastTreasury: number; // treasury at the last decision
  standingOrdersPlaced: boolean; // the personality's standing orders are set
  wars: AiWar[]; // wars in progress
  lastPeaceDay: number | null; // game day the last war ended
  ownedAreaCount: number; // areas owned at the last decision, to notice captures
}

export interface Government {
  id: GovernmentId; // index of this government in World.governments
  name: string; // display name of the realm
  color: string; // map color of the realm
  controller: GovernmentController; // who issues this government's commands
  personality: Personality; // how the AI runs the realm whenever it controls it
  aiMemory: AiMemory | null; // the AI's memory, created at its first decision
  capital: AreaId | null; // capital area; null once the government is eliminated
  isEliminated: boolean; // true once the government owns no area
  treasury: number; // government money for the whole realm, in man-hours
  ownedAreas: AreaId[]; // cache of the areas whose owner is this government
  areaStates: Map<AreaId, GovernmentAreaState>; // depot, jobs, wage and policies per owned area
  realmPolicies: PolicySetting[]; // default policies applied to every owned area
  marketOrders: MarketOrder[]; // open buy and sell orders
  standingOrders: StandingOrder[]; // automation rules evaluated every tick
  depotTransfers: DepotTransfer[]; // goods travelling between the government's own depots
  soldierWage: number; // wage paid per soldier-hour, in man-hours
}

export interface MarketOrder {
  id: number; // unique id, used to cancel the order
  area: AreaId; // owned area whose market the order trades on
  good: GoodId; // good to buy or sell
  side: "buy" | "sell"; // buy into the depot, or sell from it
  remainingQuantity: number; // units still to trade before the order completes
  limitPrice: number; // buy: highest price accepted; sell: lowest price accepted
  maximumQuantityPerDay: number; // pacing cap, so one order cannot empty a market in a single tick
}

export interface DepotTransfer {
  good: GoodId; // good being moved
  quantity: number; // units in transit (spoil on the way)
  destination: AreaId; // depot the goods are delivered to
  daysRemaining: number; // game days until arrival
}

export type StandingRule =
  // buy until the depot holds this many days of the area's total demand (consumers and producers)
  | { kind: "keepDepotStock"; good: GoodId; targetDaysOfDemand: number; maximumBuyPrice: number }
  // sell depot surplus above this many days of total demand whenever the price exceeds the minimum
  | { kind: "sellAbovePrice"; good: GoodId; minimumPrice: number; keepDaysOfDemand: number }
  // stockpile whenever the price is low
  | { kind: "buyBelowPrice"; good: GoodId; maximumPrice: number; maximumDepotQuantity: number };

export interface StandingOrder {
  id: number; // unique id, used to remove the rule
  areas: AreaId[] | "all"; // areas the rule applies to
  rule: StandingRule; // what the rule does
}

// Armies and diplomacy

export type ArmyLocation =
  | { kind: "area"; area: AreaId } // standing in an area
  | { kind: "edge"; edge: EdgeId; from: AreaId; daysTravelled: number }; // marching along an edge

export type ArmyStance = "hold" | "attack";

export interface Army {
  id: ArmyId; // unique id
  owner: GovernmentId; // government the army belongs to
  location: ArmyLocation; // where the army is now
  path: AreaId[]; // remaining areas to march through, in order
  soldiers: number; // number of soldiers
  weapons: number; // units of the weapons good carried
  stance: ArmyStance; // hold: defend only; attack: engage enemies and besiege
}

export interface PeaceProposal {
  id: number; // unique id, used to answer the proposal
  from: GovernmentId; // proposing government
  to: GovernmentId; // government asked to accept
  areaTransfers: { area: AreaId; newOwner: GovernmentId }[]; // areas changing hands if accepted
  payment: number; // money paid by the proposer to the other side (negative = demanded)
  expiresAtDay: number; // game day after which the proposal is discarded
}

// Commands

export type Command =
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
  | { type: "setArmyStance"; army: ArmyId; stance: ArmyStance }
  | { type: "setSoldierWage"; wage: number }
  | { type: "declareWar"; target: GovernmentId }
  | { type: "proposePeace"; proposal: Omit<PeaceProposal, "id"> }
  | { type: "answerPeace"; proposalId: number; accept: boolean }
  | { type: "addStandingOrder"; order: Omit<StandingOrder, "id"> }
  | { type: "removeStandingOrder"; orderId: number };

export interface CommandEnvelope {
  player: PlayerId; // sender, checked against the government's controller
  government: GovernmentId; // government the command acts for
  command: Command; // the action itself
}
