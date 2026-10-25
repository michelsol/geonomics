// Where the signaling broker is, the join link, and what a joining tab remembers (specification §8, Joining).
import type { BrokerOptions } from "@geonomics/net";

/** The game's own broker (apps/broker), set at build time; without it, the PeerJS cloud. */
const BUILT_IN_BROKER: string | undefined = import.meta.env.VITE_BROKER_URL || undefined;

/** PeerJS's own cloud broker, which hands out no ICE servers. */
const CLOUD_HOST = "0.peerjs.com";

const withSlash = (path: string) => (path.endsWith("/") ? path : `${path}/`);

function broker(host: string, port: number, path: string, secure: boolean): BrokerOptions {
  const base = withSlash(path);
  if (host === CLOUD_HOST) return { host, port, path: base, secure };
  // The game's broker hands out ICE servers; a plain PeerServer does not, and PeerJS's defaults apply.
  return { host, port, path: base, secure, ice: `${secure ? "https" : "http"}://${host}:${port}${base}ice` };
}

/**
 * The broker: the game's own one, the PeerJS cloud without it, or `?peer=host:port[/path]` for another one (tests and
 * local play run one), which travels in the join link. `?relay=1` allows relayed connections only, to check TURN.
 */
export function brokerOptions(search = location.search, builtIn = BUILT_IN_BROKER): BrokerOptions {
  const params = new URLSearchParams(search);
  const relay: BrokerOptions = params.get("relay") === "1" ? { relayOnly: true } : {};
  const value = params.get("peer");
  if (value) {
    const match = /^([^:/]+)(?::(\d+))?(\/.*)?$/.exec(value);
    if (!match) return relay;
    const host = match[1] as string;
    const local = host === "localhost" || host === "127.0.0.1";
    const port = match[2] ? Number(match[2]) : local ? 8787 : 443;
    // Brokers on the web answer on 443 with TLS (a Worker, the PeerJS cloud); local ones run plain on their own port.
    return { ...broker(host, port, match[3] ?? "/", port === 443), ...relay };
  }
  if (builtIn) {
    const url = new URL(builtIn);
    const secure = url.protocol === "https:";
    return { ...broker(url.hostname, Number(url.port) || (secure ? 443 : 80), url.pathname, secure), ...relay };
  }
  return relay;
}

/** The host's peer id when this page was opened from a join link. */
export function joinTarget(hash = location.hash): string | null {
  const match = /^#join=([\w-]+)$/.exec(hash);
  return match ? (match[1] as string).toLowerCase() : null; // a phone keyboard may capitalize a typed code
}

/**
 * The link joining this host: `#join=` alone, plus the host's `?peer=` when its page set one (a local broker), since a
 * joining page otherwise uses the broker it was built with.
 */
export function joinLink(
  peerId: string,
  search = location.search,
  page = `${location.origin}${location.pathname}`,
): string {
  const peer = new URLSearchParams(search).get("peer");
  const query = peer ? `?${new URLSearchParams({ peer })}` : "";
  return `${page}${query}#join=${peerId}`;
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
