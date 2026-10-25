// The hosting side of a game: players, the lobby, and routing between their links and the game
// (specification §8, Joining and Players).
import type { AreaId, Command, GoodId, GovernmentId, GovernmentSummary, PlayerId, StaticData } from "@geonomics/sim";
import { type Link, MessageLink } from "./link";
import { HOST_PLAYER, type LobbyPlayer, PROTOCOL_VERSION, type ToClient, type ToHost } from "./messages";

/** A client whose channel holds more than this skips snapshots and price tables until it drains. */
export const BACKPRESSURE_BYTES = 1024 * 1024;
const MAX_NAME = 32;

/** What the session needs from the game it hosts. */
export interface HostGame {
  /** Static data and government summaries for a newcomer, or null before the world exists. */
  welcome(): { data: StaticData; governments: GovernmentSummary[] } | null;
  /** Why nobody may take this government (unknown or eliminated), or null. */
  unavailable(government: GovernmentId): string | null;
  /**
   * The player now holds `government` (null: none, as a spectator or while choosing) and, while `watching`, receives
   * snapshots for it. A government the player held before goes back to the idle AI.
   */
  setPlayer(player: PlayerId, government: GovernmentId | null, watching: boolean): void;
  command(player: PlayerId, command: Command): void;
  setFlowGood(player: PlayerId, good: GoodId | null): void;
  focus(player: PlayerId, area: AreaId | null): void;
}

interface Entry extends LobbyPlayer {
  link: MessageLink<ToHost, ToClient> | null;
}

const publicOf = ({ link: _, ...player }: Entry): LobbyPlayer => player;

export class HostSession {
  private readonly players = new Map<PlayerId, Entry>();
  private readonly listeners = new Set<(players: LobbyPlayer[]) => void>();
  private started = false;
  skipped = 0; // snapshots and price tables skipped for slow clients, for diagnostics

  constructor(
    private readonly game: HostGame,
    hostName = "Host",
  ) {
    this.players.set(HOST_PLAYER, {
      id: HOST_PLAYER,
      name: hostName,
      role: "choosing",
      government: null,
      online: true,
      isHost: true,
      link: null,
    });
  }

  /** Takes a new connection; it becomes a player once it says hello. */
  accept(link: Link): void {
    const messages = new MessageLink<ToHost, ToClient>(link);
    let player: Entry | null = null;
    messages.onMessage(
      (message) => {
        if (player) this.handle(player, message);
        else player = this.hello(messages, message);
      },
      () => messages.close(), // undecodable data: drop the connection
    );
    link.onClose(() => {
      if (player && player.link === messages) this.drop(player);
    });
  }

  /** The lobby as everyone sees it, host first. */
  lobby(): LobbyPlayer[] {
    return [...this.players.values()].map(publicOf);
  }

  onLobby(listener: (players: LobbyPlayer[]) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Records the host's own choice, made in its interface, for the lobby. */
  setHostChoice(government: GovernmentId | null): void {
    const host = this.players.get(HOST_PLAYER) as Entry;
    host.government = government;
    host.role = government === null ? "spectator" : "player";
    this.changed();
  }

  /** Who holds a government other than `except`, if anyone. */
  holder(government: GovernmentId, except?: PlayerId): LobbyPlayer | undefined {
    for (const player of this.players.values())
      if (player.government === government && player.id !== except) return publicOf(player);
    return undefined;
  }

  /** Frees a government held by a joined player, for instance one who went offline. */
  release(government: GovernmentId): void {
    for (const player of this.players.values()) {
      if (player.isHost || player.government !== government) continue;
      player.government = null;
      player.role = "choosing";
      this.game.setPlayer(player.id, null, false);
      player.link?.send({ type: "notice", text: "The host released your realm. Choose another one." });
      player.link?.send({ type: "you", you: publicOf(player) });
    }
    this.changed();
  }

  setStarted(): void {
    this.started = true;
    this.changed();
  }

  /** Sends a snapshot packed in the worker to one player, unless its channel is backed up. */
  sendPacked(player: PlayerId, packed: Uint8Array): void {
    const entry = this.players.get(player);
    if (!entry?.link) return;
    if (entry.link.bufferedAmount > BACKPRESSURE_BYTES) this.skipped++;
    else entry.link.sendPackedInOrder(packed);
  }

  /** Sends a packed message (the price table) to every player in the game. */
  broadcastPacked(packed: Uint8Array): void {
    for (const player of this.players.values()) if (player.role !== "choosing") this.sendPacked(player.id, packed);
  }

  broadcast(message: ToClient): void {
    for (const player of this.players.values()) player.link?.send(message);
  }

  sendTo(player: PlayerId, message: ToClient): void {
    this.players.get(player)?.link?.send(message);
  }

  close(): void {
    for (const player of this.players.values()) player.link?.close();
  }

  private hello(link: MessageLink<ToHost, ToClient>, message: ToHost): Entry | null {
    const refuse = (reason: string) => {
      link.send({ type: "refused", reason });
      setTimeout(() => link.close(), 500); // let the reason arrive first
      return null;
    };
    if (message.type !== "hello") return refuse("say hello first");
    if (message.version !== PROTOCOL_VERSION)
      return refuse(`this game runs protocol ${PROTOCOL_VERSION}, your page runs ${message.version}: reload it`);
    const token = message.token;
    if (typeof token !== "string" || token.length === 0 || token.length > 64 || token === HOST_PLAYER)
      return refuse("invalid player token");
    const welcome = this.game.welcome();
    if (!welcome) return refuse("the host has no game yet");
    const name =
      String(message.name ?? "")
        .trim()
        .slice(0, MAX_NAME) || "Player";
    let entry = this.players.get(token);
    if (entry) {
      // A reconnection, or the same tab duplicated: the newest link wins and the realm comes back.
      if (entry.link && entry.link !== link) entry.link.close();
      entry.link = link;
      entry.online = true;
      entry.name = name;
    } else {
      entry = { id: token, name, role: "choosing", government: null, online: true, isHost: false, link };
      this.players.set(token, entry);
    }
    link.send({ type: "welcome", you: publicOf(entry), ...welcome });
    if (entry.role !== "choosing") this.game.setPlayer(entry.id, entry.government, true);
    this.changed();
    return entry;
  }

  private handle(player: Entry, message: ToHost): void {
    switch (message.type) {
      case "choose":
        this.choose(player, message.government);
        return;
      case "command":
        // The command acts for the player's own realm; the game checks it as for any player.
        if (player.role === "player") this.game.command(player.id, message.command);
        else player.link?.send({ type: "commandRejected", command: message.command, reason: "choose a realm first" });
        return;
      case "setFlowGood":
        this.game.setFlowGood(player.id, message.good);
        return;
      case "focus":
        this.game.focus(player.id, message.area);
        return;
      case "leave":
        // Leaving for good frees the realm, unlike a dropped connection.
        this.players.delete(player.id);
        this.game.setPlayer(player.id, null, false);
        player.link?.close();
        this.changed();
        return;
      case "hello":
        return;
    }
  }

  private choose(player: Entry, government: GovernmentId | null): void {
    if (government !== null) {
      const holder = Number.isInteger(government) ? this.holder(government, player.id) : undefined;
      const reason = !Number.isInteger(government)
        ? "unknown realm"
        : holder
          ? `${holder.name} already holds this realm`
          : this.game.unavailable(government);
      if (reason) {
        player.link?.send({ type: "notice", text: reason });
        return;
      }
    }
    player.government = government;
    player.role = government === null ? "spectator" : "player";
    this.game.setPlayer(player.id, government, true);
    player.link?.send({ type: "you", you: publicOf(player) });
    this.changed();
  }

  private drop(player: Entry): void {
    player.link = null;
    player.online = false;
    // The realm stays reserved for the player's return; only the snapshots stop.
    this.game.setPlayer(player.id, player.government, false);
    this.changed();
  }

  private changed(): void {
    const players = this.lobby();
    this.broadcast({ type: "lobby", players, started: this.started });
    for (const listener of this.listeners) listener(players);
  }
}
