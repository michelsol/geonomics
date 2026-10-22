// Phase 4: trade (specification §5, Trade). Flows are computed from the state before trade and applied together,
// so the result never depends on the order of edges or areas.
import { EPSILON, fractionPerTick, reserveDaysOf } from "../math";
import type { Area, AreaId, Edge, EdgeId, GoodId, World } from "../types";
import { policiesOf, pushFlow, type Scratch, scratchOf, usedPerTick } from "./scratch";

/**
 * Tonnes carried over each edge in the last trade phase, at index 2 × EdgeId for A to B and 2 × EdgeId + 1 for
 * B to A. Recomputed every tick and not part of the saved world.
 */
export function lastTradeTonnage(world: World): Float64Array {
  return scratchOf(world).edgeTonnage;
}

export interface TradeFlow {
  edge: EdgeId;
  good: GoodId;
  seller: AreaId;
  buyer: AreaId;
  quantity: number; // units delivered
}

/** Every flow delivered in the last trade phase, for diagnostics and the interface. */
export function lastTradeFlows(world: World): TradeFlow[] {
  const flows = scratchOf(world).flows;
  const result: TradeFlow[] = [];
  for (let f = 0; f < flows.count; f++) {
    const quantity = flows.quantity[f] as number;
    if (quantity <= 0) continue;
    result.push({
      edge: flows.edge[f] as number,
      good: flows.good[f] as number,
      seller: flows.seller[f] as number,
      buyer: flows.buyer[f] as number,
      quantity,
    });
  }
  return result;
}

export function runTrade(world: World): void {
  const scratch = scratchOf(world);
  const { goods, areas, edges } = world;
  const days = world.config.pace.gameDaysPerTick;
  const inertia = fractionPerTick(world.config.economy.tradeRatePerDay, world.config.pace.economyResponsiveness, days);

  for (const area of areas) {
    area.imported.fill(0);
    area.exported.fill(0);
    (scratch.positiveGapEdges[area.id] as Float64Array).fill(0);
    (scratch.positiveGapImports[area.id] as Float64Array).fill(0);
    (scratch.exportRate[area.id] as Float64Array).fill(0);
  }
  scratch.importPayment.fill(0);
  scratch.edgeTonnage.fill(0);
  scratch.flows.count = 0;

  // Pass 1: count, per area and good, the edges where trading pays, so surplus and demand are split between them.
  for (const edge of edges) {
    if (!edge.isActive || edge.isBlocked) continue;
    const a = areas[edge.areaA] as Area;
    const b = areas[edge.areaB] as Area;
    for (const good of goods) {
      if (good.isService) continue;
      const g = good.id;
      if (unitGap(world, scratch, edge, a, b, g) > 0) {
        increment(scratch.positiveGapEdges[a.id] as Float64Array, g, 1);
        increment(scratch.positiveGapImports[b.id] as Float64Array, g, 1);
      }
      if (unitGap(world, scratch, edge, b, a, g) > 0) {
        increment(scratch.positiveGapEdges[b.id] as Float64Array, g, 1);
        increment(scratch.positiveGapImports[a.id] as Float64Array, g, 1);
      }
    }
  }

  // Pass 2: shipping rates move toward their targets, quantities follow within the seller's surplus, then capacity.
  for (const edge of edges) {
    const a = areas[edge.areaA] as Area;
    const b = areas[edge.areaB] as Area;
    const open = edge.isActive && !edge.isBlocked;
    const firstFlow = scratch.flows.count;
    for (const good of goods) {
      if (good.isService) continue;
      addFlow(world, scratch, edge, a, b, 0, good.id, open, inertia);
      addFlow(world, scratch, edge, b, a, 1, good.id, open, inertia);
    }
    if (Number.isFinite(edge.capacityPerDay)) limitToCapacity(world, scratch, edge, firstFlow);
  }

  // A buyer can only spend what it has, across all its edges and goods together.
  const flows = scratch.flows;
  for (let f = 0; f < flows.count; f++) {
    increment(
      scratch.importPayment,
      flows.buyer[f] as number,
      (flows.quantity[f] as number) * (flows.unitPaid[f] as number),
    );
  }
  for (let f = 0; f < flows.count; f++) {
    const buyer = areas[flows.buyer[f] as number] as Area;
    const payment = scratch.importPayment[buyer.id] as number;
    if (payment > buyer.savings) flows.quantity[f] = ((flows.quantity[f] as number) * buyer.savings) / payment;
  }

  // Apply every flow together.
  for (let f = 0; f < flows.count; f++) {
    const quantity = flows.quantity[f] as number;
    if (quantity <= 0) continue;
    const g = flows.good[f] as number;
    const seller = areas[flows.seller[f] as number] as Area;
    const buyer = areas[flows.buyer[f] as number] as Area;
    seller.stock[g] = Math.max(0, (seller.stock[g] as number) - quantity);
    buyer.stock[g] = (buyer.stock[g] as number) + quantity;
    seller.exported[g] = (seller.exported[g] as number) + quantity;
    buyer.imported[g] = (buyer.imported[g] as number) + quantity;
    buyer.savings = Math.max(0, buyer.savings - quantity * (flows.unitPaid[f] as number));
    seller.savings += quantity * (flows.unitReceived[f] as number);
    payTariff(world, seller, quantity * (flows.exportTariff[f] as number));
    payTariff(world, buyer, quantity * (flows.importTariff[f] as number));
    const edge = flows.edge[f] as number;
    increment(
      scratch.edgeTonnage,
      2 * edge + (flows.direction[f] as number),
      quantity * (goods[g]?.transportWeight as number),
    );
  }
}

function crossesBorder(seller: Area, buyer: Area): boolean {
  return seller.owner !== buyer.owner;
}

function tariffs(world: World, scratch: Scratch, seller: Area, buyer: Area, g: number) {
  if (!crossesBorder(seller, buyer)) return { exportTariff: 0, importTariff: 0 };
  const price = seller.price[g] as number;
  return {
    exportTariff: price * (policiesOf(world, seller, scratch).exportTariffRate[g] as number),
    importTariff: price * (policiesOf(world, buyer, scratch).importTariffRate[g] as number),
  };
}

/** Price gap per unit left after transport and tariffs when the seller ships to the buyer. */
function unitGap(world: World, scratch: Scratch, edge: Edge, seller: Area, buyer: Area, g: number): number {
  const transport = edge.transportCost * (world.goods[g]?.transportWeight as number);
  const sellerPrice = seller.price[g] as number;
  const buyerPrice = buyer.price[g] as number;
  if (buyerPrice - sellerPrice - transport <= 0) return 0; // cheap test before computing tariffs
  const { exportTariff, importTariff } = tariffs(world, scratch, seller, buyer, g);
  return buyerPrice - sellerPrice - transport - exportTariff - importTariff;
}

/**
 * Updates the shipping rate of one good in one direction and records the resulting flow. The target rate is the
 * buyer's reserve of the good times tradeGapSensitivity times the relative gap, per day: the wider the gap, the more
 * of its reserve the buyer refills from this edge each day, which fills its stock and closes the gap. Scaling by the
 * reserve keeps the loop equally damped for perishable goods, which in exchange need a wider gap to travel. The rate
 * moves toward its target at tradeRatePerDay, so trade cannot slosh between areas whose prices are almost equal.
 */
function addFlow(
  world: World,
  scratch: Scratch,
  edge: Edge,
  seller: Area,
  buyer: Area,
  direction: 0 | 1,
  g: number,
  open: boolean,
  inertia: number,
): void {
  const slot = 2 * g + direction;
  const gap = open ? unitGap(world, scratch, edge, seller, buyer, g) : 0;
  const e = world.config.economy;
  const days = world.config.pace.gameDaysPerTick;
  const good = world.goods[g] as World["goods"][number];
  const reserveDays = reserveDaysOf(good, world.config);
  const buyerPrice = buyer.price[g] as number;
  const targetRate =
    gap > 0
      ? (((reserveDays * usedPerTick(buyer, g)) / days) *
          ((e.tradeGapSensitivity * gap) / Math.max(buyerPrice, EPSILON))) /
        Math.max(scratch.positiveGapImports[buyer.id]?.[g] as number, 1)
      : 0;
  const rate = (edge.tradeFlowPerDay[slot] as number) + inertia * (targetRate - (edge.tradeFlowPerDay[slot] as number));
  edge.tradeFlowPerDay[slot] = rate;
  increment(scratch.exportRate[seller.id] as Float64Array, g, rate);
  if (gap <= 0 || rate <= 0) return;

  // The seller keeps part of its reserve and splits the rest between the edges where exporting pays.
  const reserve = (e.exportReserveShare * reserveDays * usedPerTick(seller, g)) / days;
  const surplus = (seller.stock[g] as number) - reserve;
  if (surplus <= 0) return;
  const exportable = surplus / Math.max(scratch.positiveGapEdges[seller.id]?.[g] as number, 1);
  const quantity = Math.min(exportable, rate * days);

  const transport = edge.transportCost * good.transportWeight;
  const sellerPrice = seller.price[g] as number;
  const { exportTariff, importTariff } = tariffs(world, scratch, seller, buyer, g);
  const f = pushFlow(scratch);
  const flows = scratch.flows;
  flows.edge[f] = edge.id;
  flows.good[f] = g;
  flows.seller[f] = seller.id;
  flows.buyer[f] = buyer.id;
  flows.direction[f] = direction;
  flows.quantity[f] = quantity;
  flows.unitPaid[f] = sellerPrice + transport + exportTariff + importTariff + gap / 2;
  flows.unitReceived[f] = sellerPrice + transport + gap / 2; // the seller's carriers earn the transport
  flows.exportTariff[f] = exportTariff;
  flows.importTariff[f] = importTariff;
  flows.gapPerTonne[f] = gap / Math.max(good.transportWeight, EPSILON);
}

/** Sea and air routes: when one direction carries more than its capacity, the best gap per tonne goes first. */
function limitToCapacity(world: World, scratch: Scratch, edge: Edge, firstFlow: number): void {
  const flows = scratch.flows;
  const limit = edge.capacityPerDay * world.config.pace.gameDaysPerTick;
  for (const direction of [0, 1]) {
    let tonnes = 0;
    const indices: number[] = [];
    for (let f = firstFlow; f < flows.count; f++) {
      if (flows.direction[f] !== direction) continue;
      indices.push(f);
      tonnes += (flows.quantity[f] as number) * (world.goods[flows.good[f] as number]?.transportWeight as number);
    }
    if (tonnes <= limit) continue;
    // Ties keep catalog order, so the result is deterministic.
    indices.sort((x, y) => (flows.gapPerTonne[y] as number) - (flows.gapPerTonne[x] as number) || x - y);
    let room = limit;
    for (const f of indices) {
      const weight = world.goods[flows.good[f] as number]?.transportWeight as number;
      const carried = Math.min((flows.quantity[f] as number) * weight, room);
      if (weight > 0) flows.quantity[f] = carried / weight;
      room -= carried;
    }
  }
}

function increment(array: Float64Array, index: number, amount: number): void {
  array[index] = (array[index] as number) + amount;
}

function payTariff(world: World, area: Area, amount: number): void {
  if (amount === 0 || area.owner === null) return;
  const government = world.governments[area.owner];
  if (government) government.treasury += amount;
}
