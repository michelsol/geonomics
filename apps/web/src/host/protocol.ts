// Messages between the main thread and the simulation worker (specification §9, Single player and Host loop).
import type {
  AiMix,
  AreaId,
  Command,
  GoodId,
  GovernmentId,
  GovernmentSummary,
  PlayerId,
  SaveInfo,
  Snapshot,
  StaticData,
} from "@geonomics/sim";

export type CatalogName = "small" | "medium" | "large";

export interface GameOptions {
  catalog: CatalogName;
  areas: number; // land areas on the generated map
  seed: number;
  realms: number; // governments founded; they split the whole map between them
  aiMix: AiMix; // personalities of the realms the AI runs
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
  | { type: "load"; file: Uint8Array } // a save file, compressed or not
  | { type: "loadSaved"; gameId: string } // a game saved in this browser
  | { type: "save" } // autosave now, as when the tab is hidden
  | { type: "export" } // answered with `exported`
  | { type: "start"; government: GovernmentId | null } // the local player takes this government (or watches) and the game runs
  | { type: "command"; command: Command; player?: PlayerId } // from the local player unless a joined player is named
  | { type: "setSpeed"; speed: Speed }
  | { type: "setFlowGood"; good: GoodId | null; player?: PlayerId } // the good whose trade flows snapshots carry
  | { type: "player"; player: PlayerId; government: GovernmentId | null; watching: boolean } // a joined player's role
  | { type: "focus"; player: PlayerId; area: AreaId | null } // the area a joined player looks at
  | { type: "pause" }
  | { type: "resume" }
  | { type: "endGame" };

export type FromWorker =
  | { type: "progress"; stage: string; done: number } // done in [0, 1]
  | { type: "static"; data: StaticData; governments: GovernmentSummary[] }
  | { type: "snapshot"; snapshot: Snapshot }
  | { type: "priceTable"; tick: number; gameDay: number; table: Uint16Array }
  | { type: "status"; status: HostStatus }
  | { type: "rejected"; to: PlayerId; command: Command; reason: string }
  | { type: "remote"; to: PlayerId | null; bytes: Uint8Array } // a packed message for one joined player, or all (null)
  | { type: "exported"; info: SaveInfo; file: Uint8Array } // the save file, compressed
  | { type: "error"; message: string };

/** The player id of the local player in a solo game. */
export const LOCAL_PLAYER = "local";
