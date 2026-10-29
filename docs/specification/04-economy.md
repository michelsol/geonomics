[Specification](README.md) · section 4 of 10

## 4. Economy mechanics

All values are measured in **man-hours**: one hour of work at the reference level of technology. This anchors every price to labor and gives a natural measure of prosperity.

The private economy of every area is five steps: produce, consume, trade, reprice, reallocate labor. Population then reacts slowly to the result. In the formulas below, `days` means `gameDaysPerTick`, and `fraction(rate)` is the helper from section 3, rule 2.

### Labor value

The labor value of a good is the man-hours embodied in one unit, inputs included. It is computed once at startup, in recipe order:

```typescript
laborValue(g) = laborHoursPerUnit(g) + sum(input.quantity * laborValue(input.good) for input of g.inputs)
```

Labor value is the starting price of every good and the reference for price bounds and demand elasticity. Market prices then float around it according to local scarcity.

### Value added and wages

A worker's **value added** is the market value of what they produce, minus the value of the inputs used, per hour worked. An area's **average private wage** is the mean value added per worker-hour across its private workers.

An average private wage above 1 means local labor is worth more than the reference: good resources, good trade access or scarce products. Players see it per worker and day, beside the wage of each private job; what the workforce earns and keeps, the unemployed included, they see as gross, net and real net income (section 9, Income).

### Money circulation

An area's **savings** is the private money held by its inhabitants. Transactions inside an area cancel out, so savings change only through flows that cross the area's boundary:

| Flow | Direction | When |
| --- | --- | --- |
| Exports to neighbors, transport included | Into savings | Trade phase |
| Imports from neighbors | Out of savings | Trade phase |
| Taxes | Savings to treasury | Tax phase |
| Subsidies, wage top-ups, allowances and benefits for the unemployed | Treasury to savings | Tax phase |
| Government and army wages | Treasury to savings | Tax phase |
| Government purchases on the local market | Treasury to savings | Market phase |
| Government sales on the local market | Savings to treasury | Market phase |

**Starting money.** Money is made once, at the start: each area begins with `targetSavingsDays` of its income in savings (section 3, rule 6), and each realm with `startingTreasuryDays` of its income in its treasury (section 5, Founding). From then on, the flows above only move it between savings and treasuries.

Taxing without spending drains an area's savings, so it can no longer import. This is intended: it is the natural cost of over-taxation.

Transport is paid by the buyer to the exporting area, whose carriers do the work, so trade between neutral areas conserves money.

Savings also feed back into demand and wages: an area holding more than its target savings spends more, mostly on comforts and luxuries, and its workers ask for more; an area with depleted savings cuts back and its workers accept less, so its goods get cheaper and sell abroad (Consumption and Labor allocation below). Both pull savings back toward the target through trade.

When savings cannot cover a tax bill, the shortfall is collected **in kind**. Goods move from the area's stock to the government depot, valued at local prices.

### Workforce

```typescript
workforce = area.population * config.economy.workforceShare
// workforce = sum(privateWorkers) + government workers + unemployedWorkers
hourlyOutputPerWorker(good) =
  config.economy.hoursPerWorkerDay * area.productivity / good.laborHoursPerUnit                          // units per worker per day
```

### Production

Goods are processed in catalog order, so inputs made this tick are available to their outputs. Private and government workers on the same primary good share the natural capacity, and output is split between them in proportion to workers.

**Extraction capacity.** The `capacity` of a primary good in an area is its own natural capacity plus, when it has a port, its share of the current natural capacity of each water cell the port reaches (section 5, Infrastructure), times the port's staffed share. Capacity lost to depletion is split between the land and the waters in proportion to the capacity each brought, and among the water cells in proportion to the area's share of each times its capacity. Water cells recover toward their maximum in phase 10, like areas.

```typescript
// Primary goods: diminishing returns on nature
laborOutputPerDay = totalWorkers * hourlyOutputPerWorker(good)
outputPerDay      = capacity * (1 - exp(-laborOutputPerDay / capacity))
output            = outputPerDay * days
marginalOutputPerWorker = hourlyOutputPerWorker(good) * exp(-laborOutputPerDay / capacity)
capacityLost      = output * good.depletionPerUnitExtracted // split between the land and the waters it came from

// Crafted goods: limited by labor and by rationed inputs
maximumByLabor  = workers * hourlyOutputPerWorker(good) * days
output          = maximumByLabor * min over inputs of ration[input.good]
outputLimitedByInputs = output < maximumByLabor
marginalOutputPerWorker = hourlyOutputPerWorker(good) * min over inputs of ration[input.good]
```

**Input rationing.** Several goods often share one input; electricity, for example, feeds most recipes. A scarce input is split between its users in proportion to what each one requests, not handed to whichever comes first in the catalog. This takes one pass, because catalog order guarantees that when good `i` is reached, all of its production for the tick is done and all of its users come later:

```typescript
// computed when good i is reached, before any of its users produce
requested[i]     = sum over private recipes c using i of maximumByLabor[c] * quantity(c, i)
ration[i]        = min(1, stock[i] / max(requested[i], epsilon))
inputDemanded[i] = requested[i]
```

A user limited by another input takes less than its ration, and the rest stays in stock. Producers draw before consumers in the same tick.

`inputDemanded` matters as much as consumer demand. **Total demand** for a good is `max(demanded, consumed) + inputDemanded + governmentDemanded`: what consumers wanted or, when they fell back on it because a substitute ran out, what they actually ate, plus what producers requested, plus what governments tried to buy. It is the demand used by the price target, the exportable surplus, the labor plan and the initial stock. Government buy orders and standing orders use the inhabitants' part only, without `governmentDemanded`.

Private production draws inputs from the area's stock. Government production draws from the government depot, with its own rationing over the depot, and is not part of `inputDemanded`. Services are produced like crafted goods but go straight to consumption and never enter stock.

### Consumption

Consumption has four parts: the groups that buy and what each can spend, the demand for each need split between the goods that satisfy it, the budget each group spends on it, and a spillover pass when some of the goods run out.

**Groups.** An area's consumers buy in groups: the workers of each **wage band**, then the unemployed, each with the people who depend on them (`population × workers / workforce`). The bands are fixed hourly wages: under 0.5, 0.5 to 1, 1 to 2 and over 2 man-hours. Private workers earn their job's value added (Labor allocation), government workers their wage offer and infrastructure staff their share of the average wage, both as far as the treasury paid them. A band's income per worker-hour is its workers' mean wage less its income tax rate (section 5, Policies). The unemployed live on a share of the average wage that the employed pass on, plus the benefit when the unemployed tax is negative:

```typescript
bandIncome       = meanWage(band) * (1 - incomeTaxRate[band])
unemployedIncome = unemployedWageShare * max(averageWage, 0) - unemployedTaxPerDay / hoursPerWorkerDay
income(group)    = max(0, income - headTaxPerPersonPerDay / workforceShare / hoursPerWorkerDay)  // each owes the head tax for its people
```

**Purchasing power** combines a group's income and the area's savings. Savings near `targetSavingsDays` of income are neutral. More savings raise demand and fewer lower it, mostly for needs with a high `wealthElasticity`. The same `savingsFactor` sets the wage workers accept (Labor allocation):

```typescript
incomePerPersonPerDay = max(averageWage, 0.1) * hoursPerWorkerDay * workforceShare
savingsDays     = savings / max(population * incomePerPersonPerDay, epsilon)
savingsFactor   = clamp(savingsDays / targetSavingsDays, savingsFactorMin, savingsFactorMax) ** savingsElasticity
purchasingPower(group) = max(income(group), 0.01) * savingsFactor
budget(group)   = income(group) * hoursPerWorkerDay * days * workers(group) * savingsFactor
```

The effect stabilizes itself. Consumption inside an area does not move money, but higher demand raises local prices, which pulls in imports and spends savings down toward the target. An area with depleted savings demands less, so its prices fall, it exports more and its savings refill.

**Demand per need** and the **split between substitutes**: each good competes on the price of the need units it provides.

```typescript
consumerPrice[g] = price[g] * (1 + consumptionTaxRate[g])
unitPrice[g]     = consumerPrice[g] / g.satisfies.unitsPerGood         // price of one need unit through g
share[g]         = g.satisfies.preference * unitPrice[g] ** -need.substitutionElasticity
                   / sum of the same over all goods of the need
needPrice        = sum over goods of the need of share[g] * unitPrice[g]

// needs in tier order, necessities first; per group:
wanted(group) = people(group) * need.demandPerPersonPerDay * days
              * (need.referenceUnitPrice / needPrice) ** need.priceElasticity
              * purchasingPower(group) ** need.wealthElasticity
bought(group) = min(wanted(group), budget(group) / needPrice)
budget(group) -= bought(group) * needPrice

needDemanded = sum over groups of wanted        // what people wanted, the reference for satisfaction
demanded[g]  = (sum over groups of bought) * share[g] / g.satisfies.unitsPerGood
consumed[g]  = min(stock[g], demanded[g])
```

A group buys what its money pays for, necessities first, then comforts, then luxuries. Purchases inside an area move no money, as every trade there cancels out: the budget only caps quantities. The market sees what was bought (`demanded`), which drives prices and the labor plan; what a group wanted but could not pay for counts as unmet need.

**Spillover:** after the first pass, the need units left unmet by goods that ran out are spread over the goods of the same need that still have stock, in proportion to `share` and capped by that stock. One pass is enough. `demanded` keeps the value from before spillover, so a scarce good keeps its upward price pressure while its substitutes cover the shortfall. `needConsumed` is the sum of `consumed[g] × unitsPerGood` over the need's goods.

`referenceUnitPrice` is `needPrice` computed once at startup, with every consumer price equal to labor value. At those prices and at a purchasing power of 1, a group wants exactly `demandPerPersonPerDay` per person. A substitution elasticity of 0 keeps shares fixed by preference; 2 to 4 lets consumers switch strongly toward the cheapest good while keeping some variety.

`necessitySatisfaction` is the sum of `needConsumed` divided by the sum of `needDemanded` over necessity needs, each valued at its `referenceUnitPrice` so that needs measured in different units add up. `satisfaction` is the same ratio over all needs, with each need also weighted by its tier in `tierWeights`.

### Trade

Trade is computed per edge, per good and per direction, from a snapshot of the state before trade; all flows are applied together afterward. Land, sea and air edges use the same formula. Each edge keeps a **shipping rate** per good and direction (`Edge.tradeFlowPerDay`), which moves toward a target set by the price gap. An area splits its exportable surplus of a good evenly between the edges where that good has a positive gap, and its import demand evenly between the edges it can import it from.

```typescript
transport  = edge.transportCost * good.transportWeight
tariffs    = crossesBorder ? sellerPrice * exportTariffRate[seller] + sellerPrice * importTariffRate[buyer] : 0
gap        = buyerPrice - sellerPrice - transport - tariffs
           - tradeMargin * max(buyerPrice, sellerPrice)          // 0 on an inactive or blocked edge

// The wider the gap, the more of its reserve the buyer refills from this edge each day
targetRate = gap > 0 ? reserveDaysOf(good) * buyerTotalDemandedPerDay
                       * tradeGapSensitivity * gap / buyerPrice / buyerEdgesWithPositiveGap
                     : 0
rate      += fraction(tradeRatePerDay) * (targetRate - rate)
// a fading rate below 1% of the buyer's daily use is set to 0
if (gap <= 0 || good.isService) skip

// The seller keeps part of its reserve and splits the rest between its exporting edges
exportable = max(0, sellerStock - exportReserveShare * reserveDaysOf(good) * sellerTotalDemandedPerDay)
             / sellerEdgesWithPositiveGap
quantity   = min(rate * days, exportable)      // shipments under 0.1% of the buyer's daily use are skipped
unitPaid   = sellerPrice + transport + tariffs + gap / 2   // the buyer and seller split the gain
```

After capacity (below), an area whose imports would cost more than its savings has all of them scaled down by the same ratio: the buyer can only spend what it has, across all its edges and goods together. The seller receives `sellerPrice + transport + gap / 2` per unit, the transport going to its carriers; tariffs go to the respective treasuries.

The rate's inertia keeps trade from sloshing between areas whose prices are almost equal. Scaling by the reserve damps perishable goods as much as durable ones; in exchange they need a wider gap to travel.

**Capacity.** Sea and air routes carry at most `capacityPerDay × days` tonnes in each direction. When the flows of all goods in one direction exceed it, the route is filled greedily, in order of gap per tonne, so the most profitable cargo goes first. Land edges have infinite capacity and skip this step. Routes are few, so the sort costs little.

Goods reach distant areas by being re-exported over several ticks. Price differences spread through the network like heat, so no area ever needs to know about areas that are not its neighbors.

### Sea and air routes

Sea and air traffic reuse edges instead of adding a separate system. A route is an `Edge` with `mode: "sea"` or `"air"` between two distant areas. Trade, tariffs, blocking and migration then work unchanged, and cost per tick stays proportional to edges × goods. The route graph is kept sparse on purpose. Because prices spread hop by hop, a few routes per port or airport are enough to connect distant markets; joining every airport to every other one would add edges with the square of the number of airports and gain little.

| | Sea routes | Air routes |
| --- | --- | --- |
| Endpoints | Two areas with a port (`portLevel` ≥ 1) | Two areas with an airport (`airportLevel` ≥ 1) |
| Created by | Rebuilt whenever a port opens or closes: each port is linked to its `seaRoutesPerPort` nearest ports by distance along the sea lanes, without sailing past another port | Rebuilt whenever an airport opens, closes or reaches the maximum level: each airport is linked to its `airRoutesPerAirport` nearest airports, and airports at `maximumLevel` are all linked to each other as hubs |
| Base transport cost | `seaCostPerDistance × distance` | `airBaseCost + airCostPerDistance × distance` |
| Capacity per day and direction | `seaCapacityPerPortLevel × min(running port level)` | `airCapacityPerAirportLevel × min(running airport level)` |
| Suits | Heavy bulk goods over long distances | Light, valuable or perishable goods |
| Armies | Can embark from a running port owned by their government; crossing takes `seaTravelDaysPerDistance × distance` | Cannot use them |
| Migration | Multiplied by `migrationFactorBySea` | Multiplied by `migrationFactorByAir` |

- A **running level** is the built level times the staffed share (section 5, Infrastructure), so a route whose port or airport has no staff carries nothing.
- **Sea lanes** are laid by map generation between neighboring coasts (`isLane`). They carry no goods and no migrants; armies sail them from a running port of their own, and sea routes are measured along them. A world built without lanes keeps the sea routes it was given.
- Built and taken down by governments (section 5, Infrastructure); captures leave port and airport levels intact. A route dropped by a rebuild is deactivated (`isActive` set to false) instead of deleted, so edge ids stay stable, and it is reactivated if a later rebuild picks the same pair again.
- Rebuilds run only when a port or airport opens or closes (or an airport reaches the maximum level), done in phase 10 or when a command takes a level down, never as part of the normal per-tick work. Ties go to the lower area id.
- Capacities and land transport costs follow the running levels in phase 10 of every tick.
- An edge with no capacity (a lane, or a route whose ports stand idle) takes no part in trade, so it takes no share of an area's surplus.
- Blocking works as on land: a route is blocked when its two endpoints belong to governments at war, or when either endpoint is under siege. Naval combat and blockades are possible future additions.

### Prices

Every good has two prices. `smoothedPrice` is the **long-run price**: it drifts while the good stays scarce or abundant, and jobs follow it. `price` is the **market price**: the long-run price times a premium proportional to current scarcity, which trade, consumers and the price table see.

Scarcity is measured by a **pressure** between -1 and 1. Storable goods are priced on stock, with a flow term that reacts before the stock has moved far; exports count in the stock target, so an exporter keeps a reserve for its customers. Perishable goods keep a smaller target, so their reserve never rots faster than `maxReserveSpoilageShare` of demand: bread keeps about 1 day, fish 1.25 days and electricity a third of a day. Services have no stock, so they are priced on flows within the tick.

```typescript
reserveDaysOf(good) = min(reserveDays, maxReserveSpoilageShare / max(good.spoilageRatePerDay, epsilon))
used     = max(demanded, consumed) + inputDemanded + governmentDemanded
         + exportRate * days                                            // exports at the smoothed shipping rates

if (good.isService)
  pressure = (demanded - produced) / max(demanded, produced, epsilon)
else
  target        = reserveDaysOf(good) * used / days
  stockPressure = (target - stock) / max(target, stock, epsilon)
  supplied      = produced + imported - exported
  required      = used + target * (1 - exp(-spoilageRatePerDay * days))  // the reserve's spoilage must be replaced
  flowPressure  = (required - supplied) / max(required, abs(supplied), epsilon)
  pressure      = clamp(stockPressure + priceFlowWeight * flowPressure, -1, 1)

floor          = laborValue * max(priceFloorMultiple, policy priceFloor)     // price controls are multiples of labor value
ceiling        = laborValue * min(priceCeilingMultiple, policy priceCeiling)
targetPrice    = smoothedPrice * exp(scarcityPremium * pressure)
logChange      = clamp(fraction(priceAdjustmentRatePerDay) * (log(targetPrice) - log(price)),
                       -log(1 + maxPriceChangePerTick), log(1 + maxPriceChangePerTick))
price          = clamp(price * exp(logChange), floor, ceiling)
smoothedPrice  = clamp(smoothedPrice + fraction(priceSmoothingRatePerDay) * (price - smoothedPrice), floor, ceiling)
```

### Labor allocation

Workers move toward a target allocation: the labor needed to meet total demand, exports included, and to bring the stock back to its reserve, tilted toward jobs whose value added beats the **reservation wage**, the value per hour below which workers would rather stay unemployed. Value added is computed from smoothed prices; a job is weighed after the income tax of its wage band.

```typescript
valueAddedPerHour(good) =
  (smoothedPrice[good] - sum over inputs of input.quantity * smoothedPrice[input.good])
  * marginalOutputPerWorker(good) / hoursPerWorkerDay

averageWage = sum(valueAddedPerHour * privateWorkers) / max(sum(privateWorkers), epsilon)
afterTax(job) = valueAddedPerHour(job) * (1 - incomeTaxRate[band(valueAddedPerHour(job))])   // when positive

reservation = reservationWage * savingsFactor          // workers short of savings accept less
            + benefitReservationShare * max(0, -unemployedTaxPerDay) / hoursPerWorkerDay   // a benefit, more
needPerDay  = used / days + (isService ? 0 : (reserveDaysOf(good) * used / days - stock) / stockRecoveryDays)
needed(job) = isPrimary ? -capacity * ln(1 - min(needPerDay, 0.95 * capacity) / capacity) / hourlyOutputPerWorker
                        : needPerDay / hourlyOutputPerWorker
target(job) = needed(job) * exp(min(5, (afterTax(job) - reservation)
                                       / (laborAllocationTemperature * reservation)))
// scale all targets down together if they exceed the available private workforce; the rest is unemployed
change(job) = fraction(laborMobilityRatePerDay) * (target(job) - workers(job))
// scale all changes down if more than maxLaborShiftPerTick of the workforce would change jobs
```

Each job settles where it adds about the reservation wage: a job adding more grows beyond local need and exports, a job adding less shrinks and its good is imported. Because the reservation wage follows savings, an area importing more than it exports gets cheaper until it exports.

A good is producible in an area if it is primary with natural capacity there, or crafted with a recipe. Workers stuck without inputs see their marginal output fall with the input's ration and drift away.

### Population

Births and deaths are two flows. People are born at a fixed rate, whatever the necessities met. Deaths come on top, from any necessity not met, and each consumer group (Consumption) dies of its own shortfall: deaths rise with the square of the group's unmet share, so a small shortfall kills few people and a famine many, and hunger concentrated on the poor kills as it would in that group alone. A group's necessities met is what it bought, less its share of any stock shortage (in proportion to what each group bought), over what it wanted. An area that fills up runs short until deaths match births: it settles where the people-weighted mean of the squared shortfalls equals `birthRatePerDay / deathRatePerDay`, a thirtieth at the defaults.

```typescript
birthRate = birthRatePerDay
shortfall = sum over groups of people(group) * (1 - necessitiesMet(group)) ** 2 / sum over groups of people(group)
          // (1 - necessitySatisfaction) ** 2 before any consumption phase, or with nobody in the groups
deathRate = deathRatePerDay * shortfall
growth    = birthRate - deathRate
time      = demographyResponsiveness * days
population *= exp(growth * time)
// over the tick, each flow is its rate times the days lived: population * rate * (exp(growth * time) - 1) / growth
births = population * birthRate * (exp(growth * time) - 1) / growth
deaths = births - change in population

attractiveness = (1 - migrationWageWeight) * satisfaction
               + migrationWageWeight * averageWage / (averageWage + 1)
// per active, non-blocked edge, from the less attractive area to the more attractive one
modeFactor = land: 1, sea: migrationFactorBySea, air: migrationFactorByAir
migrants = population * fraction(migrationRatePerDay) * attractivenessDifference * modeFactor / edgeCount
// population and edgeCount (active, non-blocked edges) of the less attractive area
```

Migration reads populations after growth and applies every edge together; migrants leave their savings behind. New inhabitants and migrants join `unemployedWorkers` in proportion to `workforceShare`; the labor phase places them. When population falls, from deaths or emigration, the lost workers (the same `workforceShare` of the loss) are taken from `unemployedWorkers` first, then from private jobs in proportion to their size. Government workers and soldiers are not affected.

### Map generation

A map is generated from a seed, the catalog and `WorldConfig.map`. Every random draw comes from the seeded generator, so the same inputs give the same map.

The world is a sphere: every position is a point on it, in km from its center, and distances are measured along its surface (arcs of great circles). It has no edge, so land can stretch all the way around.

1. **Cells.** `landAreaCount / landShare` points spread evenly over a sphere along a Fibonacci spiral, each nudged by up to half the mean spacing, then relaxed twice toward the center of their Voronoi cells on the sphere (Lloyd). The radius is chosen so the cells share the surface at about `cellSpacing` apart: `R = cellSpacing × √(cells / 4π)`.
2. **Elevation.** Fractal simplex noise in three dimensions (`elevationOctaves`), sampled at each cell's point of the sphere so it has no seam, plus a broader noise field (two octaves, twice the scale, weight 0.8) that gathers land into a few continents. The sea level is set so the land share gives `landAreaCount` land cells, after every body of water other than the world ocean, the largest, becomes land (no lakes) and land masses smaller than `minimumIslandAreas` sink; it is corrected up to four times.
3. **Terrain.** Land cells are ranked by the fractal elevation noise alone: the top 15% are mountains, the next 20% hills. The rest are desert where a moisture noise is low, forest where it is high, and plains otherwise.

| Terrain | Productivity | Land cost factor | Population density |
| --- | --- | --- | --- |
| Plains | 1.0 | 1 | 1.2 |
| Forest | 0.9 | 1.5 | 0.8 |
| Hills | 0.9 | 2 | 0.7 |
| Mountains | 0.7 | 4 | 0.3 |
| Desert | 0.8 | 1.5 | 0.35 |

4. **Areas and water cells.** Each land cell is an area, and every other cell of the sphere a water cell, so land and sea cover the whole world. An area is coastal when it borders a water cell. A water cell's depth is its number of hops over water from the nearest land: 1 where it touches a coast. Productivity is the terrain value times 0.9 to 1.1 from noise. Population is the terrain density, ×1.3 on coasts, times 0.6 to 1.4 from noise, scaled to a mean of `meanAreaPopulation`.
5. **Land edges** join neighboring land cells. Distance is the arc between cell centers; `terrainFactor` is the mean land cost factor of the two areas; `travelDays` is `distance / 25 × terrainFactor`.
6. **Sea lanes.** Each coastal area is linked by a lane to its `seaRoutesPerPort` nearest coastal areas by distance over water (a search over water cells), skipping areas it already shares a land edge with. Then, while some areas cannot reach the others, the shortest water lane from the group of area 0 to another group is added. Ports, airports and their routes come with the realms (section 5, Founding).
7. **Natural capacity.** For each primary good, the eligible places are the areas whose terrain is in the good's `terrains` (`coast` meaning coastal areas; no `terrains` meaning every area) and the water cells it suits: `sea`, any water cell of depth at most `maximumLevel`, so that a port can reach it; `offshore`, depth 2 to `maximumLevel`, beyond the cells along the coast. If none is eligible, every area is. A noise field per good ranks them. A water cell has no people: it counts as `waterCellPopulationShare` of the population of its nearest coast (for a cell out at sea, the largest such value among its neighbors one hop nearer to land). The top places are chosen until both `presence[abundance]` of the eligible ones and enough population to supply world demand with `extractionLaborShare` of its workforce are reached. An area that holds no primary good gets its best-scoring common good, preferring one suited to its terrain. Capacity totals `capacityHeadroom` × reference demand × world population, split in proportion to population × (noise above the cut + 0.2).
8. **Capitals.** `governmentCount` capitals: the most populous area, then each next one maximizing hops to the nearest capital over land and sea edges × √population. An area no capital reaches counts one hop beyond the farthest reachable area.

The world is then initialized (Rule 6), a government is founded on each capital (section 5, Founding), and the world is warmed up.

### Goods catalogs

Needs and goods are loaded from a JSON catalog chosen when a game is created. Three catalogs ship with the game, all in an industrial to modern setting. All numbers are plausible first guesses for tuning in the headless runner.

| Catalog | File | Goods | Needs | Purpose |
| --- | --- | --- | --- | --- |
| Small | `data/goods/small.json` | 5 | food, equipment | Unit tests and convergence scenarios |
| Medium | `data/goods/medium.json` | 14 | food, energy, clothing, household, health | Balancing, short games, slow devices |
| Large | `data/goods/large.json` | 54 | food, energy, shelter, clothing, household, health, mobility, communication, education, leisure | Full games |

**Format.** A catalog holds `name`, `description`, `needs`, `goods` and `military`.

- **Needs and goods** carry the fields of the `Need` and `Good` interfaces, minus the derived ones (`id`, `laborValue`, `referenceUnitPrice`).
- **References** between needs, goods and recipe inputs use string `key`s, resolved to ids at load.
- **`kind`** is `"primary"`, `"crafted"` or `"service"`. The loader derives `isPrimary` and `isService` from it.
- **`terrains`** (optional, primary goods) lists where map generation places the good: `plains`, `forest`, `hills`, `mountains`, `desert` or `coast` on land; `sea` or `offshore` in water cells. Fish is found at sea, and crude oil and natural gas of the large catalog also offshore.
- **`military`** names the `weaponsGood` used for `WorldConfig.military`.

```json
{
  "key": "bread", "name": "Bread", "unit": "kg", "kind": "crafted", "laborHoursPerUnit": 0.2,
  "transportWeight": 0.0012, "spoilageRatePerDay": 0.1, "depletionPerUnitExtracted": 0,
  "regenerationRatePerDay": 0, "abundance": null,
  "inputs": [{"good": "flour", "quantity": 0.007}, {"good": "electricity", "quantity": 0.05}],
  "satisfies": {"need": "food", "unitsPerGood": 1.3, "preference": 1}
}
```

The loader rejects a catalog if any of these hold:

- A key is duplicated or a reference does not resolve.
- An input is listed after the good that uses it.
- A service is used as an input.
- A primary good has inputs or no `abundance`.
- A need has no good satisfying it.
- A terrain is not one of the listed values.

**Conventions used by the shipped catalogs:**

- `transportWeight` is in tonnes per unit, so land transport between neighbors (about 0.3 man-hours per tonne) costs a few percent of the value of most goods. Stone, sand and timber are the exceptions: they barely travel by land and are what sea routes are for.
- Need units are physical where that makes sense (2,000 kcal of food, 10 kWh of energy, 10 passenger-km). Heterogeneous needs such as health, household goods, education and leisure use value units: one unit is one man-hour of that need at reference prices, and each good's `unitsPerGood` equals its labor value.
- Goods that are used together, such as a car and its fuel, are bundled into a service whose recipe consumes both (car travel). Durables enter that service as a small input per use, which stands in for depreciation. The model therefore needs no complementary demand.
- Electricity is a crafted good with a spoilage of 0.3 per day and a near-zero weight. It moves over the grid like any good, but its reserve is only about a third of a day of demand, and imported power loses about a quarter on the way, which stands for grid losses.

**Calibration rule.** At labor-value prices and a purchasing power of 1, the full consumption basket should cost 70–85% of the labor available per person (`hoursPerWorkerDay × workforceShare`, 4 hours by default), and necessities should take roughly 30–40% of the basket. The rest of the labor is left for government jobs, armies and transport. The shipped catalogs use about 73% of the labor; necessities take 32% of the small basket, 29% of the medium one and 35% of the large one.
