// Phase 10: spoilage, regeneration of natural capacity, and the clock.
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
}
