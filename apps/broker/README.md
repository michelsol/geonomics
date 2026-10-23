# Geonomics broker

A Cloudflare Worker that does two jobs for multiplayer games (specification §9, Broker):

- **Signaling:** it speaks the PeerServer protocol, so browsers find each other by peer id.
- **ICE servers:** it hands out Cloudflare STUN and TURN servers, with short-lived credentials, so players on strict networks connect through a relay.

Everything fits Cloudflare's free plan for a small game.

## Run it locally

```sh
pnpm broker   # wrangler dev on port 8787, reachable from the local network
pnpm dev      # the game, in another terminal
```

Open the game with `?peer=localhost:8787`, or `?peer=<this machine's address>:8787` from another device. Without a TURN key, `/ice` answers 503 and browsers use PeerJS's defaults: Google's public STUN, and no working relay (PeerJS's public TURN servers no longer resolve), so `?relay=1` cannot connect.

To try TURN locally, put the two secrets below in `apps/broker/.dev.vars` (ignored by git):

```sh
TURN_KEY_ID=...
TURN_KEY_API_TOKEN=...
```

## Deploy

1. **Create a TURN key.** In the Cloudflare dashboard, go to Realtime → TURN Server and create a key. Note its **Turn Token ID** and **API Token**.
2. **Log in:** `pnpm --filter @geonomics/broker exec wrangler login`.
3. **Set the secrets:**

   ```sh
   pnpm --filter @geonomics/broker exec wrangler secret put TURN_KEY_ID
   pnpm --filter @geonomics/broker exec wrangler secret put TURN_KEY_API_TOKEN
   ```

4. **Check the allowed origins.** `ALLOWED_ORIGINS` in [wrangler.jsonc](wrangler.jsonc) lists the pages that may use the broker. Add your GitHub Pages origin, or a custom domain, if it differs.
5. **Deploy:** `pnpm --filter @geonomics/broker run deploy`. Wrangler prints the Worker's URL, such as `https://geonomics-broker.<account>.workers.dev`.
6. **Point the game at it.** In the GitHub repository, go to Settings → Secrets and variables → Actions → Variables. Add `BROKER_URL` with the Worker's URL, then rerun the Pages workflow. Builds without the variable keep using the PeerJS cloud.
7. **Check the relay.** Open the game with `?relay=1`, host a game, and join from another network, such as a phone on mobile data. `?relay=1` allows relayed connections only, so joining at all shows TURN works. In Chrome, `chrome://webrtc-internals` shows the selected candidate pair as `relay`.

To check the Worker by hand:

- `curl -H "Origin: https://<your pages origin>" https://<worker>/ice` should list `turn:turn.cloudflare.com` URLs with a username and credential.
- `curl https://<worker>/peerjs/id` should answer a random id.

## Costs and limits

- **Signaling:** every peer's WebSocket lives in one Durable Object, which hibernates between messages. Each connected peer sends a heartbeat every 5 seconds, about 860 billed requests a day, against the free plan's 100,000.
- **TURN:** only connections that cannot go direct use the relay; Cloudflare's dashboard shows the traffic.
- **Abuse:** the origin check stops other sites from using the broker from their pages, but a script can still fetch credentials. If the quota is ever abused, revoke the TURN key in the dashboard and create a new one.
