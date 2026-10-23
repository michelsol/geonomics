// Messages between the main thread and the simulation worker (specification §9, Single player).
import type { Command, GoodId, GovernmentId, GovernmentSummary, Snapshot, StaticData } from "@geonomics/sim";

export type CatalogName = "small" | "medium" | "large";

export interface GameOptions {
  catalog: CatalogName;
  areas: number; // land areas on the generated map
  seed: number;
  warmupDays?: number; // defaults to the config's warmupDays; shortened for tests
}

/** Target speed: ticks per second, or "max" to run ticks back to back. */
export type Speed = number | "max";

export interface HostStatus {
  paused: boolean;
  speed: Speed;
  ticksPerSecond: number; // measured over the last second
  msPerTick: number; // moving average of the time one tick takes
  tick: number;
}

export type ToWorker =
  | { type: "create"; options: GameOptions }
  | { type: "start"; government: GovernmentId } // the local player takes this government and the game runs
  | { type: "command"; command: Command }
  | { type: "setSpeed"; speed: Speed }
  | { type: "setFlowGood"; good: GoodId | null } // the good whose trade flows snapshots carry; null for none
  | { type: "pause" }
  | { type: "resume" }
  | { type: "endGame" };

export type FromWorker =
  | { type: "progress"; stage: string; done: number } // done in [0, 1]
  | { type: "static"; data: StaticData; governments: GovernmentSummary[] }
  | { type: "snapshot"; snapshot: Snapshot }
  | { type: "priceTable"; tick: number; gameDay: number; table: Uint16Array }
  | { type: "status"; status: HostStatus }
  | { type: "rejected"; command: Command; reason: string }
  | { type: "error"; message: string };

/** The player id of the local player in a solo game. */
export const LOCAL_PLAYER = "local";
