// Edge costs and capacities for land borders and sea and air routes (specification §5, Sea and air routes).
import type { WorldConfig } from "./config";
import { effectiveLevel } from "./infrastructure";
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

/**
 * Tonnes per day per direction: infinite on land, none on a sea lane, and set on routes by the smaller port or
 * airport as it runs, its level times its staffed share (section 6, Infrastructure).
 */
export function edgeCapacityPerDay(config: WorldConfig, edge: Edge, a: Area, b: Area): number {
  const t = config.transport;
  switch (edge.mode) {
    case "land":
      return Number.POSITIVE_INFINITY;
    case "sea":
      if (edge.isLane) return 0;
      return t.seaCapacityPerPortLevel * Math.min(effectiveLevel(a, "port"), effectiveLevel(b, "port"));
    case "air":
      return t.airCapacityPerAirportLevel * Math.min(effectiveLevel(a, "airport"), effectiveLevel(b, "airport"));
  }
}

/**
 * Transport cost of a land edge: its base cost, lowered by the mean running road level of its two areas, down to
 * minimumTransportCostFactor of base when both run roads at the maximum level. Routes keep their base cost.
 */
export function edgeTransportCost(config: WorldConfig, edge: Edge, a: Area, b: Area): number {
  if (edge.mode !== "land") return edge.baseTransportCost;
  const { maximumLevel, minimumTransportCostFactor } = config.infrastructure;
  const roads = (effectiveLevel(a, "roads") + effectiveLevel(b, "roads")) / (2 * maximumLevel);
  return edge.baseTransportCost * (1 - (1 - minimumTransportCostFactor) * roads);
}
