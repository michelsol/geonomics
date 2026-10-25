// Infrastructure levels, staffing and costs (specification §6, Infrastructure). Each kind's per-kind arrays follow
// INFRASTRUCTURE_KINDS.
import type { WorldConfig } from "./config";
import type { Area, GovernmentAreaState, InfrastructureKind, ResolvedPolicies } from "./types";

export const INFRASTRUCTURE_KINDS: readonly InfrastructureKind[] = ["port", "airport", "roads", "fort"];

/** Index of a kind in every per-kind array. */
export const kindIndex = (kind: InfrastructureKind): number => INFRASTRUCTURE_KINDS.indexOf(kind);

export function levelOf(area: Area, kind: InfrastructureKind): number {
  switch (kind) {
    case "port":
      return area.portLevel;
    case "airport":
      return area.airportLevel;
    case "roads":
      return area.roadLevel;
    case "fort":
      return area.fortificationLevel;
  }
}

export function setLevel(area: Area, kind: InfrastructureKind, level: number): void {
  switch (kind) {
    case "port":
      area.portLevel = level;
      return;
    case "airport":
      area.airportLevel = level;
      return;
    case "roads":
      area.roadLevel = level;
      return;
    case "fort":
      area.fortificationLevel = level;
      return;
  }
}

/** What an infrastructure delivers: its built level times its staffed share. */
export function effectiveLevel(area: Area, kind: InfrastructureKind): number {
  return levelOf(area, kind) * (area.staffing[kindIndex(kind)] as number);
}

/** Workers the built levels of a kind need to run. */
export function staffQuota(config: WorldConfig, area: Area, kind: InfrastructureKind): number {
  return levelOf(area, kind) * config.infrastructure.staffPerLevel[kind];
}

/** Man-hours to build level `level` of a kind, paid over its build days. */
export function levelCost(config: WorldConfig, kind: InfrastructureKind, level: number): number {
  return level * config.infrastructure.costPerLevel[kind];
}

/** Whether an area can have a kind at all: ports need a coast. */
export const canBuild = (area: { isCoastal: boolean }, kind: InfrastructureKind): boolean =>
  kind !== "port" || area.isCoastal;

/** Whether a kind is under construction in an area: below its target and the maximum level, where it can stand. */
export function isBuilding(
  config: WorldConfig,
  area: Area,
  state: Pick<GovernmentAreaState, "targetLevel">,
  kind: InfrastructureKind,
): boolean {
  const target = Math.min(state.targetLevel[kindIndex(kind)] as number, config.infrastructure.maximumLevel);
  return canBuild(area, kind) && levelOf(area, kind) < target;
}

/** Staff pay as a share of the area's wage level: the policy in force, or the default. */
export const staffWageShareOf = (config: WorldConfig, policies: ResolvedPolicies): number =>
  policies.staffWageShare ?? config.infrastructure.defaultStaffWageShare;

/**
 * What a government owes an area per game day for its infrastructure, before any shortfall of the treasury: staff
 * wages, `share` of the wage level per staff-hour, and the payments of the levels under construction.
 */
export function infrastructureBillPerDay(
  config: WorldConfig,
  area: Area,
  state: GovernmentAreaState,
  share: number,
): { staff: number; construction: number } {
  const hourly = share * Math.max(area.wageLevel, 0) * config.economy.hoursPerWorkerDay;
  let staff = 0;
  let construction = 0;
  for (const [k, kind] of INFRASTRUCTURE_KINDS.entries()) {
    staff += (state.staff[k] as number) * hourly;
    if (isBuilding(config, area, state, kind))
      construction += levelCost(config, kind, levelOf(area, kind) + 1) / config.infrastructure.buildDaysPerLevel[kind];
  }
  return { staff, construction };
}
