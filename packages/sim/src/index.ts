// Simulation: data model, config, catalog loader, tick, commands, AI, map generation, save format.
// No browser or network dependency.
export { type AiActivity, lastAiActivity } from "./ai";
export { TRAITS, type Traits } from "./ai/personalities";
export * from "./army";
export * from "./bands";
export * from "./catalog";
export * from "./commands";
export * from "./config";
export * from "./government";
export { neutralPolicies, resolveSettings } from "./government";
export * from "./graph";
export * from "./hash";
export { MinHeap } from "./heap";
export * from "./infrastructure";
export * from "./init";
export * from "./mapgen";
export * from "./math";
export * from "./random";
export * from "./routes";
export * from "./save";
export * from "./snapshot";
export { unemployedIncome } from "./tick/consumption";
export {
  placeStartingInfrastructure,
  rebuildAirRoutes,
  rebuildSeaRoutes,
  runConstruction,
  staffFully,
  updateInfrastructureEffects,
  updateRouteCapacities,
} from "./tick/infrastructure";
export { realmAverageWage } from "./tick/military";
export { lastBirths, lastDeaths, lastMigration } from "./tick/population";
export { hourlyOutputPerWorker } from "./tick/production";
export { runTick, type TickOptions } from "./tick/tick";
export { lastTradeFlows, lastTradeTonnage, type TradeFlow } from "./tick/trade";
export type * from "./types";
export * from "./waters";
export * from "./world";
