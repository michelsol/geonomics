// Phase 10, government part: progress of infrastructure, fortification, port and airport jobs
// (specification §6, Government jobs). Port and airport levels are then applied by advanceInfrastructure.
import type { Area, Edge, World } from "../types";

export function runJobs(world: World): void {
  const days = world.config.pace.gameDaysPerTick;
  const g = world.config.government;
  for (const government of world.governments) {
    if (government.isEliminated) continue;
    for (const [id, state] of government.areaStates) {
      const area = world.areas[id] as Area;
      for (const { job, workers } of state.jobs) {
        const workerDays = workers * days;
        switch (job.kind) {
          case "buildInfrastructure":
            buildInfrastructure(world, world.edges[job.edge] as Edge, workerDays);
            break;
          case "fortify":
            if (area.fortificationLevel >= g.maximumFortificationLevel) break;
            area.fortificationProgress += workerDays;
            while (
              area.fortificationLevel < g.maximumFortificationLevel &&
              area.fortificationProgress >= g.fortificationWorkerDaysPerLevel
            ) {
              area.fortificationProgress -= g.fortificationWorkerDaysPerLevel;
              area.fortificationLevel += 1;
            }
            break;
          case "buildPort":
            if (area.isCoastal) area.portProgress += workerDays;
            break;
          case "buildAirport":
            area.airportProgress += workerDays;
            break;
          case "produce":
            break; // produced in phase 1
        }
      }
    }
  }
}

/** Each infrastructureWorkerDaysPerStep multiplies the edge's transport cost by the step factor, down to the floor. */
export function buildInfrastructure(world: World, edge: Edge, workerDays: number): void {
  const g = world.config.government;
  const floor = edge.baseTransportCost * g.minimumTransportCostFactor;
  if (edge.transportCost <= floor) return;
  edge.infrastructureProgress += workerDays;
  while (edge.infrastructureProgress >= g.infrastructureWorkerDaysPerStep && edge.transportCost > floor) {
    edge.infrastructureProgress -= g.infrastructureWorkerDaysPerStep;
    edge.transportCost = Math.max(floor, edge.transportCost * g.infrastructureStepFactor);
  }
}
