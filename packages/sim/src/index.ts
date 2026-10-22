// Simulation: data model, config, catalog loader, tick, commands, AI, map generation, save format.
// No browser or network dependency.
export * from "./catalog";
export * from "./config";
export * from "./hash";
export * from "./init";
export * from "./mapgen";
export * from "./math";
export * from "./random";
export * from "./routes";
export { purchasingPower } from "./tick/consumption";
export { advanceInfrastructure, rebuildAirRoutes, updateRouteCapacities } from "./tick/infrastructure";
export { hourlyOutputPerWorker } from "./tick/production";
export { runTick } from "./tick/tick";
export { lastTradeFlows, lastTradeTonnage, type TradeFlow } from "./tick/trade";
export type * from "./types";
export * from "./world";
