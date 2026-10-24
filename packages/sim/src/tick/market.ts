// Phase 2: government market orders and depot transfers (specification §6, Market orders, Depots and transfers),
// and the standing orders evaluated in phase 0 (specification §6, Standing orders).
import { EPSILON, reserveDaysOf } from "../math";
import type { Area, Government, GovernmentAreaState, StandingOrder, World } from "../types";
import { privateUsedPerTick, type StandingTrade, scratchOf } from "./scratch";

/**
 * Phase 0: turns each standing order into this tick's market trades, executed in phase 2 like market orders. Each
 * trade is paced at standingOrderShareOfDemandPerDay of the area's total demand (or of its production, or of the
 * trade itself, if larger) per day.
 */
export function evaluateStandingOrders(world: World): void {
  const scratch = scratchOf(world);
  const trades = scratch.standingTrades;
  trades.length = 0;
  const days = world.config.pace.gameDaysPerTick;
  const share = world.config.government.standingOrderShareOfDemandPerDay;
  for (const government of world.governments) {
    if (government.isEliminated) continue;
    for (const order of government.standingOrders) {
      for (const areaId of areasOf(government, order)) {
        const state = government.areaStates.get(areaId);
        if (!state) continue;
        const area = world.areas[areaId] as Area;
        const { rule } = order;
        const g = rule.good;
        const used = privateUsedPerTick(area, g);
        const demandPerDay = used / days;
        const pace = (share * Math.max(used, area.produced[g] as number)) / days;
        const held = state.depot[g] as number;
        // Pacing also follows the trade's own size, so a good nobody else uses (weapons) can still be stockpiled.
        const trade = (side: "buy" | "sell", quantity: number, limitPrice: number) => {
          if (quantity > EPSILON)
            trades.push({
              government: government.id,
              area: areaId,
              good: g,
              side,
              quantity,
              limitPrice,
              maximumQuantityPerDay: Math.max(pace, share * quantity),
            });
        };
        switch (rule.kind) {
          case "keepDepotStock":
            trade("buy", rule.targetDaysOfDemand * demandPerDay - held, rule.maximumBuyPrice);
            break;
          case "sellAbovePrice":
            trade("sell", held - rule.keepDaysOfDemand * demandPerDay, rule.minimumPrice);
            break;
          case "buyBelowPrice":
            trade("buy", rule.maximumDepotQuantity - held, rule.maximumPrice);
            break;
        }
      }
    }
  }
}

function areasOf(government: Government, order: StandingOrder): readonly number[] {
  return order.areas === "all" ? government.ownedAreas : order.areas;
}

export function runMarket(world: World): void {
  const scratch = scratchOf(world);
  for (const area of world.areas) area.governmentDemanded.fill(0);
  for (const government of world.governments) {
    if (government.isEliminated) continue;
    government.marketOrders = government.marketOrders.filter((order) => {
      const state = government.areaStates.get(order.area);
      if (!state) return false; // the area changed hands: the order is cancelled
      order.remainingQuantity -= execute(world, government, state, order);
      return order.remainingQuantity > EPSILON;
    });
  }
  for (const trade of scratch.standingTrades) {
    const government = world.governments[trade.government] as Government;
    const state = government.areaStates.get(trade.area);
    if (state) execute(world, government, state, { ...trade, remainingQuantity: trade.quantity });
  }
}

type Order = Pick<StandingTrade, "area" | "good" | "side" | "limitPrice" | "maximumQuantityPerDay"> & {
  remainingQuantity: number;
};

/**
 * Executes one order at the local price. A purchase only takes stock above the area's reserve and what the treasury
 * can pay; a sale only what the depot holds and the inhabitants can pay. Returns the quantity traded.
 */
function execute(world: World, government: Government, state: GovernmentAreaState, order: Order): number {
  const area = world.areas[order.area] as Area;
  const g = order.good;
  const good = world.goods[g] as World["goods"][number];
  const price = area.price[g] as number;
  const days = world.config.pace.gameDaysPerTick;
  const paced = Math.min(order.remainingQuantity, order.maximumQuantityPerDay * days);
  let quantity = 0;
  if (order.side === "buy") {
    if (price > order.limitPrice) return 0;
    // What the government wants counts as demand, so producers grow to supply it beyond the inhabitants' reserve.
    const affordable = Math.min(paced, Math.max(0, government.treasury) / price);
    area.governmentDemanded[g] = (area.governmentDemanded[g] as number) + affordable;
    const reserve = (reserveDaysOf(good, world.config) * privateUsedPerTick(area, g)) / days;
    quantity = Math.min(affordable, Math.max(0, (area.stock[g] as number) - reserve));
    if (quantity <= 0) return 0;
    area.stock[g] = (area.stock[g] as number) - quantity;
    state.depot[g] = (state.depot[g] as number) + quantity;
    government.treasury -= quantity * price;
    area.savings += quantity * price;
  } else {
    if (price < order.limitPrice) return 0;
    quantity = Math.min(paced, state.depot[g] as number, area.savings / price);
    if (quantity <= 0) return 0;
    state.depot[g] = (state.depot[g] as number) - quantity;
    area.stock[g] = (area.stock[g] as number) + quantity;
    area.savings -= quantity * price;
    government.treasury += quantity * price;
  }
  return quantity;
}
