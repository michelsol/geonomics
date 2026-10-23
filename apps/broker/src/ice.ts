// ICE servers for the game's peers (specification §9, Broker): Cloudflare STUN and TURN, with short-lived credentials
// minted here so the TURN key's secret never reaches a browser.

export interface IceEnv {
  TURN_KEY_ID?: string;
  TURN_KEY_API_TOKEN?: string;
}

/** Credentials outlast the longest expected session; a new peer fetches fresh ones. */
export const CREDENTIAL_TTL_S = 24 * 60 * 60;

export interface IceServer {
  urls: string | string[];
  username?: string;
  credential?: string;
}

/** Browsers block port 53, so those URLs would only time out. */
const usable = (url: string) => !/:53(\?|$)/.test(url);

function withoutPort53(server: IceServer): IceServer | null {
  const urls = (Array.isArray(server.urls) ? server.urls : [server.urls]).filter(usable);
  return urls.length > 0 ? { ...server, urls } : null;
}

/** The ICE servers and their lifetime, or null when the TURN key is not configured or Cloudflare refuses. */
export async function iceServers(
  env: IceEnv,
  fetcher: typeof fetch = fetch,
): Promise<{ iceServers: IceServer[]; ttl: number } | null> {
  if (!env.TURN_KEY_ID || !env.TURN_KEY_API_TOKEN) return null;
  const response = await fetcher(
    `https://rtc.live.cloudflare.com/v1/turn/keys/${encodeURIComponent(env.TURN_KEY_ID)}/credentials/generate-ice-servers`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${env.TURN_KEY_API_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({ ttl: CREDENTIAL_TTL_S }),
    },
  );
  if (!response.ok) return null;
  const body = (await response.json()) as { iceServers?: IceServer[] };
  const servers = (body.iceServers ?? []).map(withoutPort53).filter((server) => server !== null);
  return servers.length > 0 ? { iceServers: servers, ttl: CREDENTIAL_TTL_S } : null;
}

/**
 * Whether a browser page from `origin` may use the broker. `allowed` is a comma-separated list; an entry may end in
 * `:*` for any port (local development). Requests without an Origin (not from a page) pass: they are not browsers
 * spending the quota on another site's behalf, and the check could not stop them anyway.
 */
export function originAllowed(origin: string | null, allowed: string): boolean {
  if (origin === null) return true;
  return allowed
    .split(",")
    .map((entry) => entry.trim())
    .some(
      (entry) =>
        entry === "*" || entry === origin || (entry.endsWith(":*") && origin.startsWith(`${entry.slice(0, -2)}:`)),
    );
}
