// The PeerServer signaling protocol as PeerJS speaks it (specification §9, Broker): peers register an id over a
// WebSocket, then trade offers, answers and candidates addressed by id. Pure logic, so it runs in tests as in the Worker.

/** A registered peer's socket: its id and token travel with it, as the Durable Object's attachment. */
export interface PeerSocket {
  readonly id: string;
  readonly token: string;
  send(text: string): void;
  close(code?: number, reason?: string): void;
}

export interface ServerMessage {
  type: string;
  payload?: unknown;
  src?: string;
  dst?: string;
}

/** The PeerJS API key every client sends; PeerServer's default. */
export const KEY = "peerjs";
/** Signaling messages carry SDP and candidates, a few kilobytes each. */
export const MAX_MESSAGE = 64 * 1024;
const ID = /^[\w-]{1,64}$/;
const FORWARDED = new Set(["OFFER", "ANSWER", "CANDIDATE", "LEAVE", "EXPIRE"]);

export const newId = (): string => crypto.randomUUID();

const text = (message: ServerMessage) => JSON.stringify(message);
const error = (msg: string) => text({ type: "ERROR", payload: { msg } });

export type Admission =
  | { ok: true; id: string; token: string; replaces: readonly PeerSocket[] }
  | { ok: false; reply: string };

/**
 * Decides on a new WebSocket from its query parameters and the sockets already holding the requested id. The same
 * token takes the id over (a reconnecting peer); another token is told the id is taken.
 */
export function admit(params: URLSearchParams, holders: readonly PeerSocket[]): Admission {
  const id = params.get("id");
  const token = params.get("token");
  const key = params.get("key");
  if (!id || !token || !key) return { ok: false, reply: error("No id, token, or key supplied to websocket server") };
  if (key !== KEY) return { ok: false, reply: error("Invalid key provided") };
  if (!ID.test(id) || token.length > 64) return { ok: false, reply: error("Invalid id or token") };
  if (holders.some((holder) => holder.token !== token))
    return { ok: false, reply: text({ type: "ID-TAKEN", payload: { msg: "ID is taken" } }) };
  return { ok: true, id, token, replaces: holders };
}

export const OPEN = text({ type: "OPEN" });

/**
 * Handles one message from `from`, given a lookup of the sockets registered under an id. The sender's id always
 * replaces `src`, so no peer can speak for another. Nothing is queued: an offer to an absent peer expires at once.
 */
export function route(from: PeerSocket, raw: string | ArrayBuffer, find: (id: string) => readonly PeerSocket[]): void {
  if (typeof raw !== "string" || raw.length > MAX_MESSAGE) return;
  let message: ServerMessage;
  try {
    message = JSON.parse(raw);
  } catch {
    return;
  }
  if (typeof message !== "object" || message === null || !FORWARDED.has(message.type)) return; // HEARTBEAT, junk
  const dst = typeof message.dst === "string" ? message.dst : undefined;
  if (!dst) {
    if (message.type === "LEAVE") from.close(1000, "leave");
    return;
  }
  const targets = find(dst);
  if (targets.length === 0) {
    if (message.type === "OFFER") from.send(text({ type: "EXPIRE", src: dst, dst: from.id }));
    return;
  }
  const forwarded = text({ type: message.type, src: from.id, dst, payload: message.payload });
  for (const target of targets) target.send(forwarded);
}
