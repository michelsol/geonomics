// The game's broker on Cloudflare (specification §8, Broker): PeerJS signaling in a Durable Object, and ICE servers.
import { DurableObject } from "cloudflare:workers";
import { iceServers, originAllowed } from "./ice";
import { admit, KEY, newId, OPEN, type PeerSocket, route } from "./switchboard";

interface Attachment {
  id: string;
  token: string;
}

function cors(request: Request, env: Env): Record<string, string> {
  const origin = request.headers.get("Origin");
  return origin && originAllowed(origin, env.ALLOWED_ORIGINS)
    ? { "Access-Control-Allow-Origin": origin, Vary: "Origin" }
    : {};
}

export default {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url);
    const headers = cors(request, env);
    if (!originAllowed(request.headers.get("Origin"), env.ALLOWED_ORIGINS))
      return new Response("origin not allowed", { status: 403 });
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers });
    switch (url.pathname) {
      case "/":
        return Response.json(
          { name: "Geonomics broker", description: "PeerJS signaling and ICE servers" },
          { headers },
        );
      case `/${KEY}/id`:
        return new Response(newId(), { headers: { ...headers, "Content-Type": "text/html" } });
      case "/ice": {
        const servers = await iceServers(env);
        return servers
          ? Response.json(servers, { headers: { ...headers, "Cache-Control": "no-store" } })
          : new Response("no TURN key configured", { status: 503, headers });
      }
      case `/${KEY}`:
        if (request.headers.get("Upgrade") !== "websocket")
          return new Response("expected a WebSocket", { status: 426 });
        // Every peer meets in one object: a host and its players must reach each other by id.
        return env.BROKER.get(env.BROKER.idFromName("broker")).fetch(request);
      default:
        return new Response("not found", { status: 404, headers });
    }
  },
} satisfies ExportedHandler<Env>;

/** Holds every peer's WebSocket, hibernating between messages; each socket is tagged with its peer id. */
export class Broker extends DurableObject<Env> {
  override async fetch(request: Request): Promise<Response> {
    const params = new URL(request.url).searchParams;
    const id = params.get("id") ?? "";
    const { 0: client, 1: server } = new WebSocketPair();
    const admission = admit(params, id ? this.peers(id) : []);
    if (!admission.ok) {
      server.accept();
      server.send(admission.reply);
      server.close(1008, "refused");
      return new Response(null, { status: 101, webSocket: client });
    }
    for (const old of admission.replaces) old.close(1000, "replaced");
    this.ctx.acceptWebSocket(server, [admission.id]);
    server.serializeAttachment({ id: admission.id, token: admission.token } satisfies Attachment);
    server.send(OPEN);
    return new Response(null, { status: 101, webSocket: client });
  }

  override webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): void {
    route(this.peer(ws), message, (id) => this.peers(id));
  }

  override webSocketClose(ws: WebSocket, code: number): void {
    try {
      ws.close(code === 1005 ? 1000 : code, "closed");
    } catch {
      // already closed
    }
  }

  private peer(ws: WebSocket): PeerSocket {
    const { id, token } = ws.deserializeAttachment() as Attachment;
    return {
      id,
      token,
      send: (text) => {
        try {
          ws.send(text);
        } catch {
          // the peer is gone; its close event follows
        }
      },
      close: (code, reason) => ws.close(code, reason),
    };
  }

  private peers(id: string): PeerSocket[] {
    return this.ctx
      .getWebSockets(id)
      .filter((ws) => ws.readyState === WebSocket.OPEN)
      .map((ws) => this.peer(ws));
  }
}
