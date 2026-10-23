// Where the signaling broker is, the join link, and what a joining tab remembers (specification §9, Joining).
import type { BrokerOptions } from "@geonomics/net";

/**
 * The broker: the PeerJS cloud by default, or `?peer=host:port[/path]` for a self-hosted PeerServer (tests and local
 * play run one). The setting travels in the join link, so joined players use the same broker.
 */
export function brokerOptions(search = location.search): BrokerOptions {
  const value = new URLSearchParams(search).get("peer");
  if (!value) return {};
  const match = /^([^:/]+)(?::(\d+))?(\/.*)?$/.exec(value);
  if (!match) return {};
  const host = match[1] as string;
  const local = host === "localhost" || host === "127.0.0.1";
  return {
    host,
    port: match[2] ? Number(match[2]) : local ? 9000 : 443,
    path: match[3] ?? "/",
    secure: !local && location.protocol === "https:",
  };
}

/** The host's peer id when this page was opened from a join link. */
export function joinTarget(hash = location.hash): string | null {
  const match = /^#join=([\w-]+)$/.exec(hash);
  return match ? (match[1] as string) : null;
}

export function joinLink(peerId: string): string {
  return `${location.origin}${location.pathname}${location.search}#join=${peerId}`;
}

function stored(storage: () => Storage, key: string): string | null {
  try {
    return storage().getItem(key);
  } catch {
    return null;
  }
}

function store(storage: () => Storage, key: string, value: string): void {
  try {
    storage().setItem(key, value);
  } catch {
    // Without storage the player still joins, but a reload makes a new player.
  }
}

/** The player's token for this host, kept by the tab so a reload or reconnection gets the same realm back. */
export function playerToken(hostId: string): string {
  const key = `geonomics.token.${hostId}`;
  const existing = stored(() => sessionStorage, key);
  if (existing) return existing;
  const token = crypto.randomUUID();
  store(() => sessionStorage, key, token);
  return token;
}

/** Whether this tab already joined this host, so a reload joins again without asking. */
export const hasJoined = (hostId: string) => stored(() => sessionStorage, `geonomics.joined.${hostId}`) === "1";
export const markJoined = (hostId: string) => store(() => sessionStorage, `geonomics.joined.${hostId}`, "1");

export const savedName = () => stored(() => localStorage, "geonomics.name") ?? "";
export const saveName = (name: string) => store(() => localStorage, "geonomics.name", name);
