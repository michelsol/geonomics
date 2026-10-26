// Reusable per-world buffers for the tick, so phases never allocate in the hot path. They hold only values
// recomputed every tick, so they are kept outside the serializable World.
import { CONSUMER_GROUP_COUNT, WAGE_BAND_COUNT } from "../bands";
import { neutralPolicies } from "../government";
import type { Area, AreaId, DemandTier, GoodId, GovernmentId, Need, ResolvedPolicies, World } from "../types";

const TIER_ORDER: DemandTier[] = ["necessity", "comfort", "luxury"];

export interface Scratch {
  goodCount: number;
  needGoods: GoodId[][]; // per NeedId: goods that satisfy it, in catalog order
  needsByTier: Need[]; // necessities first, then comforts, then luxuries, in catalog order within a tier
  unitsPerGood: Float64Array; // per GoodId: need units one unit provides; 0 for pure inputs
  users: { good: GoodId; quantity: number }[][]; // per GoodId: recipes that use it as an input
  transportWeight: Float64Array; // per GoodId
  isService: Uint8Array; // per GoodId
  reserveDays: Float64Array; // per GoodId: reserveDaysOf, refreshed by the trade phase each tick
  spoilageLoss: Float64Array; // per GoodId: share of a stock lost to spoilage in one tick, refreshed with reserveDays
  used: Float64Array[]; // per area, per good: usedPerTick, refreshed by the trade phase each tick
  neutralPolicies: ResolvedPolicies; // shared by every area without an owner: all policies at zero
  marginalOutput: Float64Array[]; // per area, per good: units per extra worker per day this tick
  producible: Uint8Array[]; // per area, per good: 1 if the area can produce the good (labor phase)
  maximumByLabor: Float64Array; // per good, one area at a time
  ration: Float64Array; // per good, one area at a time
  weights: Float64Array; // per good, one area at a time (consumption shares, labor weights)
  values: Float64Array; // per good, one area at a time (unit prices, value added)
  jobWages: Float64Array; // per good, one area at a time: hourly wage of each private job (wageBands)
  bandWorkers: Float64Array; // per area and wage band: workers whose wage falls in the band (wageBands)
  bandWages: Float64Array; // per area and wage band: their hourly wages summed
  groupPeople: Float64Array; // per consumer group (wage bands, then the unemployed), one area at a time
  groupLogPower: Float64Array; // per consumer group: log of its purchasing power
  groupBudget: Float64Array; // per consumer group: money left to spend this tick
  groupNeedBought: Float64Array; // per consumer group and need, one area at a time: need units bought this tick
  groupNecessityWanted: Float64Array; // per consumer group, one area at a time: necessities wanted, at reference value
  groupShare: Float64Array; // per area and consumer group: share of the population, as of the last consumption phase
  groupNecessityMet: Float64Array; // per area and consumer group: share of its necessities met, likewise
  positiveGapEdges: Float64Array[]; // per area, per good: edges where exporting the good pays this tick
  positiveGapImports: Float64Array[]; // per area, per good: edges where importing the good pays this tick
  exportRate: Float64Array[]; // per area, per good: sum of the area's outgoing shipping rates, units per day
  importPayment: Float64Array; // per area: money owed for this tick's imports
  migrationDelta: Float64Array; // per area: net migrants this tick
  births: Float64Array; // per area: people born this tick
  deaths: Float64Array; // per area: people who died this tick
  attractiveness: Float64Array; // per area
  edgeTonnage: Float64Array; // per edge and direction (2 × edge + 0 for A→B, + 1 for B→A): tonnes this tick
  edgeMigration: Float64Array; // per edge: migrants this tick, positive from A to B
  flows: TradeFlows; // trade flows computed this tick, applied together
  stateWorkers: (Float64Array | null)[]; // per area, per good: workers of government produce jobs; null when none
  taxDue: Float64Array; // per area: taxes owed this tick
  paymentDue: Float64Array; // per area: subsidies and wages the treasury owes the inhabitants this tick
  paidShare: number[]; // per government: share of this tick's wages and subsidies the treasury could pay
  standingTrades: StandingTrade[]; // market trades issued by standing orders this tick
}

/** A market trade issued by a standing order for one tick, executed like a market order. */
export interface StandingTrade {
  government: GovernmentId;
  area: AreaId;
  good: GoodId;
  side: "buy" | "sell";
  quantity: number;
  limitPrice: number;
  maximumQuantityPerDay: number;
}

/** Struct-of-arrays list of trade flows, reused tick after tick. */
export interface TradeFlows {
  count: number;
  edge: Int32Array;
  good: Int32Array;
  seller: Int32Array;
  buyer: Int32Array;
  direction: Uint8Array;
  quantity: Float64Array;
  unitPaid: Float64Array; // per unit, paid by the buyer
  unitReceived: Float64Array; // per unit, received by the seller
  exportTariff: Float64Array; // per unit, to the seller's government
  importTariff: Float64Array; // per unit, to the buyer's government
  gapPerTonne: Float64Array; // ranks flows when a route's capacity is short
}

const scratches = new WeakMap<World, Scratch>();

export function scratchOf(world: World): Scratch {
  let scratch = scratches.get(world);
  if (
    !scratch ||
    scratch.marginalOutput.length !== world.areas.length ||
    scratch.edgeTonnage.length !== world.edges.length * 2
  ) {
    scratch = createScratch(world, scratch);
    scratches.set(world, scratch);
  }
  return scratch;
}

function createScratch(world: World, previous: Scratch | undefined): Scratch {
  const goodCount = world.goods.length;
  const areaCount = world.areas.length;
  const perGood = () => new Float64Array(goodCount);
  // A new edge does not change the areas: what the last production pass and tax phase left for them carries over.
  const sameAreas = previous !== undefined && previous.marginalOutput.length === areaCount;
  const needGoods: GoodId[][] = world.needs.map(() => []);
  const users: { good: GoodId; quantity: number }[][] = world.goods.map(() => []);
  for (const good of world.goods) {
    if (good.satisfies) needGoods[good.satisfies.need]?.push(good.id);
    for (const input of good.inputs) users[input.good]?.push({ good: good.id, quantity: input.quantity });
  }
  return {
    goodCount,
    needGoods,
    needsByTier: TIER_ORDER.flatMap((tier) => world.needs.filter((need) => need.tier === tier)),
    unitsPerGood: Float64Array.from(world.goods, (good) => good.satisfies?.unitsPerGood ?? 0),
    users,
    transportWeight: Float64Array.from(world.goods, (good) => good.transportWeight),
    isService: Uint8Array.from(world.goods, (good) => (good.isService ? 1 : 0)),
    reserveDays: perGood(),
    spoilageLoss: perGood(),
    used: world.areas.map(() => perGood()),
    neutralPolicies: previous?.neutralPolicies ?? neutralPolicies(goodCount),
    marginalOutput: sameAreas ? previous.marginalOutput : world.areas.map(() => perGood()),
    producible: sameAreas ? previous.producible : world.areas.map(() => new Uint8Array(goodCount)),
    maximumByLabor: perGood(),
    ration: perGood(),
    weights: perGood(),
    values: perGood(),
    jobWages: perGood(),
    bandWorkers: carried(previous?.bandWorkers, areaCount * WAGE_BAND_COUNT),
    bandWages: carried(previous?.bandWages, areaCount * WAGE_BAND_COUNT),
    groupPeople: new Float64Array(WAGE_BAND_COUNT + 1),
    groupLogPower: new Float64Array(WAGE_BAND_COUNT + 1),
    groupBudget: new Float64Array(WAGE_BAND_COUNT + 1),
    groupNeedBought: new Float64Array(CONSUMER_GROUP_COUNT * world.needs.length),
    groupNecessityWanted: new Float64Array(CONSUMER_GROUP_COUNT),
    groupShare: carried(previous?.groupShare, areaCount * CONSUMER_GROUP_COUNT),
    groupNecessityMet: carried(previous?.groupNecessityMet, areaCount * CONSUMER_GROUP_COUNT),
    positiveGapEdges: world.areas.map(() => perGood()),
    positiveGapImports: world.areas.map(() => perGood()),
    exportRate: world.areas.map(() => perGood()),
    importPayment: new Float64Array(areaCount),
    migrationDelta: new Float64Array(areaCount),
    births: carried(previous?.births, areaCount),
    deaths: carried(previous?.deaths, areaCount),
    attractiveness: new Float64Array(areaCount),
    // Last tick's flows outlive a new edge: snapshots read them after the jobs phase may add an air route.
    edgeTonnage: carried(previous?.edgeTonnage, world.edges.length * 2),
    edgeMigration: carried(previous?.edgeMigration, world.edges.length),
    flows: previous?.flows ?? createFlows(1024),
    stateWorkers: world.areas.map(() => null),
    taxDue: new Float64Array(areaCount),
    paymentDue: new Float64Array(areaCount),
    paidShare: previous?.paidShare ?? [],
    standingTrades: [],
  };
}

/** A new buffer of `length` holding what `previous` held, zero beyond it. */
function carried(previous: Float64Array | undefined, length: number): Float64Array {
  const buffer = new Float64Array(length);
  if (previous) buffer.set(previous.subarray(0, length));
  return buffer;
}

/**
 * Units of a good the inhabitants of an area used this tick: what consumers wanted or, when substitutes ran out,
 * what they actually consumed, plus what local producers requested as inputs.
 */
export function privateUsedPerTick(area: Area, g: number): number {
  return Math.max(area.demanded[g] as number, area.consumed[g] as number) + (area.inputDemanded[g] as number);
}

/** Total demand for a good in an area this tick: private use plus what governments tried to buy. */
export function usedPerTick(area: Area, g: number): number {
  return privateUsedPerTick(area, g) + (area.governmentDemanded[g] as number);
}

/**
 * Units of a good an area uses and ships per tick. Exports count at the smoothed shipping rates of its edges rather
 * than this tick's deliveries, so day-to-day noise in trade does not move stock targets or labor plans. Valid after
 * the trade phase, which refreshes `used` and `exportRate`.
 */
export function suppliedForPerTick(world: World, scratch: Scratch, area: Area, g: number): number {
  return (
    (scratch.used[area.id]?.[g] as number) +
    (scratch.exportRate[area.id]?.[g] as number) * world.config.pace.gameDaysPerTick
  );
}

/** Policies in force in an area: its owner's resolved policies, or all zero for a neutral area. */
export function policiesOf(world: World, area: Area, scratch: Scratch): ResolvedPolicies {
  if (area.owner === null) return scratch.neutralPolicies;
  return world.governments[area.owner]?.areaStates.get(area.id)?.resolvedPolicies ?? scratch.neutralPolicies;
}

function createFlows(capacity: number): TradeFlows {
  return {
    count: 0,
    edge: new Int32Array(capacity),
    good: new Int32Array(capacity),
    seller: new Int32Array(capacity),
    buyer: new Int32Array(capacity),
    direction: new Uint8Array(capacity),
    quantity: new Float64Array(capacity),
    unitPaid: new Float64Array(capacity),
    unitReceived: new Float64Array(capacity),
    exportTariff: new Float64Array(capacity),
    importTariff: new Float64Array(capacity),
    gapPerTonne: new Float64Array(capacity),
  };
}

/** Returns the index of a new flow, doubling the buffers when full. */
export function pushFlow(scratch: Scratch): number {
  let flows = scratch.flows;
  if (flows.count === flows.quantity.length) {
    const grown = createFlows(flows.quantity.length * 2);
    for (const key of Object.keys(grown) as (keyof TradeFlows)[]) {
      if (key !== "count") (grown[key] as Float64Array).set(flows[key] as Float64Array);
    }
    grown.count = flows.count;
    scratch.flows = grown;
    flows = grown;
  }
  return flows.count++;
}
