[Specification](README.md) · section 2 of 11

## 2. Core concepts

All values are measured in **man-hours**: one hour of work at the reference level of technology. This anchors every price to labor and gives a natural measure of prosperity.

### Labor value

The labor value of a good is the man-hours embodied in one unit, inputs included. It is computed once at startup, in recipe order:

```latex
\text{laborValue}(g) = \text{laborHoursPerUnit}(g) + \sum_{i \in \text{inputs}(g)} \text{quantity}_i \times \text{laborValue}(i)
```

Labor value is the starting price of every good and the reference for price bounds and demand elasticity. Market prices then float around it according to local scarcity.

### Value added and wage level

A worker's **value added** is the market value of what they produce, minus the value of the inputs used, per hour worked. An area's **wage level** is the average value added per worker-hour across its private workers.

A wage level above 1 means local labor is worth more than the reference: good resources, good trade access or scarce products. Players see it per worker and day as the **average private wage**, beside the wage of each private job; what the workforce earns and keeps, the unemployed included, they see as gross, net and real net income (section 10, Income).

### Money circulation

An area's **savings** is the private money held by its inhabitants. Transactions inside an area cancel out, so savings change only through flows that cross the area's boundary:

| Flow | Direction | When |
| --- | --- | --- |
| Exports to neighbors, transport included | Into savings | Trade phase |
| Imports from neighbors | Out of savings | Trade phase |
| Taxes | Savings to treasury | Tax phase |
| Subsidies | Treasury to savings | Tax phase |
| Government and army wages | Treasury to savings | Tax phase |
| Government purchases on the local market | Treasury to savings | Market phase |
| Government sales on the local market | Savings to treasury | Market phase |

Taxing without spending drains an area's savings, so it can no longer import. This is intended: it is the natural cost of over-taxation.

Transport is paid by the buyer to the exporting area, whose carriers do the work, so trade between neutral areas conserves money.

Savings also feed back into demand and wages: an area holding more than its target savings spends more, mostly on comforts and luxuries, and its workers ask for more; an area with depleted savings cuts back and its workers accept less, so its goods get cheaper and sell abroad (section 5, Consumption and Labor allocation). Both pull savings back toward the target through trade.

When savings cannot cover a tax bill, the shortfall is collected **in kind**. Goods move from the area's stock to the government depot, valued at local prices.

### Time

The simulation advances in **ticks**. Each tick represents a fixed amount of game time (`gameDaysPerTick`), and every rate in the configuration is expressed per game day. Wall-clock speed only changes how many ticks run per second, never the results (section 4).
