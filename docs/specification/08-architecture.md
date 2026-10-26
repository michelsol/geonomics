[Specification](README.md) · section 8 of 10

## 8. Architecture and stack

Everything is TypeScript and runs in the browser. The host's browser runs the simulation in a Web Worker; joining players connect through PeerJS, send commands and draw the snapshots they receive.

&#91;embedded content: architecture · host browser, joining players, signaling\]

Only the host simulates. The signaling broker is used only to set up connections; game traffic then flows directly between browsers, or through a TURN relay when their networks keep them from reaching each other.

### Stack

| Concern | Choice | Notes |
| --- | --- | --- |
| Language | TypeScript, strict mode | One language for simulation, networking and interface |
| Build | Vite, pnpm workspaces | Fast development server, static output |
| Interface | React | Panels, lobby, policy and order editors |
| Interface state | Zustand | Store fed by snapshots, read by React and the map |
| Map | PixiJS (WebGL 2D) | Driven imperatively from one React component |
| Charts | uPlot | Fast long time series for prices and populations |
| Networking | PeerJS | WebRTC data channels in reliable mode |
| Serialization | @msgpack/msgpack | Binary messages and save files; typed arrays sent as Float32 |
| Tests | Vitest | Unit tests and convergence scenarios |
| End-to-end tests | Playwright | Real browsers, including two-browser multiplayer sessions |
| Lint and format | Biome | One tool for both; independent of the TypeScript version |
| Headless runs | Node with tsx | Balance testing without a browser |
| Distribution | Static hosting, PWA (vite-plugin-pwa) | GitHub Pages, Netlify or Cloudflare Pages; installable on phones |

### Packages

- `packages/sim`: data model, config, tick, commands, AI, map generation, save format. No browser or network dependency.
- `packages/net`: PeerJS host and client wrappers, message types, snapshot encoding.
- `apps/web`: React application, PixiJS map, panels, and the simulation worker entry point.
- `tools/headless`: Node runner, diagnostics and convergence scenarios.

### Host loop

The worker runs a timer loop targeting `1000 / maxTicksPerSecond` milliseconds per tick. Each iteration drains the command queue, runs one tick and, at the snapshot rate, builds one snapshot per viewer: the local player's goes to the main thread using transferable buffers, and each joined player's or spectator's is packed (see Encoding) for the main thread to forward. When a tick takes longer than its budget, the loop runs as fast as it can and still yields between ticks. The loop exists from map creation, paused, so players can join while the host chooses its realm.

The main thread forwards local and remote commands to the worker, updates its own store from the local snapshots, and forwards the packed ones to their players. Pause and speed changes are messages to the worker, never simulation commands.

### Messages

From a joining player to the host:

| Message | Content |
| --- | --- |
| `hello` | Protocol version, player name, player token |
| `choose` | A government to take, or none to watch as a spectator |
| `command` | One command; the host acts for the government the player holds |
| `setFlowGood` | The good whose trade flows the player's snapshots carry, or none |
| `focus` | The area the player looks at: its detail comes in every snapshot |
| `leave` | The player leaves for good, freeing its realm |

From the host to a joining player:

| Message | Content |
| --- | --- |
| `welcome` | The player's lobby entry, the static data and the government summaries |
| `refused` | Why the host turned the player away (another protocol version, an invalid token, no game yet) |
| `lobby` | Every player: name, role (choosing, player or spectator), government held, online, host; whether the game started |
| `you` | The player's own entry, when its role changes |
| `notice` | A refused choice, or news from the host |
| `snapshot` | Dynamic state for the player's government (below) |
| `priceTable` | Prices of every good in every area (below) |
| `commandRejected` | The rejected command and the reason |
| `hostStatus` | Paused, the host's tab hidden, speed, ticks per second, milliseconds per tick, tick |

### Encoding

- Messages are msgpack. Typed arrays travel as msgpack extensions holding their little-endian bytes; a `Float32Array` with fewer than a quarter of its entries nonzero travels sparse, as index and value pairs.
- Each message is then compressed with raw deflate and cut into frames of at most 64 KiB, each with a 9-byte header (frame format version, message id, frame index, frame count). Data channels are reliable and ordered, so frames are joined in order.
- Snapshots for joined players are built and packed in the simulation worker; the price table is packed once for all of them.
- **Flow control:** when a player's channel holds more than 1 MiB not yet sent, its snapshots and price tables are skipped until it drains.

### Snapshots

The host broadcasts snapshots at `snapshotRate` (default 3 per second), independent of the tick rate. A snapshot contains:

- `tick` and `gameDay`.
- Per area, for every area: owner, population, its births and deaths of the last tick per game day, each consumer group's share of the people and of its necessities met, average wage, gross and net income per member of the workforce and day (section 9, Income; NaN for an empty area), employment rate (the share of the workforce, `population × workforceShare`, not unemployed), satisfaction, port, airport, road and fortification levels and the staffed share of each, siege progress and besieger, and militia.
- The receiving player's **visible areas**, its owned areas and their direct neighbors, and for them savings, unemployed workers, and the price, stock, produced, consumed, imported, exported, private worker and natural capacity arrays, the wage of each private job per worker-day, and per need the need units demanded and consumed. Other areas' stocks and flows are not sent. A joined player receives this detail in turns: each snapshot carries its focused area and the next 48 visible areas, and its interface keeps the last detail of each visible area. The local player receives all of it every time.
- The static data sent once at the start also carries every area's maximum natural capacity per good, its land alone, and every water cell with its position, depth, neighbors, coasts and maximum natural capacity per good. The interface computes the ports' reach from these and the public port levels, as the simulation does. An area's natural capacity in the detail is its extraction capacity, land and staffed waters.
- Per edge: transport cost, capacity, active and blocked state, plus the full data of any route edge created since the last snapshot.
- Per edge, the flows of the last tick, in units per game day: net migrants (positive from area A to area B) and tonnes carried in each direction. When the receiver watches one good, also that good's units carried in each direction. Flows are public, like prices.
- All armies, relations and pending peace proposals.
- The receiving player's full government state (treasury, depots, jobs, orders, policy settings); other governments as a public summary. Policies in force are not sent: the receiver resolves them from the realm settings and the area overrides, as the host does.
- A spectator's snapshot has no visible areas and no government.

Typed arrays are sent as `Float32Array`.

### Price table

Prices are public: every client receives the price of every good in every area, whatever it owns. This is the **open prices** principle. The host sends a `priceTable` message at `priceTableRate` (default once per second). The message carries the `tick` and one `Uint16Array` of areas × goods.

To halve the size, each price is quantized on a log scale between the price floor and the price ceiling multiples:

```typescript
q = round(65535 * (ln(price / laborValue) - ln(priceFloorMultiple))
              / (ln(priceCeilingMultiple) - ln(priceFloorMultiple)))
```

With the default bounds, one step is less than 0.01% of the price. With 1,000 areas and 54 goods, the table is about 108 KB. Clients build their own price history from successive tables for the charts. AI governments read the same table and see no more than human players.

The interface uses the table in two places:

- A **price map** colors every area by the price of a chosen good relative to its labor value.
- A **good panel** lists the lowest, median and highest price, each with the area where it occurs, so players can spot trade and arbitrage opportunities at a glance.

### Joining

1. The host clicks Invite players. Its browser creates a PeerJS peer whose id is a random 6-symbol **code** from `abcdefghjkmnpqrstuvwxyz23456789` (no 0, o, 1, l or i; about 900 million codes), trying another code up to five times when the broker says one is taken. It shows the code and the link `https://<site>/#join=<code>`. A player can also type the code (or paste the link) under Join with a code on the new game screen; codes are matched in lowercase, so capitals typed on a phone work. When the host's page has a `?peer=` setting (below), the link keeps it; otherwise the joining page uses the broker it was built with, so pages built with different brokers do not meet.
2. The joining player opens the link and gives a name; its browser opens a reliable data channel to the host and sends `hello`.
3. The host answers `welcome`, and the player appears in the lobby. Players can join before the host starts and during the game.

**Players.** A joining player is identified by a random token its tab keeps in `sessionStorage`. The host sets the controller of the government it takes to `{ kind: "human", player: token }`. Commands act for the government their connection's player holds; the host never takes the player from the message. A player chooses a realm no one else holds and that is not eliminated, or watches as a spectator. Taking another realm gives the previous one back to the AI. Only the host controls time.

**Dropped connections.** A joining player whose connection drops retries after 1, 2, 4 and 8 seconds, then every 8 seconds, and gives up 2 minutes after the drop. A `hello` with the same token, from a reconnection or a reload of the same tab, restores the player's role and realm, and the host sends `welcome` again. While a player is offline, its realm stays reserved for it and the AI runs it by the realm's personality; control returns when the player is back. The host can release the realm, and another player can then take it.

**Broker.** The game's own broker is a Cloudflare Worker (`apps/broker`) speaking the PeerServer protocol, with every peer's WebSocket in one Durable Object. A build setting (`VITE_BROKER_URL`) gives its address; a build without it uses the free PeerJS cloud broker. A `?peer=host:port[/path]` query setting points the game at another broker, such as the Worker run locally (`pnpm broker`, port 8787), which the end-to-end tests and local network play use.

- **Protocol.** `GET /peerjs/id` gives a random id. The WebSocket `/peerjs?key=peerjs&id=&token=` answers `OPEN`, or `ID-TAKEN` when another token holds the id; the same token takes the id over. `OFFER`, `ANSWER`, `CANDIDATE`, `LEAVE` and `EXPIRE` go to the peer named by `dst`, with `src` set to the sender's id. Nothing is queued: an offer to an absent peer is answered at once with `EXPIRE`, and other messages to it are dropped. `HEARTBEAT` is ignored, and messages over 64 KB are dropped.
- **Origins.** Pages from origins outside the Worker's `ALLOWED_ORIGINS` list are refused.
- **ICE servers.** Before creating its peer, each browser asks the broker's `GET /ice` for ICE servers: Cloudflare STUN and TURN, with credentials minted by the Worker from its TURN key and valid for 24 hours, without port 53 URLs. A browser reuses them until an hour before they expire. When the broker has no TURN key, does not answer within 5 seconds, or the broker is the PeerJS cloud, PeerJS's default servers apply: Google's public STUN, without a working relay.
- **Relay check.** `?relay=1` allows relayed connections only, to check that TURN works. It applies to the page it is set on and does not travel in the join link.

### Hosting on mobile

- A host keeps its game running while its tab is hidden: the simulation runs in a worker, which desktop browsers keep running. Phones freeze hidden tabs, so `hostStatus` tells players whether the host's tab is hidden.
- The host requests a Screen Wake Lock while its game runs and its tab is visible, and releases it when paused or hidden.
- A game starts at 1× on phones (devices whose main pointer is coarse) and at 2× elsewhere.
- Closing the host's tab while players are joined asks for confirmation.

### Save and load

- **Format.** A save is the msgpack array `["geonomics-save", version, info, world]`, compressed with gzip. `info` holds the game id, a title (the local player's realm), the game day, the save time, the catalog and the area count, and is read without the world for listings. A file with another first element is refused as not a save, a version above the game's as from a newer version, and a version below it as from an older version that can no longer be loaded (version 2 changed infrastructure). Loading also accepts an uncompressed save.
- **Exactness.** The whole world is saved, bit for bit: typed arrays keep their bytes and type, Maps their entries in order, and every number is written as a float64. A loaded world replays the same commands to the same world hash. Interface history (charts) is not saved.
- **Loading.** Player tokens do not outlive a session: on load, every realm a player held goes back to the AI, and the AI's memory is kept. The game opens paused in the lobby, as a new game does, and players pick their realms again.
- **Autosave.** The host (or solo player) saves the game every 30 game days while it runs, when its tab is hidden (phones may discard hidden tabs) and when the game ends. Saves go to IndexedDB, one slot per game, overwritten each time; the five most recent games are kept. Joined players do not save.
- **Export and load.** The host can export the game as a `.geonomics` file. Anyone can load a saved game or a file from the new game screen and host it, which is how a game continues when the host leaves.

### Offline and install

- The site is a PWA: a web app manifest with icons (192 and 512 px, and a maskable 512 px) makes it installable, and a service worker precaches every file of the build, so the app starts and solo games run without a network once it has loaded. Joining and hosting need the network; requests to the broker are never cached.
- A new version waits: the service worker installs it in the background, and the new game screen offers to reload into it. A running game is never interrupted, since it may still load parts of the app from the version it started with.

### Single player

A solo game uses the same data flow as a hosted one, without the network. The worker posts five kinds of messages to the main thread:

| Message | When | Content |
| --- | --- | --- |
| `progress` | During map generation and warm-up | A stage name and a share done |
| `static` | Once the world is ready | Config, needs, goods, area names, positions and terrain, edges, map layout, governments' names and colors |
| `snapshot` | At `snapshotRate` | As in Snapshots, for the local player's government |
| `priceTable` | At `priceTableRate` | As in Price table |
| `status` | With every snapshot, and on rejections | Running or paused, target and actual ticks per second, milliseconds per tick, and rejected commands with their reasons |

The main thread sends `create`, `load` (a save file) or `loadSaved` (a game id), `start` (with the local player's government, or none to watch, and the starting speed), `save` (autosave now), `export` (answered with `exported`, the save file), `command`, `setSpeed`, `pause`, `resume`, `endGame`, and `setFlowGood` to choose the good whose trade flows snapshots carry (none by default). While paused, `setFlowGood` is answered with a snapshot at once. The local player sends commands under the player id `local`.

When hosting, `command` and `setFlowGood` may name a joined player, `player` sets a joined player's government and whether it receives snapshots, and `focus` names the area it looks at. The worker then also posts `remote` messages, packed for one player or for all of them, and rejections name the player they are for.
