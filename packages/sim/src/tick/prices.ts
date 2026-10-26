// Phase 6: prices (specification §4, Prices).
import { clamp, EPSILON, fractionPerTick } from "../math";
import type { World } from "../types";
import { policiesOf, scratchOf } from "./scratch";

/**
 * Each price moves toward the smoothed price times a scarcity premium set by the pressure, and the smoothed price
 * follows the price slowly. The smoothed price is therefore the long-run price, which drifts for as long as the good
 * stays scarce or abundant, and the price adds the short-run premium or discount that trade reacts to.
 */
export function runPrices(world: World): void {
  const scratch = scratchOf(world);
  const e = world.config.economy;
  const { economyResponsiveness, gameDaysPerTick: days } = world.config.pace;
  const maximumLogChange = Math.log(1 + e.maxPriceChangePerTick);
  const adjustment = fractionPerTick(e.priceAdjustmentRatePerDay, economyResponsiveness, days);
  const smoothing = fractionPerTick(e.priceSmoothingRatePerDay, economyResponsiveness, days);

  const { reserveDays, spoilageLoss } = scratch;
  for (const area of world.areas) {
    const policies = policiesOf(world, area, scratch);
    const used = scratch.used[area.id] as Float64Array;
    const exportRate = scratch.exportRate[area.id] as Float64Array;
    for (const good of world.goods) {
      const g = good.id;
      const pressure = good.isService ? servicePressure(area.demanded[g] as number, area.produced[g] as number) : 0;
      let total = pressure;
      if (!good.isService) {
        // Exporters keep a reserve for their customers too, so exports count in the stock target.
        const totalDemanded = (used[g] as number) + (exportRate[g] as number) * days;
        const target = ((reserveDays[g] as number) * totalDemanded) / days;
        const stock = area.stock[g] as number;
        const stockPressure = (target - stock) / Math.max(target, stock, EPSILON);
        // Flow pressure: supply that falls short of demand, including what the reserve loses to spoilage.
        const supplied = (area.produced[g] as number) + (area.imported[g] as number) - (area.exported[g] as number);
        const required = totalDemanded + target * (spoilageLoss[g] as number);
        const flowPressure = (required - supplied) / Math.max(required, Math.abs(supplied), EPSILON);
        total = clamp(stockPressure + e.priceFlowWeight * flowPressure, -1, 1);
      }

      // Price controls, like the bounds, are multiples of labor value.
      const floor = good.laborValue * Math.max(e.priceFloorMultiple, policies.priceFloor[g] as number);
      const ceiling = Math.max(
        floor,
        good.laborValue * Math.min(e.priceCeilingMultiple, policies.priceCeiling[g] as number),
      );
      const smoothed = area.smoothedPrice[g] as number;
      const current = area.price[g] as number;
      const logGap = Math.log(smoothed / current) + e.scarcityPremium * total;
      const logChange = clamp(adjustment * logGap, -maximumLogChange, maximumLogChange);
      const price = clamp(current * Math.exp(logChange), floor, ceiling);
      area.price[g] = price;
      area.smoothedPrice[g] = clamp(smoothed + smoothing * (price - smoothed), floor, ceiling);
    }
  }
}

function servicePressure(demanded: number, produced: number): number {
  return (demanded - produced) / Math.max(demanded, produced, EPSILON);
}
