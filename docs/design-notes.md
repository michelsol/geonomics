# Design notes

Rationale and findings behind the rules in the [specification](specification/README.md). The specification says what the simulation does; this file says why, and what was tried before.

## Economy stability

The first rules for prices, trade and labor made the economy swing from price floor to price ceiling, stall trade, and slowly run out of money. The headless runner and a one-good toy model of the loops pointed to four traps.

### Two integrators in a loop

The first price rule moved the price by an amount proportional to the stock gap every tick, so the price integrated scarcity. Labor moved toward jobs while their value added stayed high, so it integrated the price. Two integrators in a feedback loop oscillate however slowly each one moves: in a linear model of stock, price and labor, the characteristic polynomial only becomes stable with a flow term weighted above `1 / (laborMobility × reserveDays)`, about 6 for durable goods and 30 for perishables, which in turn makes trade stiff.

The fix splits the price in two. `smoothedPrice` is the long-run price: it drifts up for as long as a good stays scarce, and jobs follow it. `price` is the market price: the long-run price times a premium proportional to the current scarcity, which trade and consumers see. With the defaults the market price sits at most 10% above or below the long-run price, and the long-run price drifts by up to about 0.7% a day, so it takes weeks for a good to become several times dearer, which leaves labor and trade time to answer.

### Instant trade overshoots

With daily ticks and reserves of one to five days, any flow that reacts at once to the price gap with the sensitivity needed for small steady gaps empties one market into the next and back. Two neighbors with almost equal prices then exchanged half their stock every day in alternating directions (a period-2 cycle visible as an oscillation count of 29 in 30 days).

Each edge therefore keeps a shipping rate per good and direction that moves toward its target with a half-life of about 3 days. The target scales with the buyer's reserve, not its daily use: the loop gain then no longer depends on how many days a good is kept, so bread (one day) is damped as much as tools (five days). In exchange perishable goods need a wider gap to travel: a buyer importing all it uses settles at `1 / (reserveDays × tradeGapSensitivity)` above transport, 1% for durables and 5% for one-day goods.

Including what the buyer re-exports in its import target was tried, so goods would pass through chains with smaller gaps. Even with smoothed rates it fed back on itself and brought the oscillations back, so long transit chains run a steeper gradient than transport cost alone.

### Reserves block exports

The first trade rule only exported stock above the seller's own reserve, and the seller's price only reacted to local demand. An area rich in fish therefore never produced more than its own needs, its neighbor starved, and nothing told the exporter. Exporters now dip into their reserve down to `exportReserveShare` of it, and count their exports (at the smoothed shipping rates, not this tick's noisy deliveries) in their stock target and their labor plan.

Spillover consumption had the same blind spot: an area eating fish in place of missing bread planned labor for its usual fish demand only. Total demand now uses `max(demanded, consumed)`.

### Labor that follows demand

A soft choice of jobs weighted only by value added splits workers evenly between all producible goods when value added is equal, whatever the demand for each. With 54 goods prices had to deviate far from labor value to correct it. A replicator rule (weights proportional to current workers) fixed that but is a pure integrator and oscillated against the price.

Labor now aims at the workers needed to meet demand, exports and the stock gap, tilted by value added against a reservation wage. The quantity part answers demand directly; the tilt makes every produced good settle where it adds about the reservation wage, so primary goods with scarce capacity earn a rent. Because labor reads quantities first, it can run at the pace of the smoothed price (10-day half-life) without chasing it; the original 20-day half-life converged noticeably slower with the large catalog.

The reservation wage also absorbs the surplus labor that the calibration rule leaves (about a quarter of the workforce). With an unemployment value of 0 and a temperature proportional to the average wage, unemployment could never become attractive and prices deflated toward the floor.

### Money leaks

Transport was paid to nobody, so every long-distance purchase destroyed money. A world without governments has no source of money, and remote areas went broke and starved. Transport is now paid to the exporting area, whose carriers do the work, so trade between neutral areas conserves money.

A reservation wage fixed at one man-hour per hour then kept resource-poor areas from ever exporting: they paid for imported inputs, priced their goods like everyone else and drained their savings. The reservation wage now follows the same savings factor as purchasing power, so a deficit area accepts less, undercuts its neighbors and earns its money back, while a rich area asks more and imports more.

### Smaller choices

- The marginal output of a crafted good scales with its input ration instead of dropping to zero when the ration falls below 1, which made value added flip on and off.
- Satisfaction values each need at its reference unit price, because needs are measured in different units.
- The diagnostic oscillation count ignores daily moves under 0.1%, which are noise.
- The air-only island scenario with the large catalog leaves about 40% of necessities unmet: shelter needs cement, stone and timber, which cannot fly. That is the scenario working as intended.

## Map generation

### Shape

The first maps were one round continent with a mountain core, because hills and mountains were ranked by the elevation that includes the edge falloff. They are now ranked by the noise alone, and a weaker falloff with smaller features gives several landmasses and islands. Filling lakes and sinking islets moved the land count by about 10%, so the sea level is corrected until the count is within 1% of the target.

### Resources must be labor-feasible

Placing primary goods by abundance alone starved most of the map. Coal in the medium catalog takes about 7% of all labor at reference demand (fish in the small catalog about 12%); as a regional good on hills and mountains it ended up in about a tenth of the areas, which would have needed more than their whole workforce to supply the world. Coal sold at the price ceiling, its holders earned an average wage near 6, money drained toward them, and the rest of the map went broke and hungry.

The fix has three parts:

- Producing areas are added, in noise order, until their population could supply world demand with `extractionLaborShare` (10%) of its labor, on top of the abundance share.
- Capacity is weighted by population, so big deposits sit where the workers are.
- Staple and energy goods suit more terrains (grain on plains, hills and forest; coal under plains and forest too; cotton in deserts), and every area holds at least one primary good, so none has nothing to work on or to sell.

### Money traps

An area with no savings can buy no inputs, so it produces nothing and earns nothing back. Widening the savings factor range from 0.25–4 to 0.05–16 lets broke areas accept much lower wages and rich ones ask much more, and money spreads more evenly; it does not fully remove the trap. After warm-up, unmet necessities are 2–4% depending on the catalog. Over the following years the share of hungry areas keeps falling as people migrate, but mountain and desert areas far from coal stay poorest, and with the large catalog shelter shortages grow in some inland areas. These are the main candidates for tuning once governments can intervene.

### Warm-up

Generated areas start with reserves of one to five days and must build trade first, so the first weeks are a famine in many areas. Warm-up therefore freezes population instead of boosting demography: the economy finds its balance before anyone can starve.

### Performance

A 3,000-area map (about 3,300 areas and 11,000 edges) with the large catalog runs about 50 ms per tick on the development machine, against a budget of 30 ms. Trade takes about 40% of the tick: there are about 600,000 edge-good pairs and around 80,000 actual shipments per tick. The other phases cost about 2 µs per area each, evenly, and scale linearly with the area count, so they are not memory-bound.

What helped:

- Trade loops working on typed arrays with idle pairs skipped early.
- Tariffs computed only across borders.
- Per-good constants and each area's use cached once per tick.
- A 1% trade margin, below which neighbors do not trade, which halved the active pairs and removed small back-and-forth shipments.

Micro-optimizations of the per-area phases (fewer `pow` calls, hoisted lookups) made no measurable difference. Reaching the budget needs a structural change: fusing the per-area phases into fewer passes, or splitting areas between worker threads in the host loop. The default 1,000-area map runs in about 15 ms.

## Government

### Government purchases must count as demand

The first version followed the specification literally: a buy order takes only the stock above the area's reserve, and nothing else changes. In a balanced area the stock sits at its reserve, so a government could buy only in a glut: `keepDepotStock` never filled its depot. Producers never saw the government's demand, so they never grew to supply it. What a government tries to buy is now recorded as `governmentDemanded` and counted in total demand, so it raises the price target and the labor plan like any customer. The purchase itself still stops at the inhabitants' reserve. A standing order keeping three days of grain then fills its depot in about two months on the small catalog.

### Money stays conserved

Depot transfers originally paid their transport into nothing. It now goes to the source area's carriers, as in private trade, so money only moves between savings and treasuries. A unit test checks this under taxes, tariffs, subsidies, wages, market orders and transfers together. Transfers were later removed (see Panels and map layers).

### How fast policies bite

The economy reacts slowly, by design (specification §3):

- A head tax of 1 man-hour per person per day (a quarter of income) halves the taxed area's savings in about 150 days, against an untaxed control. Its imports fall by over 15%.
- After grain capacity triples, the grain price falls about 20% in 100 days. When capacity drops to 40%, it rises about 60% over the next 100 days.

A government that buys in the glut and sells in the famine makes a clear profit. The windows for it are measured in months, not days.

### Cost

Founded realms send their areas through the government code paths: the policy lookups, taxes, the market phase and depot spoilage. On the default 1,000-area map this adds about 7% to the tick (5.2 ms against 4.8 ms with the medium catalog). The economic diagnostics of every scenario are unchanged when no government acts.

## War and conquest

### Attacking armies hold what they attack

At first, an army in attack stance stopped on entering an area it attacked, but set out again on the next tick, so it walked through enemy land without besieging anything. An attacking army now stays in an area until it falls or the war ends, then follows the rest of its path. A march order in attack stance is therefore a campaign: each area on the way is taken in turn. Armies in hold stance pass through.

### The §6 example

On the small catalog, 1,000 equipped soldiers attacking a neutral area of 10,000 people:
- defeat its 200 militia in about 3 days;
- then besiege it for about 20 days;
- capture it 23 days after arriving.

The siege runs a little slower than its nominal rate because weapons wear (equipment falls about 10%). The area slowly starves meanwhile, because a siege blocks its edges and cuts off its grain imports.

### Treaties settle at the end

Peace transfers are applied one by one, so a treaty that swaps areas could briefly leave a side with none, and eliminate it before it received its new area. Capital moves and eliminations are therefore settled once all of a treaty's transfers are done.

### Militia defends every area

Every area now has a militia of 2% of its population, beside its owner's armies. Before playtesting, only neutral areas used it, and owned areas without armies fell to a siege at once. Now taking an area of 10,000 people means first beating 200 unequipped militia, so more than 100 equipped soldiers. In the headless realm war, 800 equipped soldiers no longer take two areas within 60 days; the test now allows 90.

### Soldiers and the workforce

Recruits leave both the workforce and the population. Since the workforce is `population × workforceShare`, a realm at war holds slightly fewer workers than its population implies; disbanding restores it. The labor phase only counts workers it actually holds, so this never creates or loses anyone.

## Web app

### Rendering

The map is one PixiJS scene of cached geometry: a graphics object each for the cells, the cell and realm borders, the routes, the markers and the selection. Each one is redrawn only when its inputs change:
- the cells when the layer, the owners, the snapshot or the price table changes;
- the borders when owners change;
- the routes when edge flags change;
- the lines after zooming by more than 25%, so they keep their screen width.

The scene renders on demand, not every frame, so an idle map costs nothing. Picking uses `Delaunay.find` on map coordinates instead of Pixi hit areas.

On the development machine, a 3,000-area map with the large catalog keeps about 59 frames per second while the map is dragged and the simulation runs. The worker meanwhile takes about 65 ms per tick in the browser, against about 50 ms in Node. Because the simulation is off the main thread, the slow tick only caps the top speed of large maps (about 15 ticks per second); it never affects the interface. The default 1,000-area map ticks in about 5 ms with the medium catalog.

### Commands while paused

The host applies a command at once when the game is paused, instead of queueing it for the next tick, and sends a snapshot back. Nothing else happens between the pause and the next tick, so the result is the same as applying it in phase 0, and the player sees policy changes immediately.

### Price history

The client keeps 365 samples per chart, built from successive price tables:
- for each good, the world's lowest, median and highest price;
- every good's price in the areas shown in detail and in any area the player has selected.

Keeping whole tables would cost about 117 MB at 3,000 areas × 54 goods. An area's history therefore starts when the player first looks at it.

### Phone layout

The panels sit in a bottom sheet over the full-screen map, with peek, half and full heights. The top bar scrolls sideways instead of wrapping, so the map keeps its height. Touch targets are 44 px. One finger pans, two fingers pinch-zoom and pan, and a tap that moves less than 6 px selects an area.


## First playtest feedback

### Why weapons were never made

Weapons satisfy no need and go into no recipe, so private producers only make them when a government buys them: a purchase counts as demand (`governmentDemanded`) and labor follows it. Standing orders could not create that demand. They were paced at a share of the area's private demand or production, both zero for weapons, so a `buyBelowPrice` rule never traded. Pacing now also follows the trade's own size. Measured on 300-area maps after warm-up, a standing order for 500 weapons at twice their labor value fills the depot in 20 to 30 days on the medium and large catalogs. The headless war test checks it on the medium catalog.

### Armies without food

Food made armies hard to run: loading supplies, standing orders per depot, foraging abroad. Soldiers now cost only their wage, and the wage sets their loyalty with the same rule as government workers. Measured realm average wages after warm-up range from about 0.3 to 1.5 man-hours per hour (small catalog extremes, around 0.9 on the medium catalog), so the default soldier wage is 1.5. Armies keep weapons, taken from the local depot automatically, because equipment is what doubles their power.

### What it takes to conquer an area

Combat follows Lanchester's square law. With `A` attackers of power `a` each and `D` defenders of power `d` each, attackers lose `k·d·D/a` per day and defenders `k·a·A/d`. Then `(a/d)·A² − (d/a)·D²` stays constant, so the attackers win exactly when `a·A > d·D`: when their total power beats the defense power. Fortifications multiply the defense power. The Area panel turns this into "more than N equipped soldiers" (power 2 each) and adds the siege time once the defenders fall, from `siegeRatePerDay × power / ((1 + fortification) × population)`.

### Charts

The realm history used a second y axis for population. Treasury and population are now separate small charts, one measure each: two scales on one chart invite reading the crossing of the lines as meaningful. Employment is a part-to-whole, shown as one stacked bar (private, government, unemployed) with a legend, and the jobs by good as a table with inline bars rather than a pie, so a dozen goods stay readable.

Population and average-wage charts per area were tried and removed after playtesting: the Area panel reads better as a snapshot of the present, with history left to the Realm and Good panels.

## Flow layers

### What the arrows show

Migration and transport arrows show what moved in the last tick, scaled to a day, not a smoothed rate. Trade adjusts gradually and migration follows slow differences in attractiveness, so they hardly flicker. Snapshots always carry the per-edge migrants and tonnes (12 bytes per edge, about 100 KB per snapshot on a 3,000-area map). A table for every good would add 8 bytes per edge and good, about 4 MB per snapshot with the large catalog at 3 per second, so only the good the player watches on the Transport layer is sent.

### Drawing cost

On a 3,000-area map with the large catalog, about 8,000 directions carry trade. Pixi v8 builds geometry when it renders, and stroking 8,000 outlined arrows took about 100 ms per redraw, three times a second. That saturated the main thread, and a map drag slowed to a crawl. Drawing the outline as a slightly larger dark arrow under each one (fills tessellate much faster than strokes), keeping the 2,500 largest flows and skipping arrows with less than 14 px of room brought most redraws under 20 ms. Dragging the map with the Transport layer on stays at about 52 fps, against about 58 fps on the realm layer.



## A fully claimed map

Every area starts in a realm: the realms split the map by distance to the nearest capital over land and sea, and the player picks the number of realms. On 300-, 1,000- and 3,000-area maps with 8 and 32 realms (medium catalog, seed 1), no area is left unowned and no two realms touching over land share a color. Realm sizes:

| Map | Realms | Smallest | Median | Largest |
| --- | --- | --- | --- | --- |
| 300 | 8 | 20 | 36 | 69 |
| 300 | 32 | 3 | 9 | 21 |
| 1,000 | 8 | 78 | 132 | 193 |
| 1,000 | 32 | 13 | 31 | 49 |
| 3,000 | 8 | 93 | 462 | 624 |
| 3,000 | 32 | 40 | 94 | 170 |

Capital placement scored an area no capital reached (an island) as infinitely far, so every island tied for the next capital and the first one in id order won. Such areas now count one hop beyond the farthest reachable area: islands still come early, ranked by population.

The flows moved to their own dropdown so they can be read against any area layer, such as migration over population or trade over prices. Arrows keep their dark outline, so the dimmed realm colors under them were dropped.

## Multiplayer

### Snapshot sizes

Measured on the default 1,000-area map with the large catalog and 8 realms (seed 1), for the largest realm (193 areas, 233 visible):

| Step | Snapshot | Price table |
| --- | --- | --- |
| msgpack with typed arrays, sparse floats included | 856 KB | 106 KB |
| without the resolved policies (7 per-good arrays per owned area, 270 KB) | 584 KB | |
| deflated | 256 KB | 89 KB |
| detail in turns: the focused area and 48 visible areas per snapshot | 103 KB | 89 KB |

The budget is a snapshot plus the price table under 300 KB: 192 KB with the last step, against 345 KB without it. A spectator's snapshot is 57 KB. Area detail (prices, stocks and flows of 54 goods in each visible area) is most of a large realm's snapshot and compresses poorly, since its floats change every tick. Sent in turns at 3 snapshots per second, every visible area is refreshed within about 1.6 seconds, and the area the player looks at in every snapshot. The `net` size test checks the budget.

### Ordering and flow control

Packing is asynchronous (the deflate streams), so each link sends through a promise chain, and the worker chains each viewer's snapshots, so messages leave in the order they were made. Data channels are reliable and ordered, and frames of one message never interleave with another's. A player whose channel backs up beyond 1 MiB loses snapshots rather than piling them up: the next one carries the whole state anyway.

### Who commands

The host builds every command's envelope from the connection the command arrived on: the player token identifies the government, and a message cannot claim to act for someone else. The sim's validation then applies as for any player, so a joined player commanding another realm's area is rejected with the usual reason, routed back to that player only.

### Testing the network

The tests never touch the PeerJS cloud or Cloudflare. The session logic runs in Node over in-memory link pairs. The two-browser Playwright test uses the game's broker, which Playwright starts with `wrangler dev` on port 8787, with `?peer=localhost:8787` in the URL; browser contexts on one machine connect over host candidates, without STUN. The local broker has no TURN key, so its `/ice` answers 503 and the test also runs the fallback to PeerJS's default servers. TURN itself is only checked against the deployed broker, with `?relay=1` (apps/broker/README.md).

## The broker and TURN relay

Two browsers behind strict networks (symmetric NATs, firewalls letting only web traffic out, some mobile carriers) cannot reach each other directly, and need a TURN server relaying their traffic. The game is a static site, so the relay comes from a provider. PeerJS's default configuration lists public TURN servers (`eu-0` and `us-0.turn.peerjs.com`, with fixed credentials), but on 2026-10-23 their names no longer resolved, so without the broker's TURN there is no relay at all; a relay-only connection over those defaults fails at the host lookup.

### Why Cloudflare

- **TURN.** Cloudflare Realtime TURN has a free monthly allowance that a hobby game will not exhaust, and serves from Cloudflare's network, near most players. Its credentials are minted with an API token that must stay on a server, so the broker's Worker mints them.
- **Signaling.** Since a Worker exists anyway, it takes over signaling from the PeerJS cloud, which is free but has no guarantees. The Worker speaks PeerServer's protocol, so PeerJS in the browser is unchanged. SQLite-backed Durable Objects run on the free plan.

### One Durable Object

A host and its players must reach each other by id, so every peer's WebSocket lives in one Durable Object. One object holds many thousands of WebSockets, far more than this game will have; sharding by id would need cross-object forwarding for no gain.

The object uses the WebSocket Hibernation API: between messages it is evicted from memory and costs nothing, and each socket carries its id and token as its attachment, so routing works after a wake-up (`getWebSockets(id)` by tag). Each PeerJS client sends a heartbeat every 5 seconds, which wakes the object. Billed at 20 WebSocket messages per request, that is about 860 requests per peer per day, against the free plan's 100,000.

### No message queue

PeerServer queues messages to a peer that is not connected and expires them later. In a hibernating object that queue would need storage and alarms. Instead, an offer to an absent peer is answered at once with `EXPIRE`, which PeerJS reports as an unavailable peer; the joining player's session already retries with backoff, so a host whose broker connection blinked is reached on the next try.

### Origins and quota

The Worker refuses pages from other origins, so another site cannot have its visitors' browsers spend the TURN allowance. A script outside a browser can still fake an Origin and fetch credentials: the check limits casual reuse, not determined abuse. If that ever matters, Cloudflare's rate limiting binding or a revocation of the TURN key are the next steps.

### Credential lifetime

Credentials last 24 hours, longer than a game session usually runs. The host's peer keeps the credentials it started with; a joining player brings fresh ones, and its own relay suffices for a connection, so a host running past a day still accepts players on strict networks unless both sides need relaying.

### Firefox and IPv6 loopback

On 2026-10-23, Firefox 158 on Windows gathered no ICE candidates at all, not even host ones, on pages loaded over IPv6 loopback (`http://[::1]:…`, or `localhost` when the server listens only on `::1`, as Vite does by default with Node on Windows). The same page over `127.0.0.1` gathered host and server-reflexive candidates, and so did public pages loaded over IPv4. Every join from Firefox then failed with "ICE failed, your TURN server appears to be broken", whatever the ICE servers. The dev and preview servers therefore listen on `127.0.0.1`. Pages loaded over public IPv6 were not tested: the machine had no IPv6 route.

## AI governments

### Exit runs

`pnpm headless -- --ai <mix> --catalog medium --areas 1000 --realms 8 --days 2000 --seed <n>`: a generated 1,000-area map, the medium catalog, 8 AI realms, the 180-day warm-up, then 2,000 days with nobody but the AI.

| Mix, seed | Realms alive | Population | Trade (t/day) | Wars declared, ended | Longest war | AI ms/tick (max) |
| --- | --- | --- | --- | --- | --- | --- |
| Balanced, 1 | 8/8 | +12.7% | 440k → 404k | 11, 9 | 362 days | 1.11 (5.0) |
| Balanced, 2 | 8/8 | +11.9% | 397k → 392k | 10, 8 | 367 days | 1.13 (6.1) |
| Balanced, 3 | 8/8 | +15.5% | 427k → 381k | 8, 8 | 366 days | 1.09 (5.4) |
| Aggressive, 1 | 8/8 | +8.5% | 440k → 351k | 17, 14 | 368 days | 1.30 (5.9) |
| Aggressive, 2 | 8/8 | +8.6% | 398k → 379k | 20, 17 | 365 days | 1.22 (7.7) |
| Peaceful, 1 | 8/8 | +17.2% | 440k → 401k | 0, 0 | — | 0.99 (4.5) |

These runs are without research, which has since been removed. No AI command was rejected. The tick itself takes about 10 ms, so the AI adds about a tenth.

For comparison, the same map with idle realms grows about 17% over the 2,000 days, and its trade stays about level (440k → 435k t/day). AI realms trade 1–20% less than at the start, most likely because their production taxes lower value added and wars block edges. With research capped at level 5, its productivity gain more than offset this, and trade grew 4–19%.

Conquerors gain areas, mostly from traders and builders, but no realm falls: a conqueror stops once it took a fifth of its enemy, or after a year. The vitest suite runs a shorter version (300 areas, the small catalog, 600 days).

### Tuning, and what it showed

- **Spending the starting treasury.** A first version spent the treasury above its reserve on jobs over two years. The starting treasury is 30 days of the realm's whole private income, so that meant hiring several percent of the workforce. Research then climbed to hundreds of levels and people went hungry. Jobs are now paid from tax income only, up to 1% of the workforce.
- **Research hurts past a few levels.** With idle realms and research fixed at a level for the whole run, the population grew 17% at level 0, 14% at level 10 and not at all at level 40, with necessity satisfaction falling in the larger realms. Higher productivity should never make people hungrier, so this is a fault in the economy, probably in how labor allocation or natural capacity reacts to higher output per worker. It affected human players too. Research was first capped at level 5 for the AI, then removed from the game to keep it simple; it can return once the economy handles higher productivity.
- **Income.** The treasury trend mixes taxes with market trades, so a builder buying for its granaries saw its income as negative and staffed nothing. Income is now the production tax owed on the owned areas' output at their prices.
- **Granaries in every area** cost a builder its treasury in spoiled food; they are now in its five most populous areas.
- **Conquerors.** At 3% of the population, raised at the capital, the army emptied the capital. It is now 1.5%, raised a little at a time in the three most populous areas. Targets across the sea were unreachable for armies without a port, so war targets are land neighbors. Wars never ended while a conqueror kept capturing, until it got a conquest share and a maximum length.
- **Time.** Conquerors ordering dozens of small armies to march made some decisions take 50–75 ms, each order planning a path. Moving at most the eight largest armies per decision brought the worst tick under 10 ms.

### Choices

- **A cap on decisions, not on time.** The host time per tick needs a limit. A wall-clock budget would make the world depend on the device's speed and break replays; a fixed number of decisions per tick (4, each realm every 10 days) keeps the tick deterministic, and the runs above measure what it costs.
- **What the AI reads.** Decisions take a view built by `perceive()`: the same snapshot a player of the realm receives, the static data and the decoded price table. Decision code never receives the world, so the AI cannot see more than a player. Applying the commands is the only place the AI touches the world, through `applyCommand` like any player.
- **Memory in the world.** `Government.aiMemory` is plain data in the world, so a saved game resumes its AI where it was, and the world hash covers it.
- **Offline players.** The AI runs an offline player's realm by its personality rather than leaving it idle, so a player who drops during a war still defends. The realm stays reserved in the lobby, and control returns on reconnect.

## Persistence, PWA and release

### Save sizes

Measured in Node after a 10-day warm-up, 8 realms. The save is written in one go on the worker, between two ticks; gzip runs as a stream after it.

| Areas | Catalog | Save | Gzip | Serialize | Gzip time | Load |
| --- | --- | --- | --- | --- | --- | --- |
| 300 | small | 0.93 MB | 0.22 MB | 13 ms | 8 ms | 11 ms |
| 300 | medium | 1.54 MB | 0.39 MB | 12 ms | 11 ms | 9 ms |
| 300 | large | 4.24 MB | 1.21 MB | 10 ms | 30 ms | 10 ms |
| 1,000 | small | 3.03 MB | 0.67 MB | 26 ms | 22 ms | 21 ms |
| 1,000 | medium | 5.05 MB | 1.23 MB | 28 ms | 35 ms | 21 ms |
| 1,000 | large | 13.93 MB | 3.79 MB | 31 ms | 93 ms | 28 ms |
| 3,000 | small | 8.94 MB | 1.92 MB | 77 ms | 74 ms | 52 ms |
| 3,000 | medium | 14.95 MB | 3.46 MB | 76 ms | 105 ms | 62 ms |
| 3,000 | large | 41.30 MB | 10.59 MB | 108 ms | 270 ms | 66 ms |

At worst an autosave delays one tick by about 0.1 s every 30 game days. Five kept games of the largest kind take about 53 MB of IndexedDB, well within browser quotas.

### Choices

- **The whole world, exactly.** Saving only the inputs (seed, options and command log) and replaying them would be small, but replays take as long as the game and break with any change to the rules. A full world, bit for bit, loads in tens of milliseconds and keeps working across versions as long as the data model does; the format version guards the rest. Every number is written as a float64: msgpack would otherwise turn −0 into 0, which changes the world hash.
- **The tick's scratch buffers.** They live outside the world, so a loaded world starts with fresh ones. The replay test (save mid-war with AI realms, replay 60 ticks of player commands on both worlds) gives the same hash, which confirms that no phase carries scratch state from one tick to the next.
- **Players start over in the lobby.** Player tokens live in one browser tab, so a saved controller would point at nobody. Loading gives every realm to the AI, which already runs offline players' realms, and players pick again.
- **Updates wait.** With an update that takes over at once, the new service worker deletes the old version's cache, and a running game that then opens the Game or PeerJS chunk for the first time would fail to load it. The new version therefore waits for a reload, offered on the menu only.
- **Phones.** The audit at Pixel 7 and iPhone 14 sizes found: fields under 16 px (iOS zooms into them), 40 px tabs and 18 px inline links, a lobby wider than the screen, the map layer and flows hidden past the edge of a sideways-scrolling top bar, and areas centered under the bottom sheet. All are fixed, and an end-to-end test keeps every screen and panel within the phone's width.


## Selecting areas

### From polygons to a brush

Regions were first drawn as polygons: a double tap started one, each tap added a corner, and a tap on the first corner closed it. Players did not find the double tap, and phones had no way to add or remove a single area, since Shift-click needs a keyboard. A brush toggled from a visible button is found at once, and it paints any shape, including thin coastlines and areas scattered across the map. While it is on, one finger paints, so the map moves with two fingers, the wheel, or a right-button drag.

A stroke reaches the selection only when it ends. Updating the selection on every pointer move would recompute the Area panel's totals, record a price history for every intermediate selection (the history keeps the last few selections), and tell the host about a new focus, many times a second. The renderer previews the stroke on its own layer meanwhile.

### One action target

Each action panel used to choose its own scope: Policy area, Rule scope, Jobs area, Recruit in, Buy weapons in. These choices disagreed with each other and with the map, and the selection's scope only appeared once two of the player's areas were selected. Now the selection is the only scope, and the bar under the tabs says what it is.

With none of the player's areas selected, the actions apply to the whole realm. The alternative, disabling them until something is selected, would put an extra tap before every realm-wide tax. Selecting every area of the realm also means the whole realm, so standing orders cover areas taken later, and taxes are set realm-wide rather than as an override in each area.

Recruits and weapon purchases for the whole realm go to the capital. Split by population over a realm of 40 areas, 500 recruits would make 40 armies of a dozen soldiers, which nobody wants to march one by one. Selecting areas still splits them on purpose.

## Panels and map layers

### Layers follow the panels

The map layer and the flows used to be two menus in the top bar, chosen apart from the panels. Reading the Jobs panel over the realm colors, or prices over the population, meant two choices that the player had to keep in step, and on phones the menus took a second row of the top bar. Each panel now shows the layer its figures come from: prices for Goods, population for Population, necessities met for Needs, employment for Jobs, and wages for Policies, whose taxes act on them. Flows are checkboxes in the panel they explain, migration in Population and transport in Goods, so arrows never cover a layer they have nothing to do with.

Resources are stripes over the terrain rather than a color scale of their own. Where a good can be extracted depends on terrain, so seeing both at once explains the pattern, and a color ramp over the terrain colors would have been unreadable. Stripe thickness takes four steps, which the eye tells apart where a continuous scale of widths would not. The employment rate gets its own layer for Jobs; it is public like wages, since it is visible from the street.

The Resources panel keeps its own good, apart from the good of the Goods panel. Crafted goods have no natural capacity, so sharing one choice would show an empty resources map after looking at the price of tools.

### Births & deaths

The model has one net rate of natural change per area (section 4, Population): an area whose necessities are met grows, and one short of them starves. Showing births and deaths apart would have meant inventing a split the model does not have, so the Population panel shows one signed figure, "Births & deaths", next to migration in and out.

Births and deaths later became two flows (see Births and deaths apart), and the panel now shows both.

### No depot transfers

Players could send goods between their own depots, paying transport and waiting for the goods to travel. The form took room in the Area panel and needed a pair of areas, while the panels now act on one selection, so its controls went first. Transfers were removed from the simulation as well; moving stock between depots may come back as a standing order.

### Negative head tax

A negative head tax is an allowance per inhabitant. It joins the government's bill with subsidies and wages, so a short treasury scales it down with them, and it reuses the head tax rather than adding a policy.

### Flows after a new route

The jobs phase can open an air route after the population and trade phases, and the per-tick buffers were then rebuilt empty before the next snapshot, which showed no migration, no trade and no births or deaths for one sample. The rebuilt buffers now keep the last tick's values.

### Scales from the map's own values

The prices layer first colored a good's price against its labor value, at full color for three times more or less. Prices mostly sit within a narrower band, so the map came out in pale tints. It now runs from the map's lowest price to its highest, with white at the median and a log scale on each side, so skewed prices still use both halves of the colors. Real income uses the same scale: against the fixed reference of 1, nearly every area was blue, since the cost of living sits around ×2.

### Income and real income

Starving areas could show high wages: food is dear, so a worker's output is worth many man-hours, which buy little locally. The income map therefore shows real income, income over the local cost of living, and a test run confirmed that starving areas then come out the poorest (a real income a sixth of the median or less). Jobs and Armies keep the nominal average private wage, since workers compare government wage offers and soldiers their pay with it.

### Gross, net and real net income

The average wage counts only employed private workers and ignores taxes, so an area with mass unemployment or a crushing head tax still looked well off. Gross and net income are per member of the workforce, the unemployed earning nothing, and net income takes off what the government takes and adds what it pays. The host computes both, since the taxes and job wages behind them are private to each realm, and sends them as public figures like the average wage. Private value added uses the same marginal output as the average wage, so the mean of the per-job wages is the average wage and the figures agree with what drives demand and labor. Tariffs come out of the trade margin and already show in prices and the cost of living. Soldiers' pay goes to wherever the army stands, and soldiers are not part of the area's workforce, so neither is counted. Subsidies and allowances count as far as the treasury paid them.

### No stand-in for a foreign selection

Actions first fell back to the whole realm whenever the selection held none of the player's areas, so selecting a neighbor's area and opening Jobs showed the realm's employment, which read as the neighbor's. A selection of others' areas now has no target, and the action panels say so; the realm stays one tap away with Clear. An empty selection still means the whole realm, so realm-wide actions need no extra step.

### One good's transport flows

The transport flows first had their own good choice in the legend, with "all goods in tonnes" as the default, apart from the Goods panel's good. The flows now show the Goods panel's good, so the prices, their history and the arrows all describe the same good, and the legend no longer needs a control.

### Every realm at the end

The end screen compares every realm from the figures snapshots already carry, plus each realm's peak population recorded during the session. Treasuries and depots stay private even then: a joined player who leaves gets the same table as the host without a final message from the host's world, and nothing private ever leaves the host.

## Infrastructure

### Money and time instead of worker jobs

Ports, airports, roads and forts were built by government jobs: the player hired builders, and worker-days turned into levels or road steps. Nothing needed running once built, so infrastructure only grew, and every coastal area started with a port. Building now costs money paid into the area's savings over a fixed time, and every built level needs staff. Infrastructure has a running cost, so a realm chooses where it pays off, and a short treasury slows construction and empties the staff.

### Staff paid a share of the local wage

The staff wage is set as a share of the area's average private wage, not in man-hours. Local wages differ several-fold across a realm and drift over time; a fixed wage would leave staff quitting in rich areas and overpaid in poor ones, needing constant adjustment. At 110% by default, staff stay wherever the treasury pays. Running at the staffed share, rather than all or nothing, keeps capacity, road costs and defense from jumping when a few workers quit.

### Roads per area

Roads were per border, an area having about six. A road level per area keeps one line per area in the panel and for the AI, and a border gains from both sides: half the way from its own side alone, so roads at a border with a neighbor still help.

### Sea lanes and routes between ports

With ports in only a few areas, the sea routes laid by map generation between neighboring coasts almost never had a port at both ends: in a two-year AI-only game, sea trade fell to nothing. Those links became lanes, which armies sail but goods do not, and sea routes are rebuilt between ports along them, like air routes between airports. The same game then carried about 1,700 to 3,200 tonnes a day by sea over 29 to 32 routes. Trade also stopped counting edges that carry nothing (lanes, routes of idle ports) when splitting an area's surplus between its edges, which had diverted part of it to them.

### A quarter of coasts with a port

Ports then started with each coastal area at a 1-in-4 chance instead of two per realm, and the AI lost its caps on ports and airports, starting as many levels as its budget allows. In the same two-year game, the map started with 30 ports of 142 coasts instead of 15, and 74 sea routes instead of 29. Sea tonnage barely changed, about 1,750 rising to 3,300 tonnes a day: sea trade is limited by the price gaps between distant coasts more than by the number of routes. Without the caps the AIs build far more, almost all of it roads (a builder reached 107 road levels), since roads score on population and land trade in every area while ports score only on coasts.

### A new save version

Old saves held construction progress in worker-days and road steps per border, which have no equivalent in levels, so version 1 saves are refused with a message rather than converted.

## Water cells

### The sea as cells with resources

Generated maps already tiled a rectangle with Voronoi cells, but kept only the water cells' centers, to shape the coasts; the sea was drawn as a flat background. Water cells are now part of the world: they fill the rectangle with land, have a depth (hops from land), and can hold natural capacity. They have no people, owner, market or edges, so the tick still loops over areas only; an area simply extracts from its share of the cells its port reaches, added to its own capacity. Depletion and regeneration act on the cells themselves, so a fishing ground worked by several ports is depleted by all of them.

### Reach by built level, shared equally, and a port required

A port reaches one more ring of water cells per level, counted over water so a port does not reach the far side of a peninsula. The reach follows the built level, which changes rarely, rather than the running level, which moves with staff; staffing scales the catch instead, as it scales every other effect. A cell several ports reach is split equally, idle ports included, so building a port next to a rival's takes half of its fishing ground at once, and an empty port still holds its claim. Without a port an area works no water: the sea is what ports are for, beyond trade. The reach is a pure function of the water graph and the public port levels, so the interface computes the same reach without a new snapshot field.

### Fish at sea, and a smaller share of food

Fish moved from coastal land to the sea (`sea`: depth up to the top port level, so every placed resource can be reached), and crude oil and natural gas of the large catalog also offshore (depth 2 or more, needing a port of level 2). With a quarter of coasts starting with a port, ports reach about a fifth of the world's fish. In the small catalog, fish and bread had the same preference and fish covered almost half the food: the 30 starting ports could not catch it (fish output on a 300-area map fell from 345,000 to 104,000 a day, even with four times the capacity), and unmet necessities rose from 2.6% to 9.7%. Fish's preference went from 1 to 0.35 in the small and medium catalogs, making it a coastal supplement: unmet necessities came back to 2.9% (small, 300 areas) and 2.8% (medium, 1,000 areas, 3.3% before).

In the two-year AI-only game (small catalog, 300 areas), fish sells at about 4.5 times its labor value instead of 2.5, which makes ports worth building: the AIs went from 30 to 51 ports (35 before), and sea routes from 74 to 123. Sea tonnage reached 4,100 tonnes a day (3,300 before). Offshore oil is barely touched in two years, since few ports reach level 2. Treasuries hold and no command is rejected.

### A third save version

Saves of version 2 have no water cells, and their coastal areas hold the fish that is now at sea, so they are refused like version 1.

## Incomes, taxes and the population boom

### Why population crashed instead of levelling off

A long peaceful game (60 areas, small catalog, 3 peaceful AI realms, 60 years headless) grew at the full 3.7% a year for 12 years while unemployment rose from 19% to 33% and the average wage fell from 1.58 to 0.60, with necessities 100% met throughout. Around year 14 food capacity was reached, food went to the price ceiling (10× labor value) and about 40,000 people starved a year. Population then crept up to 1.72 million and settled at necessities met = 0.907, just above the threshold, with a quarter of the people in areas below it.

Two rules caused it. Births looked only at necessities met, which measured what people chose to buy, so nothing slowed them before the land gave out. And nobody's purchases depended on their own income: one purchasing power, the employed's wage times the savings factor, applied to every inhabitant, and buying inside an area moves no money, so the unemployed ate as well as anyone and a benefit for them could change nothing. The AI made it harsher: it spent only 40–60% of its tax income, and treasuries went from 63 million to 130 million while private savings fell from 68 million to 0.2 million. Without realms money stayed constant, but the wall still came at year 14.

### Buying from one's own income

Consumers now buy in groups: the workers of each wage band, and the unemployed, each with the people who depend on them. A group's budget is its income times the savings factor, and it spends it on necessities first. The budget only caps quantities, since money spent inside an area stays there; what a group wanted but could not pay for counts as unmet need. The unemployed live on half the average wage (`unemployedWageShare`), standing for what families pass on: with nothing at all, the 20–40% of the workforce the economy does not need from the start would starve on day one.

One group per job would have cost about 60% more tick time on the 3,000-area large map (56 groups × 10 needs per area). Four bands keep it to five groups. The bands are fixed wages, not shares of the local average, so a tax rate set for a band means the same thing in every area and over time, as real tax brackets do. The measured cost is about 10% on that map (98.9 ms per tick against 89.6 ms, on a busier machine than the earlier timings).

Placing the starting workers needed one more step. Demand used to start at the reference basket for everyone; it now starts there, and workers are placed again for what the groups buy at the wages that placement gives, three passes in all, so the first tick still produces within 10% of what is bought. Stocks must be set before each placement, since placing runs a production pass that rations inputs from them: without it, bread had no grain, its marginal output and the starting wage came out near zero, and the map started with a third of its money.

### Births stop before starvation

Births now need necessities met above 0.98, and starvation starts below 0.9; in between, the population holds steady. With budgets, necessities slip as the poorest are priced out of food, so births stop there, and an overshoot lands in the steady zone. A rule tying births to real income was tried first: it needed two calibrated incomes and still let some areas starve on a 300-area map, so it gave way to this simpler one. Raising the growth threshold to 0.99 made no difference: necessities stay fully met until food capacity binds and then fall within a couple of years, faster than births react.

| 60 areas, 3 peaceful realms | Before | After |
| --- | --- | --- |
| Population, settled | 1.72 million, at the starvation line | about 1.16 million |
| Starvation | about 40,000 a year from year 14, then lasting | about 7,000 over years 16–18, then none |
| Necessities met, settled | 0.907 | about 0.96 |
| Food price | at the 10× ceiling | 2.5 to 4.5× labor value |
| Unemployment | 19% → 33% | 24% → 33% |
| Private savings | 68 million → 0.2 million | 68 million → about 105 million (21–35 days) |
| Treasuries | 63 million → 130 million | 63 million → 13–26 million |

On 300 areas over 40 years with 8 realms the picture is the same: 2.99 million people grow at about 3.7% a year, about 80,000 starve over years 14–18 as food capacity binds, and the population then settles near 6.2 million with starvation close to zero, savings at 22 days and food at 3.9 times its labor value. Without realms, the 60-area map settles at about 1.05 million with unemployment near 45% (25–30% before) and a trickle of starvation, about 0.04% a year: nobody pays the unemployed a benefit there. Overall satisfaction falls to about 0.72 once the map is full, as many can no longer afford comforts.

### Births and deaths apart

The two thresholds gave way to two separate flows. Births run at `birthRatePerDay` whatever the necessities met, and deaths rise as necessities go unmet. A full area runs short until deaths match births. Above its capacity there is less food per head and deaths outrun births; below it, the reverse, so the balance holds by itself. Population changes over years and prices over days, and the approach showed no swings. The cost is standing deaths: at the balance they equal births, about 3.7% of the people a year, all replaced.

Deaths were first linear in the unmet share, at `0.003 × (1 − s)` a day. The balance then came at 0.967, but 5% unmet already killed 5.5% of the people a year, more than were born, which made people die off at necessities a player would call met. Deaths now rise with the square of the unmet share: 5% unmet kills about 0.3% a year and total famine still 0.3% a day, but the balance moves to `1 − sqrt(0.0001 / 0.003)`, about 0.82. A full map therefore holds more people, hungrier and poorer: more of them priced out of food, and less spent on comforts.

| 60 areas, 3 peaceful realms, 60 years | Thresholds | Linear deaths | Squared deaths |
| --- | --- | --- | --- |
| Population, settled | about 1.16 million | about 1.14 million, from year 24 | about 1.40 million, from year 40 |
| Necessities met, settled | about 0.96 | 0.967 | 0.818 |
| Births and deaths, settled | none either way | about 41,500 a year each | about 51,000 a year each |
| Food price | 2.5 to 4.5× labor value | 4.6× labor value | 6.1× labor value |
| Unemployment | 24% → 33% | 24% → 32% | 24% → 44% |
| Satisfaction | about 0.72 | about 0.74 | about 0.52 |

On 300 areas over 40 years with squared deaths, population grows from 2.99 to 7.56 million and is nearly level by year 40 (6.15 million from year 32 with linear deaths), with necessities met at 0.82, food at 4.3 times its labor value and 43% unemployment. Without realms, the 60-area map settles at about 1.31 million from year 42 (1.05 million with linear deaths), with 54% unemployment.

### An income tax instead of the production tax

The production tax fell on the gross value of output, inputs included, so it compounded along supply chains, and with no capital or profit in the model it was a tax on the same wages an income tax takes. It is gone. The income tax sets a rate per wage band (negative tops wages up), and its row for the unemployed is an amount per unemployed worker (negative: a benefit), which also raises the wage workers ask for by half the benefit. The consumption tax already taxes final purchases per good, as a value-added tax does. The AI taxes through the income tax on all bands, counting its base from the public gross income; its rates stay those of the personalities, and the probes show treasuries that still pay for infrastructure.

### The AI pays its surplus back

Above twice its reserve, an AI pays the excess out over about a year as a benefit for its unemployed, and stops below the reserve. Its tax keeps the personality's floor: at zero, the reserve and the infrastructure budget, both counted in days of tax income, would vanish.

### Islands linked by air

An island with no grain of its own, fed through a small air link, used to keep eating at any price: bread rose to 9 times its labor value and consumption ignored money. Now its bakers, paying 9 times the labor value for grain, earn nothing, the island cannot afford bread, and it goes hungry and broke. Its grain price gap makes grain worth flying, up to 14% of what goes by sea where it was under 1% before, so the test now holds only stone, coal and timber to the 1% limit.

### A fourth save version

The resolved policies lost the production tax and gained the income tax and the unemployed row, and the config gained four values, so saves of version 3 are refused.

### Price controls in multiples of labor value

The Policies tab gave every policy one line: a slider with its level on the thumb, applied when released, and arrows for fine steps, with one good picked for all the goods policies. A price ceiling or floor in man-hours could not have one slider for "all goods", whose prices differ by orders of magnitude, so price controls became multiples of each good's labor value, the unit the price bounds already used. Saved settings would have been read in the wrong unit, so saves of version 4 are refused.

## Open questions

- **Tick time on large maps.** At 3,000 areas with the large catalog a tick takes about 50 ms in Node and 65 ms in the browser worker. The interface stays smooth because the simulation runs in a worker; only the top speed on large maps is limited. Worth revisiting if players need faster large maps.
- **Naval combat and blockades** on sea routes.
- **Research**, if it returns with its effect on the economy fixed (it left people hungrier past a few levels; see AI governments), and with it gating the modern recipes of the large catalog.
