// WorldConfig and its defaults (specification §4). Defaults are starting points for tuning in the headless runner.
import type { Catalog } from "./catalog";
import type { GoodId } from "./types";

export interface WorldConfig {
  pace: {
    maxTicksPerSecond: number; // wall-clock cap of the host loop; lower on mobile
    gameDaysPerTick: number; // game days simulated per tick
    economyResponsiveness: number; // multiplier on price, trade, smoothing and labor rates
    demographyResponsiveness: number; // multiplier on growth, starvation and migration rates
    militaryResponsiveness: number; // multiplier on marching, combat and siege rates
  };
  economy: {
    hoursPerWorkerDay: number; // hours worked per worker per game day
    workforceShare: number; // share of the population able to work
    reserveDays: number; // days of total demand an area keeps in stock before exporting
    maxReserveSpoilageShare: number; // perishable goods keep a smaller reserve, so spoilage stays under this share of demand
    priceAdjustmentRatePerDay: number; // speed at which the price moves toward the smoothed price times the scarcity premium
    priceFlowWeight: number; // weight of the flow imbalance next to the stock gap in price pressure
    scarcityPremium: number; // log price premium over the smoothed price at full shortage (discount at full glut)
    priceSmoothingRatePerDay: number; // speed of the smoothed price, the long-run price that jobs follow
    tradeRatePerDay: number; // speed at which an edge's shipping rate moves toward its target
    tradeGapSensitivity: number; // share of its reserve a buyer imports per day over one edge, per unit of relative gap
    exportReserveShare: number; // share of its own reserve an area keeps when exporting
    laborMobilityRatePerDay: number; // speed at which private workers move toward the target allocation
    laborAllocationTemperature: number; // softness of the value-added tilt on labor targets, relative to the reservation wage
    reservationWage: number; // value added per hour below which workers prefer unemployment, at target savings
    stockRecoveryDays: number; // labor plans to bring a stock back to its reserve over this many days
    maxPriceChangePerTick: number; // largest relative price change in one tick
    maxLaborShiftPerTick: number; // largest share of a workforce changing jobs in one tick
    priceFloorMultiple: number; // lowest price as a multiple of labor value
    priceCeilingMultiple: number; // highest price as a multiple of labor value
    tierWeights: { necessity: number; comfort: number; luxury: number }; // weights in satisfaction
    targetSavingsDays: number; // days of income inhabitants like to hold; neutral point of the savings effect
    savingsElasticity: number; // how strongly savings above or below target change purchasing power
    savingsFactorMin: number; // lower clamp of savings relative to target
    savingsFactorMax: number; // upper clamp of savings relative to target
  };
  transport: {
    landCostPerDistance: number; // map generation: base land cost per tonne per unit of distance, before terrain
    seaCostPerDistance: number; // man-hours per tonne per unit of sea distance
    airBaseCost: number; // man-hours per tonne per flight, whatever the distance
    airCostPerDistance: number; // man-hours per tonne per unit of distance flown
    seaRoutesPerPort: number; // map generation links each port to this many nearest ports by sea
    airRoutesPerAirport: number; // each airport links to this many nearest airports
    seaCapacityPerPortLevel: number; // tonnes per day per direction on a sea route, per level of its smaller port
    airCapacityPerAirportLevel: number; // tonnes per day per direction on an air route, per level of its smaller airport
    portWorkerDaysPerLevel: number; // work needed per port level
    airportWorkerDaysPerLevel: number; // work needed per airport level
    maximumPortLevel: number; // highest port level
    maximumAirportLevel: number; // highest airport level; airports at this level link to each other as hubs
    initialAirportShare: number; // share of the most populous areas given an airport of level 1 at start
    seaTravelDaysPerDistance: number; // game days an army needs per unit of sea distance
    migrationFactorBySea: number; // migration over a sea route, relative to a land edge
    migrationFactorByAir: number; // migration over an air route, relative to a land edge
  };
  population: {
    growthRatePerDay: number; // relative growth per day at full necessity satisfaction
    starvationRatePerDay: number; // relative decline per day when no necessity is met
    growthSatisfactionThreshold: number; // necessity satisfaction above which population grows
    migrationRatePerDay: number; // share of the attractiveness gap that migrates per day
    migrationWageWeight: number; // weight of wage level versus satisfaction in attractiveness
  };
  government: {
    hiringRatePerDay: number; // share of the gap to target government jobs filled per day
    quitRatePerDay: number; // quitting speed per unit of wage shortfall or unpaid share
    infrastructureWorkerDaysPerStep: number; // road work needed for one transport cost step
    infrastructureStepFactor: number; // transport cost multiplier per step
    minimumTransportCostFactor: number; // transport cost never falls below this share of base
    fortificationWorkerDaysPerLevel: number; // work needed per fortification level
    maximumFortificationLevel: number; // highest fortification level
    researchWorkerDaysPerLevel: number; // work needed per research level
    researchProductivityBonus: number; // productivity added per research level
  };
  network: {
    priceTableRate: number; // global price table broadcasts per wall-clock second
    snapshotRate: number; // snapshots per wall-clock second for owned areas and the viewport
  };
  military: {
    foodGood: GoodId; // good soldiers eat; taken from the goods catalog
    weaponsGood: GoodId; // good soldiers are equipped with; taken from the goods catalog
    foodPerSoldierPerDay: number; // units of food eaten per soldier per game day
    weaponWearRatePerDay: number; // share of carried weapons worn out per day
    desertionRatePerDay: number; // share of soldiers leaving per day without food
    soldierWage: number; // wage per soldier-hour, in man-hours
    combatLethalityPerDay: number; // losses per day per unit of enemy power over own power per soldier
    militiaShare: number; // share of a neutral area's population that defends it
    siegeRatePerDay: number; // siege progress per day per unit of power per inhabitant
    foragingShare: number; // largest share of an area's food stock an army takes per day
    battleStockDestructionPerDay: number; // share of an area's stock destroyed per day of fighting
    battleCivilianLossPerDay: number; // share of an area's population lost per day of fighting
  };
  warmupDays: number; // game days simulated with no players before the game opens
  warmupResponsivenessBoost: number; // responsiveness multiplier during warm-up
}

/** Every default except the catalog-dependent military goods, which createConfig fills in. */
export const DEFAULT_CONFIG: Omit<WorldConfig, "military"> & {
  military: Omit<WorldConfig["military"], "foodGood" | "weaponsGood" | "foodPerSoldierPerDay">;
} = {
  pace: {
    maxTicksPerSecond: 10,
    gameDaysPerTick: 1,
    economyResponsiveness: 1,
    demographyResponsiveness: 1,
    militaryResponsiveness: 1,
  },
  economy: {
    hoursPerWorkerDay: 8,
    workforceShare: 0.5,
    reserveDays: 5,
    maxReserveSpoilageShare: 0.1,
    priceAdjustmentRatePerDay: 0.35,
    priceFlowWeight: 0.3,
    scarcityPremium: 0.1,
    priceSmoothingRatePerDay: 0.07,
    tradeRatePerDay: 0.23,
    tradeGapSensitivity: 20,
    exportReserveShare: 0.5,
    laborMobilityRatePerDay: 0.07,
    laborAllocationTemperature: 1,
    reservationWage: 1,
    stockRecoveryDays: 5,
    maxPriceChangePerTick: 0.1,
    maxLaborShiftPerTick: 0.02,
    priceFloorMultiple: 0.1,
    priceCeilingMultiple: 10,
    tierWeights: { necessity: 3, comfort: 2, luxury: 1 },
    targetSavingsDays: 30,
    savingsElasticity: 0.5,
    savingsFactorMin: 0.25,
    savingsFactorMax: 4,
  },
  transport: {
    landCostPerDistance: 0.003,
    seaCostPerDistance: 0.0004,
    airBaseCost: 3,
    airCostPerDistance: 0.02,
    seaRoutesPerPort: 4,
    airRoutesPerAirport: 3,
    seaCapacityPerPortLevel: 1000,
    airCapacityPerAirportLevel: 20,
    portWorkerDaysPerLevel: 4000,
    airportWorkerDaysPerLevel: 6000,
    maximumPortLevel: 3,
    maximumAirportLevel: 3,
    initialAirportShare: 0.05,
    seaTravelDaysPerDistance: 0.01,
    migrationFactorBySea: 0.5,
    migrationFactorByAir: 0.25,
  },
  population: {
    growthRatePerDay: 0.0001,
    starvationRatePerDay: 0.003,
    growthSatisfactionThreshold: 0.9,
    migrationRatePerDay: 0.01,
    migrationWageWeight: 0.5,
  },
  government: {
    hiringRatePerDay: 0.1,
    quitRatePerDay: 0.1,
    infrastructureWorkerDaysPerStep: 2000,
    infrastructureStepFactor: 0.9,
    minimumTransportCostFactor: 0.3,
    fortificationWorkerDaysPerLevel: 3000,
    maximumFortificationLevel: 3,
    researchWorkerDaysPerLevel: 10000,
    researchProductivityBonus: 0.05,
  },
  network: {
    priceTableRate: 1,
    snapshotRate: 3,
  },
  military: {
    weaponWearRatePerDay: 0.005,
    desertionRatePerDay: 0.05,
    soldierWage: 1,
    combatLethalityPerDay: 0.05,
    militiaShare: 0.02,
    siegeRatePerDay: 0.25,
    foragingShare: 0.2,
    battleStockDestructionPerDay: 0.02,
    battleCivilianLossPerDay: 0.002,
  },
  warmupDays: 180,
  warmupResponsivenessBoost: 3,
};

export type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K] };

/**
 * Builds a full config for a catalog from partial overrides. The military food and weapons goods come from the
 * catalog; soldiers eat by default what one inhabitant needs of the food need, expressed in units of the food good.
 */
export function createConfig(catalog: Catalog, overrides: DeepPartial<WorldConfig> = {}): WorldConfig {
  const foodGood = catalog.goods[catalog.military.foodGood];
  const foodNeed = foodGood?.satisfies ? catalog.needs[foodGood.satisfies.need] : undefined;
  const foodPerSoldierPerDay =
    foodGood?.satisfies && foodNeed ? foodNeed.demandPerPersonPerDay / foodGood.satisfies.unitsPerGood : 1;
  const base: WorldConfig = {
    ...DEFAULT_CONFIG,
    military: {
      ...DEFAULT_CONFIG.military,
      foodGood: catalog.military.foodGood,
      weaponsGood: catalog.military.weaponsGood,
      foodPerSoldierPerDay,
    },
  };
  return deepMerge(JSON.parse(JSON.stringify(base)) as WorldConfig, overrides);
}

function deepMerge<T>(target: T, overrides: DeepPartial<T>): T {
  for (const key of Object.keys(overrides) as (keyof T)[]) {
    const value = overrides[key];
    if (value === undefined) continue;
    const current = target[key];
    if (typeof value === "object" && value !== null && typeof current === "object" && current !== null) {
      deepMerge(current, value as DeepPartial<typeof current>);
    } else {
      target[key] = value as T[keyof T];
    }
  }
  return target;
}
