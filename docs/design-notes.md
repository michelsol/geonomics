# Design notes

Rationale and findings behind the rules in [specification.md](specification.md). The specification says what the simulation does; this file says why, and what was tried before.

## Economy stability (roadmap stage 3)

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

The reservation wage also absorbs the surplus labor that the calibration rule leaves (about a quarter of the workforce). With an unemployment value of 0 and a temperature proportional to the wage level, unemployment could never become attractive and prices deflated toward the floor.

### Money leaks

Transport was paid to nobody, so every long-distance purchase destroyed money. A world without governments has no source of money, and remote areas went broke and starved. Transport is now paid to the exporting area, whose carriers do the work, so trade between neutral areas conserves money.

A reservation wage fixed at one man-hour per hour then kept resource-poor areas from ever exporting: they paid for imported inputs, priced their goods like everyone else and drained their savings. The reservation wage now follows the same savings factor as purchasing power, so a deficit area accepts less, undercuts its neighbors and earns its money back, while a rich area asks more and imports more.

### Smaller choices

- The marginal output of a crafted good scales with its input ration instead of dropping to zero when the ration falls below 1, which made value added flip on and off.
- Satisfaction values each need at its reference unit price, because needs are measured in different units.
- The diagnostic oscillation count ignores daily moves under 0.1%, which are noise.
- The air-only island scenario with the large catalog leaves about 40% of necessities unmet: shelter needs cement, stone and timber, which cannot fly. That is the scenario working as intended.

## Map generation (roadmap stage 5)

### Shape

The first maps were one round continent with a mountain core, because hills and mountains were ranked by the elevation that includes the edge falloff. They are now ranked by the noise alone, and a weaker falloff with smaller features gives several landmasses and islands. Filling lakes and sinking islets moved the land count by about 10%, so the sea level is corrected until the count is within 1% of the target.

### Resources must be labor-feasible

Placing primary goods by abundance alone starved most of the map. Coal in the medium catalog takes about 7% of all labor at reference demand (fish in the small catalog about 12%); as a regional good on hills and mountains it ended up in about a tenth of the areas, which would have needed more than their whole workforce to supply the world. Coal sold at the price ceiling, its holders earned a wage level near 6, money drained toward them, and the rest of the map went broke and hungry.

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

Micro-optimizations of the per-area phases (fewer `pow` calls, hoisted lookups) made no measurable difference. Reaching the budget needs a structural change: fusing the per-area phases into fewer passes, or splitting areas between worker threads in the host loop (stage 8). The default 1,000-area map runs in about 15 ms.

## Government (roadmap stage 6)

### Government purchases must count as demand

The first version followed the specification literally: a buy order takes only the stock above the area's reserve, and nothing else changes. In a balanced area the stock sits at its reserve, so a government could buy only in a glut: `keepDepotStock` never filled its depot. Producers never saw the government's demand, so they never grew to supply it. What a government tries to buy is now recorded as `governmentDemanded` and counted in total demand, so it raises the price target and the labor plan like any customer. The purchase itself still stops at the inhabitants' reserve. A standing order keeping three days of grain then fills its depot in about two months on the small catalog.

### Money stays conserved

Depot transfers originally paid their transport into nothing. It now goes to the source area's carriers, as in private trade, so money only moves between savings and treasuries. A unit test checks this under taxes, tariffs, subsidies, wages, market orders and transfers together.

### How fast policies bite

The economy reacts slowly, by design (specification §4):

- A head tax of 1 man-hour per person per day (a quarter of income) halves the taxed area's savings in about 150 days, against an untaxed control. Its imports fall by over 15%.
- After grain capacity triples, the grain price falls about 20% in 100 days. When capacity drops to 40%, it rises about 60% over the next 100 days.

A government that buys in the glut and sells in the famine makes a clear profit. The windows for it are measured in months, not days.

### Cost

Founded realms send their areas through the government code paths: the policy lookups, taxes, the market phase and depot spoilage. On the default 1,000-area map this adds about 7% to the tick (5.2 ms against 4.8 ms with the medium catalog). The economic diagnostics of every scenario are unchanged when no government acts.

## War and conquest (roadmap stage 7)

### Attacking armies hold what they attack

At first, an army in attack stance stopped on entering an area it attacked, but set out again on the next tick, so it walked through enemy land without besieging anything. An attacking army now stays in an area until it falls or the war ends, then follows the rest of its path. A march order in attack stance is therefore a campaign: each area on the way is taken in turn. Armies in hold stance pass through.

### The §7 example

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

## Web app (roadmap stage 8)

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


## Playtest feedback after stage 8

### Why weapons were never made

Weapons satisfy no need and go into no recipe, so private producers only make them when a government buys them: a purchase counts as demand (`governmentDemanded`) and labor follows it. Standing orders could not create that demand. They were paced at a share of the area's private demand or production, both zero for weapons, so a `buyBelowPrice` rule never traded. Pacing now also follows the trade's own size. Measured on 300-area maps after warm-up, a standing order for 500 weapons at twice their labor value fills the depot in 20 to 30 days on the medium and large catalogs. The headless war test checks it on the medium catalog.

### Armies without food

Food made armies hard to run: loading supplies, standing orders per depot, foraging abroad. Soldiers now cost only their wage, and the wage sets their loyalty with the same rule as government workers. Measured realm wage levels after warm-up range from about 0.3 to 1.5 man-hours per hour (small catalog extremes, around 0.9 on the medium catalog), so the default soldier wage is 1.5. Armies keep weapons, taken from the local depot automatically, because equipment is what doubles their power.

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

## Multiplayer (roadmap stage 9)

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

