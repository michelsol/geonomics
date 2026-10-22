// Phase 7, government part: hiring, quitting and firing (specification §6, Hiring and wages).
import { EPSILON, fractionPerTick } from "../math";
import type { Area, GovernmentAreaState, World } from "../types";
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
      if (state.jobs.length === 0) continue;
      const area = world.areas[id] as Area;
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
      capToWorkforce(area, state, economy.workforceShare);
    }
  }
}

/** Government workers never exceed the workforce, which can shrink under them through starvation or migration. */
function capToWorkforce(area: Area, state: GovernmentAreaState, workforceShare: number): void {
  let workers = 0;
  for (const job of state.jobs) workers += job.workers;
  const workforce = area.population * workforceShare;
  if (workers <= workforce) return;
  const keep = workforce / workers;
  for (const job of state.jobs) job.workers *= keep;
}
