[Specification](README.md) · section 5 of 10

## 5. Government mechanics

A government touches the private economy through three channels only: policies, market orders and employment. It holds one treasury for the whole realm and one depot per owned area, because money moves instantly but goods must travel.

### Founding

A government is founded on each capital placed by map generation, in capital order.

- **Realm:** the realms split the whole map. Each area joins the capital nearest by distance over active land and sea edges, the earlier capital on a tie; an area with no such path joins the capital nearest in a straight line. No area starts neutral.
- **Color:** each realm in turn takes the palette color (12 colors) least used by its already colored neighbors, then least used overall.
- **Treasury:** starts at `startingTreasuryDays` of the realm's income, `population × workforceShare × hoursPerWorkerDay × averageWage` summed over its areas.
- **Owned areas:** each starts with an empty depot, no jobs, a `wageOffer` of 1, no policies, and its built infrastructure as its target.
- **Infrastructure:** each coastal area gets a port of level 1 with chance `startingPortShare`, drawn from the seeded generator in area order, and each realm an airport of level 1 in its capital and then its most populous areas, up to `startingAirports`. A landmass left without any port gets one in its most populous coastal area, so no island is cut off. Then the routes are built and every starting level is fully staffed from the workforce.
- **Relations:** every pair of governments starts at peace.
- **Controller:** the AI, until a player takes the government over.
- **Personality:** from the game's AI mix (section 10).

### Policies

Each policy plugs into exactly one phase of the tick.

| Policy | Applies per | Phase | Effect |
| --- | --- | --- | --- |
| `incomeTaxRate` | Wage band (or every band) | Consumption, Taxes, Labor | A share of the wages of each wage band (section 4, Consumption): it lowers what the band's workers buy, and what a job is worth to them, so workers leave jobs it pushes below the reservation wage. Negative values top wages up, paid by the treasury. |
| `unemployedTaxPerDay` | Area | Consumption, Taxes, Labor | Man-hours per unemployed worker per day. Negative, it is a **benefit** paid to every unemployed worker: it adds to what they buy, and raises the wage workers ask for. Shown as the unemployed row of the income tax. |
| `consumptionTaxRate` | Good | Consumption | Raises the consumer price, so demand drops, mostly for elastic goods. Negative values are subsidies. It is the tax on final purchases, as a value-added tax would be. |
| `importTariffRate` | Good | Trade | Added to the cost of goods entering across a border. |
| `exportTariffRate` | Good | Trade | Added to the cost of goods leaving across a border. A very high value acts as a ban. |
| `headTaxPerPersonPerDay` | Area | Taxes | Flat tax per inhabitant. Reliable revenue that drains savings and drives people away. Negative, it is an allowance paid to every inhabitant, as a subsidy. |
| `staffWageShare` | Area | Taxes, Labor | Infrastructure staff pay as a share of the area's average wage (`defaultStaffWageShare` when unset). Staff come at 1 or more and leave below it (Infrastructure). |
| `priceCeiling`, `priceFloor` | Good | Prices | Clamp the local price. Ceilings cause shortages; floors cause gluts. |

The player sets **realm policies** once and adds **area overrides** where needed.

- A per-good policy set without a good applies to every good. A setting for one good wins over a setting for every good, and an area override wins over any realm setting: settings apply in the order realm every-good, realm one-good, area every-good, area one-good.
- A setting replaces the previous setting of the same policy and good.
- In an override, a null value stands for the neutral value (no tax, no ceiling, no floor), so an override can lift a realm ceiling in one area. A null realm setting removes it.
- Clearing an override falls back to the realm setting.
- Realm settings and overrides are merged into `resolvedPolicies` only when a setting changes or an area changes owner, never during a normal tick.
- Neutral areas have all policies at zero, and no infrastructure staff.

### Tax collection

Taxes are owed on this tick's wages and consumption, plus the unemployed and head taxes. The wage bands are those of this tick's consumption phase:

```typescript
taxDue  = sum over bands of max(0, incomeTaxRate) * bandWages * hoursPerWorkerDay * days
        + sum over goods of max(0, consumptionTaxRate) * consumed * price
        + max(0, unemployedTaxPerDay) * unemployedWorkers * days
        + max(0, headTaxPerPersonPerDay) * population * days
subsidy = the same income, consumption, unemployed and head terms for negative values, as positive amounts:
          wage top-ups, consumption subsidies, benefits for the unemployed and allowances
// tariffs were already collected in money during trade

paidInMoney = min(taxDue, area.savings)
shortfall   = taxDue - paidInMoney
// shortfall taken in kind: goods move from area stock to the depot, highest price first, valued at local price
```

The **bill** of a government is the subsidies, wages and construction payments it owes this tick:
- the subsidies of every owned area;
- government wages, `workers × wageOffer × hoursPerWorkerDay × days` per job;
- infrastructure staff wages, `staff × staffWageShare × max(averageWage, 0) × hoursPerWorkerDay × days` per kind;
- construction payments, `n × costPerLevel / buildDaysPerLevel × days` per kind building its level `n`;
- soldiers' wages (section 6, Armies).

It is paid from the treasury into the areas' savings after taxes are collected. If the treasury cannot pay the whole bill, every payment is scaled by the same `paidShare = treasury / bill`.

### Market orders

The government is a price taker on its own areas' markets. Orders execute in the market phase, after production and before consumption, in order id order, followed by the trades issued by standing orders.

```typescript
// Buy order
if (price <= limitPrice)
  wanted   = min(remainingQuantity, maximumQuantityPerDay * days, treasury / price)
  governmentDemanded += wanted                    // counts in total demand, so producers grow to supply it
  quantity = min(wanted, max(0, stock - reserveDaysOf(good) * inhabitantsDemandedPerTick / days))
  // goods: area stock -> depot; money: treasury -> area savings

// Sell order
if (price >= limitPrice)
  quantity = min(remainingQuantity, maximumQuantityPerDay * days, depot, area.savings / price)
  // goods: depot -> area stock; money: area savings -> treasury
```

`inhabitantsDemandedPerTick` is total demand without `governmentDemanded`, so a government never takes the reserve its inhabitants keep. A completed order is removed; an order on an area the government no longer owns is cancelled.

A purchase lowers stock, so the price rises in the next price phase. Buying cheaply in good years and selling during a famine is a core strategy.

### Depots

Each owned area has a depot, filled by market purchases, government production jobs and taxes taken in kind, and emptied by sales and by armies taking weapons. Goods in depots spoil like any stock. Goods do not move between depots.

### Hiring and wages

The player sets a target number of workers per job and a wage offer per area. Workers come from `unemployedWorkers` first, then proportionally from private jobs.

```typescript
wageAttractiveness = wageOffer / max(area.averageWage, epsilon)
if (targetWorkers < workers)
  workers = targetWorkers                                            // firing is instant
workers -= workers * fraction(quitRatePerDay) * max(0, 1 - wageAttractiveness, 1 - paidShare)
if (targetWorkers > workers && wageAttractiveness >= 1)
  workers += fraction(hiringRatePerDay) * (targetWorkers - workers)   // capped by available workforce
```

- Hiring, quitting and firing use `economyResponsiveness`.
- Fired and quitting workers return to `unemployedWorkers`.
- A job whose target and workers are both zero is removed.
- If the area's workforce shrinks below its government workers and infrastructure staff, they are all scaled down to fit.

### Government jobs

The one job is `produce`: it produces a good with the normal recipe in phase 1. On a primary good, government and private workers share the natural capacity and its output in proportion to workers. A crafted good draws its inputs from the depot, rationed between the government's recipes like private inputs, and adds its output to the depot.

### Infrastructure

Each owned area has four kinds of infrastructure, each at a level from 0 (none) to `maximumLevel`:

| Kind | Effect of its running level |
| --- | --- |
| Port | Coastal areas only. Each level adds `seaCapacityPerPortLevel` to the area's sea routes; armies embark only from a running port (section 4, Sea and air routes). The port also works the sea: see Waters below. |
| Airport | Each level adds `airCapacityPerAirportLevel` to the area's air routes; the first level opens air routes, the maximum level makes the airport a hub. |
| Roads | A land edge's transport cost is `baseTransportCost × (1 − (1 − minimumTransportCostFactor) × mean of its two areas' running road levels / maximumLevel)`. |
| Fort | Defense is multiplied by `1 + running fort level` (section 6, Combat and Siege). |

- **Building.** `setInfrastructureTarget` sets the level to build up to. Levels are built one at a time: level `n` takes `buildDaysPerLevel` days and costs `n × costPerLevel`, paid in equal parts every day into the area's savings as part of the bill. When the treasury pays only `paidShare` of the bill, construction advances by `paidShare × days`. A level is complete in phase 10 when its days are done; construction stops at the target.
- **Taking down.** A target below the built level lowers it at once, for free, and stops construction of that kind. Staff beyond the new quota become unemployed at once.
- **Staff.** Each built level needs `staffPerLevel` workers. They are hired, quit and fired in phase 7 like government workers (Hiring and wages), with the staff wage `staffWageShare × averageWage` as their offer, so their attractiveness is `staffWageShare`: they come while it is at least 1, and quit at the shortfall or the unpaid share, whichever is larger.
- **Running level.** The staffed share is `min(1, staff / quota)`, and the running level is the built level times the staffed share. Half the staff gives half the effect.
- **Waters.** A port of built level `L` reaches every water cell within `L` hops over water of its area, a cell touching the area being one hop away. A cell reached by several ports is shared equally between them, whether or not they run: each area works `1 / (ports reaching it)` of its capacity, at its port's staffed share (section 4, Production). The reach changes only when port levels do. Without a port, an area works no water cell.
- **Captures.** Built levels stay with the area (a fort loses one level). The old owner's staff become unemployed and its construction stops; the infrastructure stands idle until the new owner hires staff.

### Standing orders

Standing orders are rules evaluated at the start of every tick, in each area they name (`"all"` meaning every owned area). Each one issues the same effects a player command would. They keep a large realm manageable, and AI governments are built almost entirely from them.

| Rule | Issues this tick |
| --- | --- |
| `keepDepotStock` | A buy of `targetDaysOfDemand × inhabitants' daily demand − depot`, at most `maximumBuyPrice` |
| `sellAbovePrice` | A sale of `depot − keepDaysOfDemand × inhabitants' daily demand`, at least `minimumPrice` |
| `buyBelowPrice` | A buy of `maximumDepotQuantity − depot`, at most `maximumPrice` |

Their trades execute in the market phase like market orders. Each trade is paced at `standingOrderShareOfDemandPerDay` of the inhabitants' daily demand for the good, of its daily production, or of the trade's own quantity, whichever is largest. The last keeps orders working for goods nobody else uses, such as weapons.
