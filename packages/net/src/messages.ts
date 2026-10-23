// Messages between a hosting browser and the players who join it (specification §9, Messages).
import type {
  AreaId,
  Command,
  GoodId,
  GovernmentId,
  GovernmentSummary,
  PlayerId,
  Snapshot,
  StaticData,
} from "@geonomics/sim";

/** Bumped whenever a message changes shape; a client with another version is refused. */
export const PROTOCOL_VERSION = 1;

/** The host's own player id; joining players are identified by the random token their tab keeps. */
export const HOST_PLAYER: PlayerId = "local";

export interface LobbyPlayer {
  id: PlayerId;
  name: string;
  role: "choosing" | "player" | "spectator";
  government: GovernmentId | null; // the realm held, kept while the player is offline
  online: boolean;
  isHost: boolean;
}

export interface HostStatus {
  paused: boolean;
  hidden: boolean; // the host's tab is hidden, which pauses the game
  speed: number | "max";
  ticksPerSecond: number;
  msPerTick: number;
  tick: number;
}

export type ToHost =
  | { type: "hello"; version: number; name: string; token: PlayerId }
  | { type: "choose"; government: GovernmentId | null } // null: watch as a spectator
  | { type: "command"; command: Command }
  | { type: "setFlowGood"; good: GoodId | null }
  | { type: "focus"; area: AreaId | null } // the area the player looks at, whose detail comes in every snapshot
  | { type: "leave" };

export type ToClient =
  | { type: "welcome"; you: LobbyPlayer; data: StaticData; governments: GovernmentSummary[] }
  | { type: "refused"; reason: string }
  | { type: "lobby"; players: LobbyPlayer[]; started: boolean }
  | { type: "you"; you: LobbyPlayer } // the player's own role changed (a choice accepted, a realm released)
  | { type: "notice"; text: string } // a choice refused, or news from the host
  | { type: "snapshot"; snapshot: Snapshot }
  | { type: "priceTable"; tick: number; gameDay: number; table: Uint16Array }
  | { type: "commandRejected"; command: Command; reason: string }
  | { type: "hostStatus"; status: HostStatus };
