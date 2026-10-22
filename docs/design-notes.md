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
