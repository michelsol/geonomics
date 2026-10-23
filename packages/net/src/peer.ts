// PeerJS links (specification §9, Joining): reliable, ordered data channels carrying raw binary frames.
import { type DataConnection, Peer, type PeerOptions } from "peerjs";
import type { Link } from "./link";

/** Signaling broker settings; empty for the PeerJS cloud broker. */
export interface BrokerOptions {
  host?: string;
  port?: number;
  path?: string;
  secure?: boolean;
}

const CONNECT_TIMEOUT_MS = 15_000;

function linkOf(connection: DataConnection): Link {
  return {
    send: (frame) => {
      void connection.send(frame.buffer.slice(frame.byteOffset, frame.byteOffset + frame.byteLength));
    },
    get bufferedAmount() {
      return connection.dataChannel?.bufferedAmount ?? 0;
    },
    onFrame: (listener) => {
      connection.on("data", (data) => {
        if (data instanceof ArrayBuffer) listener(new Uint8Array(data));
        else if (ArrayBuffer.isView(data)) listener(new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
      });
    },
    onClose: (listener) => {
      let closed = false;
      const once = () => {
        if (closed) return;
        closed = true;
        listener();
      };
      connection.on("close", once);
      connection.on("error", once);
      // A peer that vanishes without closing (a closed laptop) shows as a failed ICE connection.
      connection.peerConnection?.addEventListener("iceconnectionstatechange", () => {
        const state = connection.peerConnection?.iceConnectionState;
        if (state === "failed" || state === "closed") once();
      });
    },
    close: () => connection.close(),
  };
}

function whenOpen(peer: Peer): Promise<string> {
  return new Promise((resolve, reject) => {
    if (peer.open) {
      resolve(peer.id);
      return;
    }
    const timer = setTimeout(() => reject(new Error("the signaling server did not answer")), CONNECT_TIMEOUT_MS);
    peer.once("open", (id) => {
      clearTimeout(timer);
      resolve(id);
    });
    peer.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

export interface HostPeer {
  id: string;
  close(): void;
}

/** Opens the host's peer; every incoming data connection becomes a link once it opens. */
export async function openHost(broker: BrokerOptions, onLink: (link: Link) => void): Promise<HostPeer> {
  const peer = new Peer(broker as PeerOptions);
  const id = await whenOpen(peer);
  peer.on("connection", (connection) => {
    connection.on("open", () => onLink(linkOf(connection)));
  });
  // Losing the signaling server leaves open games running, but new players could not join: reconnect.
  peer.on("disconnected", () => {
    if (!peer.destroyed) setTimeout(() => peer.reconnect(), 1000);
  });
  return { id, close: () => peer.destroy() };
}

/** Creates the joining peer lazily and returns a function opening a new link to the host each time it is called. */
export function connector(hostId: string, broker: BrokerOptions): () => Promise<Link> {
  let peer: Peer | null = null;
  return async () => {
    if (!peer || peer.destroyed) peer = new Peer(broker as PeerOptions);
    else if (peer.disconnected) peer.reconnect();
    await whenOpen(peer);
    const connection = peer.connect(hostId, { reliable: true, serialization: "raw" });
    return new Promise<Link>((resolve, reject) => {
      const timer = setTimeout(() => {
        connection.close();
        reject(new Error("the host did not answer"));
      }, CONNECT_TIMEOUT_MS);
      connection.once("open", () => {
        clearTimeout(timer);
        resolve(linkOf(connection));
      });
      connection.once("error", (error) => {
        clearTimeout(timer);
        reject(error);
      });
      peer?.once("error", (error) => {
        clearTimeout(timer);
        reject(error);
      });
    });
  };
}
