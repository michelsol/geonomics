// Phase 4: trade (specification §4, Trade). Flows are computed from the state before trade and applied together,
// so the result never depends on the order of edges or areas. This is the hottest loop of the tick (edges × goods ×
// 2 directions), so it works on typed arrays directly and skips idle edge-good pairs early.
import { EPSILON, fractionPerTick, reserveDaysOf } from "../math";
import type { Area, AreaId, Edge, EdgeId, GoodId, World } from "../types";
import { policiesOf, pushFlow, type Scratch, scratchOf, usedPerTick } from "./scratch";

/** A fading shipping rate below this share of the buyer's daily use is rounded to zero, so idle routes stay idle. */
const NEGLIGIBLE_RATE = 1e-2;
/** Shipments below this share of the buyer's daily use are not worth recording. */
const NEGLIGIBLE_FLOW = 1e-3;

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
  const goodCount = goods.length;
  const days = world.config.pace.gameDaysPerTick;
  const inertia = fractionPerTick(world.config.economy.tradeRatePerDay, world.config.pace.economyResponsiveness, days);
  const { transportWeight, isService, reserveDays } = scratch;
  const margin = world.config.economy.tradeMargin;

  for (const good of goods) {
    reserveDays[good.id] = reserveDaysOf(good, world.config);
    scratch.spoilageLoss[good.id] = 1 - Math.exp(-good.spoilageRatePerDay * days);
  }
  for (const area of areas) {
    area.imported.fill(0);
    area.exported.fill(0);
    (scratch.positiveGapEdges[area.id] as Float64Array).fill(0);
    (scratch.positiveGapImports[area.id] as Float64Array).fill(0);
    (scratch.exportRate[area.id] as Float64Array).fill(0);
    const used = scratch.used[area.id] as Float64Array;
    for (let g = 0; g < goodCount; g++) used[g] = usedPerTick(area, g);
  }
  scratch.importPayment.fill(0);
  scratch.edgeTonnage.fill(0);
  scratch.flows.count = 0;

  // Pass 1: count, per area and good, the edges where trading pays, so surplus and demand are split between them.
  for (const edge of edges) {
    // An edge that carries nothing (a sea lane, a route whose ports stand idle) takes no share of anyone's trade.
    if (!edge.isActive || edge.isBlocked || !(edge.capacityPerDay > 0)) continue;
    const a = areas[edge.areaA] as Area;
    const b = areas[edge.areaB] as Area;
    const border = a.owner !== b.owner;
    const exportsA = scratch.positiveGapEdges[a.id] as Float64Array;
    const exportsB = scratch.positiveGapEdges[b.id] as Float64Array;
    const importsA = scratch.positiveGapImports[a.id] as Float64Array;
    const importsB = scratch.positiveGapImports[b.id] as Float64Array;
    const priceA = a.price;
    const priceB = b.price;
    const cost = edge.transportCost;
    for (let g = 0; g < goodCount; g++) {
      if (isService[g]) continue;
      const transport = cost * (transportWeight[g] as number);
      const difference = (priceB[g] as number) - (priceA[g] as number);
      const friction = transport + margin * Math.max(priceA[g] as number, priceB[g] as number);
      if (!border && Math.abs(difference) <= friction) continue;
      if (unitGap(world, scratch, a, b, g, friction, border) > 0) {
        exportsA[g] = (exportsA[g] as number) + 1;
        importsB[g] = (importsB[g] as number) + 1;
      } else if (unitGap(world, scratch, b, a, g, friction, border) > 0) {
        exportsB[g] = (exportsB[g] as number) + 1;
        importsA[g] = (importsA[g] as number) + 1;
      }
    }
  }

  // Pass 2: shipping rates move toward their targets, quantities follow within the seller's surplus, then capacity.
  const context: TradeContext = {
    world,
    scratch,
    days,
    inertia,
    sensitivity: world.config.economy.tradeGapSensitivity,
    reserveShare: world.config.economy.exportReserveShare,
  };
  for (const edge of edges) {
    const a = areas[edge.areaA] as Area;
    const b = areas[edge.areaB] as Area;
    const open = edge.isActive && !edge.isBlocked && edge.capacityPerDay > 0;
    const border = a.owner !== b.owner;
    const rates = edge.tradeFlowPerDay;
    const priceA = a.price;
    const priceB = b.price;
    const cost = edge.transportCost;
    const firstFlow = scratch.flows.count;
    for (let g = 0; g < goodCount; g++) {
      if (isService[g]) continue;
      const transport = cost * (transportWeight[g] as number);
      let gapAB = 0;
      let gapBA = 0;
      if (open) {
        const difference = (priceB[g] as number) - (priceA[g] as number);
        const friction = transport + margin * Math.max(priceA[g] as number, priceB[g] as number);
        if (border) {
          gapAB = unitGap(world, scratch, a, b, g, friction, border);
          gapBA = unitGap(world, scratch, b, a, g, friction, border);
        } else {
          gapAB = difference - friction;
          gapBA = -difference - friction;
        }
      }
      if (gapAB > 0 || (rates[2 * g] as number) > 0) updateDirection(context, edge, a, b, 0, g, gapAB, transport);
      if (gapBA > 0 || (rates[2 * g + 1] as number) > 0) updateDirection(context, edge, b, a, 1, g, gapBA, transport);
    }
    if (Number.isFinite(edge.capacityPerDay)) limitToCapacity(world, scratch, edge, firstFlow);
  }

  // A buyer can only spend what it has, across all its edges and goods together.
  const flows = scratch.flows;
  const payments = scratch.importPayment;
  for (let f = 0; f < flows.count; f++) {
    const buyer = flows.buyer[f] as number;
    payments[buyer] = (payments[buyer] as number) + (flows.quantity[f] as number) * (flows.unitPaid[f] as number);
  }
  for (let f = 0; f < flows.count; f++) {
    const buyer = areas[flows.buyer[f] as number] as Area;
    const payment = payments[buyer.id] as number;
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
    const slot = 2 * (flows.edge[f] as number) + (flows.direction[f] as number);
    scratch.edgeTonnage[slot] = (scratch.edgeTonnage[slot] as number) + quantity * (transportWeight[g] as number);
  }
}

/** Price gap per unit left after friction (transport and the trade margin) and tariffs from seller to buyer. */
function unitGap(
  world: World,
  scratch: Scratch,
  seller: Area,
  buyer: Area,
  g: number,
  friction: number,
  border: boolean,
): number {
  const gap = (buyer.price[g] as number) - (seller.price[g] as number) - friction;
  return border ? gap - exportTariff(world, scratch, seller, g) - importTariff(world, scratch, seller, buyer, g) : gap;
}

function exportTariff(world: World, scratch: Scratch, seller: Area, g: number): number {
  return (seller.price[g] as number) * (policiesOf(world, seller, scratch).exportTariffRate[g] as number);
}

function importTariff(world: World, scratch: Scratch, seller: Area, buyer: Area, g: number): number {
  return (seller.price[g] as number) * (policiesOf(world, buyer, scratch).importTariffRate[g] as number);
}

interface TradeContext {
  world: World;
  scratch: Scratch;
  days: number;
  inertia: number;
  sensitivity: number;
  reserveShare: number;
}

/**
 * Updates the shipping rate of one good in one direction and records the resulting flow. The target rate is the
 * buyer's reserve of the good times tradeGapSensitivity times the relative gap, per day; the rate moves toward it at
 * tradeRatePerDay.
 */
function updateDirection(
  context: TradeContext,
  edge: Edge,
  seller: Area,
  buyer: Area,
  direction: 0 | 1,
  g: number,
  gap: number,
  transport: number,
): void {
  const { scratch, days } = context;
  const slot = 2 * g + direction;
  const reserveDays = scratch.reserveDays[g] as number;
  const buyerUse = (scratch.used[buyer.id] as Float64Array)[g] as number;
  let targetRate = 0;
  if (gap > 0) {
    const buyerPrice = buyer.price[g] as number;
    const splitBetween = Math.max((scratch.positiveGapImports[buyer.id] as Float64Array)[g] as number, 1);
    targetRate =
      (((reserveDays * buyerUse) / days) * context.sensitivity * gap) / Math.max(buyerPrice, EPSILON) / splitBetween;
  }
  const previous = edge.tradeFlowPerDay[slot] as number;
  let rate = previous + context.inertia * (targetRate - previous);
  if (targetRate === 0 && rate <= (NEGLIGIBLE_RATE * buyerUse) / days) rate = 0;
  edge.tradeFlowPerDay[slot] = rate;
  if (rate === 0) return;
  const exportRate = scratch.exportRate[seller.id] as Float64Array;
  exportRate[g] = (exportRate[g] as number) + rate;
  if (gap <= 0) return;

  // The seller keeps part of its reserve and splits the rest between the edges where exporting pays.
  const sellerUse = (scratch.used[seller.id] as Float64Array)[g] as number;
  const surplus = (seller.stock[g] as number) - (context.reserveShare * reserveDays * sellerUse) / days;
  if (surplus <= 0) return;
  const exportable = surplus / Math.max((scratch.positiveGapEdges[seller.id] as Float64Array)[g] as number, 1);
  const quantity = Math.min(exportable, rate * days);
  if (quantity < NEGLIGIBLE_FLOW * buyerUse) return;

  const sellerPrice = seller.price[g] as number;
  const border = seller.owner !== buyer.owner;
  const exportTax = border ? exportTariff(context.world, scratch, seller, g) : 0;
  const importTax = border ? importTariff(context.world, scratch, seller, buyer, g) : 0;
  const f = pushFlow(scratch);
  const flows = scratch.flows;
  flows.edge[f] = edge.id;
  flows.good[f] = g;
  flows.seller[f] = seller.id;
  flows.buyer[f] = buyer.id;
  flows.direction[f] = direction;
  flows.quantity[f] = quantity;
  flows.unitPaid[f] = sellerPrice + transport + exportTax + importTax + gap / 2;
  flows.unitReceived[f] = sellerPrice + transport + gap / 2; // the seller's carriers earn the transport
  flows.exportTariff[f] = exportTax;
  flows.importTariff[f] = importTax;
  flows.gapPerTonne[f] = gap / Math.max(scratch.transportWeight[g] as number, EPSILON);
}

/** Sea and air routes: when one direction carries more than its capacity, the best gap per tonne goes first. */
function limitToCapacity(world: World, scratch: Scratch, edge: Edge, firstFlow: number): void {
  const flows = scratch.flows;
  const weights = scratch.transportWeight;
  const limit = edge.capacityPerDay * world.config.pace.gameDaysPerTick;
  for (const direction of [0, 1]) {
    let tonnes = 0;
    const indices: number[] = [];
    for (let f = firstFlow; f < flows.count; f++) {
      if (flows.direction[f] !== direction) continue;
      indices.push(f);
      tonnes += (flows.quantity[f] as number) * (weights[flows.good[f] as number] as number);
    }
    if (tonnes <= limit) continue;
    // Ties keep catalog order, so the result is deterministic.
    indices.sort((x, y) => (flows.gapPerTonne[y] as number) - (flows.gapPerTonne[x] as number) || x - y);
    let room = limit;
    for (const f of indices) {
      const weight = weights[flows.good[f] as number] as number;
      const carried = Math.min((flows.quantity[f] as number) * weight, room);
      if (weight > 0) flows.quantity[f] = carried / weight;
      room -= carried;
    }
  }
}

function payTariff(world: World, area: Area, amount: number): void {
  if (amount === 0 || area.owner === null) return;
  const government = world.governments[area.owner];
  if (government) government.treasury += amount;
}
