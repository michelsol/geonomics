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

### Militia only defends neutral areas

Initialization gives every area a militia, but only neutral areas use it. Combat counts it only when the area has no owner, so owned areas without armies are besieged at once.

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

### Area history

Population and average wage are recorded for the areas the player can see in detail or has selected, like area prices: two channels of 365 Float32 samples, about 3 KB per area, so well under 1 MB for a large realm. Samples follow snapshots in wall time, so at top speed they are many game days apart.

### Charts

The realm and area histories used a second y axis for population. They are now separate small charts, one measure each: two scales on one chart invite reading the crossing of the lines as meaningful. Employment is a part-to-whole, shown as one stacked bar (private, government, unemployed) with a legend, and the jobs by good as a table with inline bars rather than a pie, so a dozen goods stay readable.
