[Specification](README.md) · section 6 of 11

## 6. Government mechanics

A government touches the private economy through three channels only: policies, market orders and employment. It holds one treasury for the whole realm and one depot per owned area, because money moves instantly but goods must travel.

### Founding

A government is founded on each capital placed by map generation, in capital order.

- **Realm:** the realms split the whole map. Each area joins the capital nearest by distance over active land and sea edges, the earlier capital on a tie; an area with no such path joins the capital nearest in a straight line. No area starts neutral.
- **Color:** each realm in turn takes the palette color (12 colors) least used by its already colored neighbors, then least used overall.
- **Treasury:** starts at `startingTreasuryDays` of the realm's income, `population × workforceShare × hoursPerWorkerDay × wageLevel` summed over its areas.
- **Owned areas:** each starts with an empty depot, no jobs, a `wageOffer` of 1 and no policies.
- **Relations:** every pair of governments starts at peace.
- **Controller:** the AI, until a player takes the government over.
- **Personality:** from the game's AI mix (section 11).

### Policies

Each policy plugs into exactly one phase of the tick.

| Policy | Applies per | Phase | Effect |
| --- | --- | --- | --- |
| `productionTaxRate` | Good | Production, Labor | Taxes private output at the market price, and lowers value added, so workers leave the taxed good. Negative values are subsidies. |
| `consumptionTaxRate` | Good | Consumption | Raises the consumer price, so demand drops, mostly for elastic goods. Negative values are subsidies. |
| `importTariffRate` | Good | Trade | Added to the cost of goods entering across a border. |
| `exportTariffRate` | Good | Trade | Added to the cost of goods leaving across a border. A very high value acts as a ban. |
| `headTaxPerPersonPerDay` | Area | Taxes | Flat tax per inhabitant. Reliable revenue that drains savings and drives people away. Negative, it is an allowance paid to every inhabitant, as a subsidy. |
| `priceCeiling`, `priceFloor` | Good | Prices | Clamp the local price. Ceilings cause shortages; floors cause gluts. |

The player sets **realm policies** once and adds **area overrides** where needed.

- A per-good policy set without a good applies to every good. A setting for one good wins over a setting for every good, and an area override wins over any realm setting: settings apply in the order realm every-good, realm one-good, area every-good, area one-good.
- A setting replaces the previous setting of the same policy and good.
- In an override, a null value stands for the neutral value (no tax, no ceiling, no floor), so an override can lift a realm ceiling in one area. A null realm setting removes it.
- Clearing an override falls back to the realm setting.
- Realm settings and overrides are merged into `resolvedPolicies` only when a setting changes or an area changes owner, never during a normal tick.
- Neutral areas have all policies at zero.

### Tax collection

Taxes are owed on this tick's private output and consumption at the market price, plus the head tax:

```typescript
taxDue  = sum over goods of max(0, productionTaxRate) * privatelyProduced * price
        + sum over goods of max(0, consumptionTaxRate) * consumed * price
        + max(0, headTaxPerPersonPerDay) * population * days
subsidy = the same production and consumption terms for negative rates, as positive amounts
        + max(0, -headTaxPerPersonPerDay) * population * days     // a negative head tax: an allowance
// tariffs were already collected in money during trade

paidInMoney = min(taxDue, area.savings)
shortfall   = taxDue - paidInMoney
// shortfall taken in kind: goods move from area stock to the depot, highest price first, valued at local price
```

The **bill** of a government is the subsidies and wages it owes this tick:
- the subsidies of every owned area;
- government wages, `workers × wageOffer × hoursPerWorkerDay × days` per job.

It is paid from the treasury after taxes are collected. If the treasury cannot pay the whole bill, every payment is scaled by the same `paidShare = treasury / bill`.

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
wageAttractiveness = wageOffer / max(area.wageLevel, epsilon)
if (targetWorkers < workers)
  workers = targetWorkers                                            // firing is instant
workers -= workers * fraction(quitRatePerDay) * max(0, 1 - wageAttractiveness, 1 - paidShare)
if (targetWorkers > workers && wageAttractiveness >= 1)
  workers += fraction(hiringRatePerDay) * (targetWorkers - workers)   // capped by available workforce
```

- Hiring, quitting and firing use `economyResponsiveness`.
- Fired and quitting workers return to `unemployedWorkers`.
- A job whose target and workers are both zero is removed.
- If the area's workforce shrinks below its government workers, they are scaled down to fit.

### Government jobs

| Job | Effect |
| --- | --- |
| `produce` | Produces a good with the normal recipe in phase 1. On a primary good, government and private workers share the natural capacity and its output in proportion to workers. A crafted good draws its inputs from the depot, rationed between the government's recipes like private inputs, and adds its output to the depot. |
| `buildInfrastructure` | Adds worker-days to an adjacent land edge. Each `infrastructureWorkerDaysPerStep` multiplies its transport cost by `infrastructureStepFactor`, down to `minimumTransportCostFactor` of the base. |
| `fortify` | Adds worker-days toward the next fortification level of the area, up to `maximumFortificationLevel`. |
| `buildPort` | Coastal areas only. Each `portWorkerDaysPerLevel` raises `portLevel` by one, up to `maximumPortLevel`, which raises the capacity of the area's sea routes. |
| `buildAirport` | Each `airportWorkerDaysPerLevel` raises `airportLevel` by one, up to `maximumAirportLevel`. The first level opens air routes; the maximum level makes the airport a hub. |

Worker-days are `workers × days`, accumulated in phase 10.

### Standing orders

Standing orders are rules evaluated at the start of every tick, in each area they name (`"all"` meaning every owned area). Each one issues the same effects a player command would. They keep a large realm manageable, and AI governments are built almost entirely from them.

| Rule | Issues this tick |
| --- | --- |
| `keepDepotStock` | A buy of `targetDaysOfDemand × inhabitants' daily demand − depot`, at most `maximumBuyPrice` |
| `sellAbovePrice` | A sale of `depot − keepDaysOfDemand × inhabitants' daily demand`, at least `minimumPrice` |
| `buyBelowPrice` | A buy of `maximumDepotQuantity − depot`, at most `maximumPrice` |

Their trades execute in the market phase like market orders. Each trade is paced at `standingOrderShareOfDemandPerDay` of the inhabitants' daily demand for the good, of its daily production, or of the trade's own quantity, whichever is largest. The last keeps orders working for goods nobody else uses, such as weapons.
