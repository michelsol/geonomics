// Edge costs and capacities for land borders and sea and air routes (specification §5, Sea and air routes).
import type { WorldConfig } from "./config";
import type { Area, Edge, EdgeMode } from "./types";

/** Land armies march about 25 map units (km) per game day until map generation sets terrain-specific values. */
export const LAND_DISTANCE_PER_TRAVEL_DAY = 25;

export function edgeBaseTransportCost(
  config: WorldConfig,
  mode: EdgeMode,
  distance: number,
  terrainFactor = 1,
): number {
  const t = config.transport;
  switch (mode) {
    case "land":
      return t.landCostPerDistance * distance * terrainFactor;
    case "sea":
      return t.seaCostPerDistance * distance;
    case "air":
      return t.airBaseCost + t.airCostPerDistance * distance;
  }
}

export function edgeTravelDays(config: WorldConfig, mode: EdgeMode, distance: number): number {
  switch (mode) {
    case "land":
      return distance / LAND_DISTANCE_PER_TRAVEL_DAY;
    case "sea":
      return config.transport.seaTravelDaysPerDistance * distance;
    case "air":
      return Number.POSITIVE_INFINITY;
  }
}

/** Tonnes per day per direction: infinite on land, set by the smaller port or airport on routes. */
export function edgeCapacityPerDay(config: WorldConfig, edge: Edge, a: Area, b: Area): number {
  const t = config.transport;
  switch (edge.mode) {
    case "land":
      return Number.POSITIVE_INFINITY;
    case "sea":
      return t.seaCapacityPerPortLevel * Math.min(a.portLevel, b.portLevel);
    case "air":
      return t.airCapacityPerAirportLevel * Math.min(a.airportLevel, b.airportLevel);
  }
}
