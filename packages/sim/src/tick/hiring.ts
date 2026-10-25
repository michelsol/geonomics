// Phase 7, government part: hiring, quitting and firing of government workers and infrastructure staff
// (specification §6, Hiring and wages; Infrastructure).
import { INFRASTRUCTURE_KINDS, staffQuota, staffWageShareOf } from "../infrastructure";
import { EPSILON, fractionPerTick } from "../math";
import type { Area, GovernmentAreaState, World } from "../types";
import { updateStaffing } from "./infrastructure";
import { takeWorkers } from "./population";
import { scratchOf } from "./scratch";

export function runHiring(world: World): void {
  const scratch = scratchOf(world);
  const { pace, government: g, economy } = world.config;
  const hiring = fractionPerTick(g.hiringRatePerDay, pace.economyResponsiveness, pace.gameDaysPerTick);
  const quitting = fractionPerTick(g.quitRatePerDay, pace.economyResponsiveness, pace.gameDaysPerTick);

  for (const government of world.governments) {
    if (government.isEliminated) continue;
    const unpaid = 1 - (scratch.paidShare[government.id] ?? 1);
    for (const [id, state] of government.areaStates) {
      const area = world.areas[id] as Area;
      // Staff are paid a share of the wage level, so the share is their pay against private jobs.
      const share = staffWageShareOf(world.config, state.resolvedPolicies);
      const staffQuit = quitting * Math.max(0, 1 - share, unpaid);
      for (const [k, kind] of INFRASTRUCTURE_KINDS.entries()) {
        const quota = staffQuota(world.config, area, kind);
        let staff = state.staff[k] as number;
        if (staff > quota) {
          area.unemployedWorkers += staff - quota; // levels taken down release their staff at once
          staff = quota;
        }
        if (staffQuit > 0) {
          area.unemployedWorkers += staff * staffQuit;
          staff -= staff * staffQuit;
        }
        if (quota > staff && share >= 1) staff += takeWorkers(world, area, hiring * (quota - staff));
        state.staff[k] = staff;
      }

      if (state.jobs.length > 0) {
        const attractiveness = state.wageOffer / Math.max(area.wageLevel, EPSILON);
        // Workers quit for the larger of the wage shortfall against private jobs and the share left unpaid.
        const quit = quitting * Math.max(0, 1 - attractiveness, unpaid);
        for (const job of state.jobs) {
          if (job.workers > job.targetWorkers) {
            area.unemployedWorkers += job.workers - job.targetWorkers; // firing is instant
            job.workers = job.targetWorkers;
          }
          if (quit > 0) {
            const leaving = job.workers * quit;
            job.workers -= leaving;
            area.unemployedWorkers += leaving;
          }
          if (job.targetWorkers > job.workers && attractiveness >= 1) {
            job.workers += takeWorkers(world, area, hiring * (job.targetWorkers - job.workers));
          }
        }
        state.jobs = state.jobs.filter((job) => job.targetWorkers > 0 || job.workers > EPSILON);
      }
      capToWorkforce(area, state, economy.workforceShare);
      updateStaffing(world, area, state);
    }
  }
}

/** Government workers never exceed the workforce, which can shrink under them through starvation or migration. */
function capToWorkforce(area: Area, state: GovernmentAreaState, workforceShare: number): void {
  let workers = 0;
  for (const job of state.jobs) workers += job.workers;
  for (const staff of state.staff) workers += staff;
  const workforce = area.population * workforceShare;
  if (workers <= workforce) return;
  const keep = workforce / workers;
  for (const job of state.jobs) job.workers *= keep;
  for (let k = 0; k < state.staff.length; k++) state.staff[k] = (state.staff[k] as number) * keep;
}
