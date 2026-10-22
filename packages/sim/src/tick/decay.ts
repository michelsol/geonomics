// Phase 10: spoilage of stocks, depots and goods in transit, and regeneration of natural capacity.
import type { World } from "../types";

export function runDecay(world: World): void {
  const days = world.config.pace.gameDaysPerTick;
  const keep = world.goods.map((good) => Math.exp(-good.spoilageRatePerDay * days));
  const recover = world.goods.map((good) => 1 - Math.exp(-good.regenerationRatePerDay * days));

  for (const area of world.areas) {
    for (const good of world.goods) {
      const g = good.id;
      area.stock[g] = (area.stock[g] as number) * (keep[g] as number);
      if (good.isPrimary && good.regenerationRatePerDay > 0) {
        const capacity = area.naturalCapacity[g] as number;
        area.naturalCapacity[g] =
          capacity + (recover[g] as number) * ((area.naturalCapacityMaximum[g] as number) - capacity);
      }
    }
  }

  // Government depots and goods in transit spoil like any stock.
  for (const government of world.governments) {
    for (const state of government.areaStates.values()) {
      for (const good of world.goods)
        state.depot[good.id] = (state.depot[good.id] as number) * (keep[good.id] as number);
    }
    for (const transfer of government.depotTransfers) transfer.quantity *= keep[transfer.good] as number;
  }
}
