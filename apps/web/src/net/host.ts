// Hosting from this browser: the PeerJS host peer, the lobby, and the routing between joined players and the
// simulation worker (specification §9, Joining).
// PeerJS loads only once the player hosts, so solo play never downloads it.
import type { HostPeer, HostSession, HostStatus as NetStatus } from "@geonomics/net";
import type { FromWorker, HostStatus } from "../host/protocol";
import { gameStore, postToWorker } from "../state/store";
import { brokerOptions, joinLink } from "./options";

interface Hosting {
  session: HostSession;
  peer: HostPeer;
}

let hosting: Hosting | null = null;
let starting: Promise<string> | null = null;
let lastStatus: HostStatus | null = null;

const netStatus = (status: HostStatus): NetStatus => ({ ...status, hidden: document.hidden });

/** Starts hosting the current game, once; resolves to the join link. */
export function startHosting(): Promise<string> {
  if (hosting) return Promise.resolve(joinLink(hosting.peer.id));
  starting ??= open().finally(() => {
    starting = null;
  });
  return starting;
}

async function open(): Promise<string> {
  const { HostSession, openHost } = await import("@geonomics/net");
  const session = new HostSession(
    {
      welcome: () => {
        const { data, governments } = gameStore.getState();
        return data ? { data, governments } : null;
      },
      unavailable: (government) => {
        const summary = gameStore.getState().governments[government];
        if (!summary) return "unknown realm";
        return summary.isEliminated ? "that realm is eliminated" : null;
      },
      setPlayer: (player, government, watching) => postToWorker({ type: "player", player, government, watching }),
      command: (player, command) => postToWorker({ type: "command", command, player }),
      setFlowGood: (player, good) => postToWorker({ type: "setFlowGood", good, player }),
      focus: (player, area) => postToWorker({ type: "focus", player, area }),
    },
    "Host",
  );
  const peer = await openHost(brokerOptions(), (link) => session.accept(link));
  hosting = { session, peer };
  const state = gameStore.getState();
  if (state.screen === "game") {
    session.setHostChoice(state.viewer);
    session.setStarted();
  }
  session.onLobby((players) => gameStore.getState().setSession({ players }));
  const link = joinLink(peer.id);
  gameStore.getState().setSession({ role: "host", link, players: session.lobby(), started: state.screen === "game" });
  return link;
}

/** The host entered its game: record its choice for the lobby. */
export function hostEntered(government: number | null): void {
  if (!hosting) return;
  hosting.session.setHostChoice(government);
  hosting.session.setStarted();
}

/** Frees a realm held by a joined player. */
export function releaseRealm(government: number): void {
  hosting?.session.release(government);
}

/** Ends hosting, when the host leaves its game or starts another one. */
export function stopHosting(): void {
  if (!hosting) return;
  hosting.session.close();
  hosting.peer.close();
  hosting = null;
  gameStore.getState().setSession({ role: "solo", link: null, players: [], started: false });
}

/**
 * Takes the worker's messages meant for joined players: packed snapshots and price tables, and their rejections.
 * Returns true when the message is not for the local interface.
 */
export function routeWorkerMessage(message: FromWorker): boolean {
  if (message.type === "status") {
    lastStatus = message.status;
    hosting?.session.broadcast({ type: "hostStatus", status: netStatus(message.status) });
    return false;
  }
  if (!hosting) return message.type === "remote";
  if (message.type === "remote") {
    if (message.to === null) hosting.session.broadcastPacked(message.bytes);
    else hosting.session.sendPacked(message.to, message.bytes);
    return true;
  }
  if (message.type === "rejected" && message.to !== "local") {
    hosting.session.sendTo(message.to, { type: "commandRejected", command: message.command, reason: message.reason });
    return true;
  }
  return false;
}

// Hiding or showing the host's tab sends no status from the worker, so tell the players.
if (typeof document !== "undefined") {
  document.addEventListener("visibilitychange", () => {
    if (hosting && lastStatus) hosting.session.broadcast({ type: "hostStatus", status: netStatus(lastStatus) });
  });
}
