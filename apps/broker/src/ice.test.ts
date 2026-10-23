import { describe, expect, it } from "vitest";
import { CREDENTIAL_TTL_S, iceServers, originAllowed } from "./ice";

const env = { TURN_KEY_ID: "key-1", TURN_KEY_API_TOKEN: "secret" };

function replying(status: number, body: unknown) {
  const calls: { url: string; init: RequestInit | undefined }[] = [];
  const fetcher = (async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    return new Response(JSON.stringify(body), { status });
  }) as typeof fetch;
  return { calls, fetcher };
}

describe("iceServers", () => {
  it("asks Cloudflare for credentials with the key's token and drops port 53", async () => {
    const { calls, fetcher } = replying(201, {
      iceServers: [
        { urls: ["stun:stun.cloudflare.com:3478", "stun:stun.cloudflare.com:53"] },
        {
          urls: ["turn:turn.cloudflare.com:3478?transport=udp", "turn:turn.cloudflare.com:53?transport=udp"],
          username: "u",
          credential: "c",
        },
      ],
    });
    expect(await iceServers(env, fetcher)).toEqual({
      iceServers: [
        { urls: ["stun:stun.cloudflare.com:3478"] },
        { urls: ["turn:turn.cloudflare.com:3478?transport=udp"], username: "u", credential: "c" },
      ],
      ttl: CREDENTIAL_TTL_S,
    });
    expect(calls).toHaveLength(1);
    const [{ url, init }] = calls as [(typeof calls)[number]];
    expect(url).toBe("https://rtc.live.cloudflare.com/v1/turn/keys/key-1/credentials/generate-ice-servers");
    expect(init?.method).toBe("POST");
    expect(init?.headers).toMatchObject({ Authorization: "Bearer secret" });
    expect(JSON.parse(init?.body as string)).toEqual({ ttl: CREDENTIAL_TTL_S });
  });

  it("keeps four of Cloudflare's URLs: STUN, TURN over UDP, TCP and TLS", async () => {
    const { fetcher } = replying(201, {
      iceServers: [
        { urls: ["stun:stun.cloudflare.com:3478", "stun:stun.cloudflare.com:53"] },
        {
          urls: [
            "turn:turn.cloudflare.com:3478?transport=udp",
            "turn:turn.cloudflare.com:3478?transport=tcp",
            "turns:turn.cloudflare.com:5349?transport=tcp",
            "turn:turn.cloudflare.com:53?transport=udp",
            "turn:turn.cloudflare.com:80?transport=tcp",
            "turns:turn.cloudflare.com:443?transport=tcp",
          ],
          username: "u",
          credential: "c",
        },
      ],
    });
    expect((await iceServers(env, fetcher))?.iceServers.map((server) => server.urls)).toEqual([
      ["stun:stun.cloudflare.com:3478"],
      [
        "turn:turn.cloudflare.com:3478?transport=udp",
        "turn:turn.cloudflare.com:3478?transport=tcp",
        "turns:turn.cloudflare.com:443?transport=tcp",
      ],
    ]);
  });

  it("gives nothing without a TURN key or when Cloudflare refuses", async () => {
    const { calls, fetcher } = replying(401, {});
    expect(await iceServers({}, fetcher)).toBeNull();
    expect(calls).toHaveLength(0);
    expect(await iceServers(env, fetcher)).toBeNull();
  });
});

describe("originAllowed", () => {
  const allowed = "https://michelsol.github.io, http://localhost:*";
  it("lets listed pages and any localhost port in, and other pages out", () => {
    expect(originAllowed("https://michelsol.github.io", allowed)).toBe(true);
    expect(originAllowed("http://localhost:4173", allowed)).toBe(true);
    expect(originAllowed("http://localhost.evil.com:80", allowed)).toBe(false);
    expect(originAllowed("https://evil.example", allowed)).toBe(false);
    expect(originAllowed(null, allowed)).toBe(true);
  });
});
