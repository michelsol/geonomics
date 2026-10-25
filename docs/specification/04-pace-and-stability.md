[Specification](README.md) · section 4 of 11

## 4. Pace, stability and convergence

Instability comes from feedback loops that overshoot: prices jump, too many workers switch, supply crashes, and the cycle repeats. Six rules prevent it, and three global pace parameters let a game run calmer or faster without retuning anything.

### Rule 1: two separate clocks

- `maxTicksPerSecond` is the **wall-clock** speed of the host loop. Changing it (pause, 1×, 5×) never changes results, only how fast they arrive.
- `gameDaysPerTick` is the **game time** each tick represents. Every rate in the configuration is per game day and is scaled by it.

### Rule 2: rates become fractions through an exponential

Every "move toward a target" update uses a fraction derived from a rate per day:

```latex
\text{fraction} = 1 - e^{-\text{rate} \times \text{responsiveness} \times \text{gameDaysPerTick}}
```

The update is then `value += fraction × (target − value)`. The fraction always stays between 0 and 1, so the value can never jump past its target, whatever the tick length or responsiveness. Prices use the multiplicative form `price × e^(clamped change)` for the same reason.

Write this once as a helper, `fractionPerTick(ratePerDay, responsiveness)`, and use it everywhere.

### Rule 3: separate the time scales

Each loop must react at least three times slower than the loop it depends on. Fast loops settle before slow loops act on them.

| Loop | Parameter | Default half-life |
| --- | --- | --- |
| Prices | `priceAdjustmentRatePerDay` | 2 days |
| Trade flows | `tradeRatePerDay` | 3 days |
| Smoothed price used for jobs | `priceSmoothingRatePerDay` | 10 days |
| Private job allocation | `laborMobilityRatePerDay` | 10 days |
| Migration | `migrationRatePerDay` | about 70 days |
| Population growth | `growthRatePerDay` | about 19 years to double |

A rate from a half-life: `rate = ln(2) / halfLifeDays`.

### Rule 4: decide jobs on smoothed prices

Workers choose jobs from `smoothedPrice`, a slow moving average, not from the current price. This breaks the classic cobweb cycle, where a one-day price spike pulls in workers who then flood the market.

### Rule 5: hard limits per tick

Even with damping, a guard rail catches surprises:

- A price changes by at most `maxPriceChangePerTick` (default 10%) in one tick.
- Prices stay between `priceFloorMultiple` and `priceCeilingMultiple` times the labor value (defaults 0.1 and 10).
- At most `maxLaborShiftPerTick` of a workforce (default 2%) changes jobs in one tick.
- Stocks, savings, depots and populations are clamped at zero; every division uses a small epsilon.

### Rule 6: start near equilibrium, then warm up

A game starts from a state that is already almost balanced:

1. Prices start at labor value; smoothed prices equal prices.
2. Workers are allocated to cover local demand where local resources allow. The rest stay unemployed: by the calibration rule that is about a quarter of the workforce, the pool government jobs and armies hire from.
3. Each area starts with `reserveDaysOf(good)` of total demand in stock.
4. Each area starts with `targetSavingsDays` of income in savings, so savings neither boost nor dampen demand at first.
5. Value added and `wageLevel` are computed once from these starting prices and workers, so the first tick has valid purchasing power and labor targets.
6. The world then runs `warmupDays` with no players and no AI decisions, at `warmupResponsivenessBoost` times the normal economy responsiveness and with population frozen (demography responsiveness 0), before the game opens.

### Global pace parameters

Three multipliers change the feel of a game without touching individual rates:

- `economyResponsiveness` scales prices, trade, smoothing and labor. Lower is calmer and more stable; higher is snappier.
- `demographyResponsiveness` scales population growth, starvation and migration.
- `militaryResponsiveness` scales marching, combat and sieges.

To speed up a whole game, raise `gameDaysPerTick` or `maxTicksPerSecond`. To make the economy react faster relative to game time, raise `economyResponsiveness`. Rule 2 keeps both safe.

### Diagnostics

A headless runner (Node) simulates thousands of days and reports, per area and good:

- **Price volatility:** standard deviation of daily log price changes over the last 30 days.
- **Oscillation count:** number of times the direction of a price changes over the last 30 days, ignoring daily moves under 0.1%.
- **Unmet necessities:** share of necessity demand not met.
- **Labor churn:** share of the workforce changing jobs per day.

Two regression scenarios must converge: two areas with complementary resources (price gap settles near transport cost within 60 days), and a 10-area chain (prices settle along a smooth gradient within 200 days). A buyer that imports all it uses settles at a gap of `1 / (reserveDaysOf(good) × tradeGapSensitivity)` of its price above transport.

### WorldConfig

Defaults are starting points for tuning in the headless runner.

```typescript
interface WorldConfig {
  pace: {
    maxTicksPerSecond: number;          // wall-clock cap of the host loop (default 10); games start lower, at 2 on phones and 5 elsewhere
    gameDaysPerTick: number;            // game days simulated per tick (default 1)
    economyResponsiveness: number;      // multiplier on price, trade, smoothing and labor rates (default 1)
    demographyResponsiveness: number;   // multiplier on growth, starvation and migration rates (default 1)
    militaryResponsiveness: number;     // multiplier on marching, combat and siege rates (default 1)
  };
  economy: {
    hoursPerWorkerDay: number;          // hours worked per worker per game day (default 8)
    workforceShare: number;             // share of the population able to work (default 0.5)
    reserveDays: number;                // days of total demand an area keeps in stock before exporting (default 5)
    maxReserveSpoilageShare: number;    // perishable goods keep a smaller reserve, so spoilage stays under this share of demand (default 0.1)
    priceAdjustmentRatePerDay: number;  // speed at which the price moves toward the smoothed price times the scarcity premium (default 0.35)
    priceSmoothingRatePerDay: number;   // speed of the smoothed price, the long-run price that jobs follow (default 0.07)
    scarcityPremium: number;            // log premium of the price over the smoothed price at full shortage, discount at full glut (default 0.1)
    priceFlowWeight: number;            // weight of the flow imbalance next to the stock gap in price pressure (default 0.3)
    tradeRatePerDay: number;            // speed at which an edge's shipping rate moves toward its target (default 0.23)
    tradeGapSensitivity: number;        // share of its reserve a buyer imports per day over one edge, per unit of relative price gap (default 20)
    exportReserveShare: number;         // share of its own reserve an area keeps when exporting (default 0.5)
    tradeMargin: number;                // smallest price gap worth trading for, as a share of the higher price (default 0.01)
    laborMobilityRatePerDay: number;    // speed at which private workers move toward the target allocation (default 0.07)
    laborAllocationTemperature: number; // softness of the value-added tilt on labor targets, relative to the reservation wage (default 1)
    reservationWage: number;            // value added per hour below which workers prefer unemployment, at target savings, in man-hours (default 1)
    stockRecoveryDays: number;          // labor plans to bring a stock back to its reserve over this many days (default 5)
    maxPriceChangePerTick: number;      // largest relative price change in one tick (default 0.1)
    maxLaborShiftPerTick: number;       // largest share of a workforce changing jobs in one tick (default 0.02)
    priceFloorMultiple: number;         // lowest price as a multiple of labor value (default 0.1)
    priceCeilingMultiple: number;       // highest price as a multiple of labor value (default 10)
    tierWeights: { necessity: number; comfort: number; luxury: number }; // weights in satisfaction (default 3, 2, 1)
    targetSavingsDays: number;          // days of income inhabitants like to hold; neutral point of the savings effect (default 30)
    savingsElasticity: number;          // how strongly savings above or below target change purchasing power (default 0.5)
    savingsFactorMin: number;           // lower clamp of savings relative to target (default 0.05)
    savingsFactorMax: number;           // upper clamp of savings relative to target (default 16)
  };
  transport: {                          // distances in map units; neighboring areas are about 100 apart (read as km)
    landCostPerDistance: number;        // map generation: base land cost per tonne per unit of distance, before terrain (default 0.003)
    seaCostPerDistance: number;         // man-hours per tonne per unit of sea distance (default 0.0004)
    airBaseCost: number;                // man-hours per tonne per flight, whatever the distance (default 3)
    airCostPerDistance: number;         // man-hours per tonne per unit of distance flown (default 0.02)
    seaRoutesPerPort: number;           // sea lanes from each coast, and sea routes from each port, to this many nearest (default 4)
    airRoutesPerAirport: number;        // each airport links to this many nearest airports (default 3)
    seaCapacityPerPortLevel: number;    // tonnes per day per direction on a sea route, per level of its smaller port (default 1000)
    airCapacityPerAirportLevel: number; // tonnes per day per direction on an air route, per level of its smaller airport (default 20)
    seaTravelDaysPerDistance: number;   // game days an army needs per unit of sea distance (default 0.01)
    migrationFactorBySea: number;       // migration over a sea route, relative to a land edge (default 0.5)
    migrationFactorByAir: number;       // migration over an air route, relative to a land edge (default 0.25)
  };
  population: {
    growthRatePerDay: number;           // relative growth per day at full necessity satisfaction (default 0.0001)
    starvationRatePerDay: number;       // relative decline per day when no necessity is met (default 0.003)
    growthSatisfactionThreshold: number;// necessity satisfaction above which population grows (default 0.9)
    migrationRatePerDay: number;        // share of the attractiveness gap that migrates per day (default 0.01)
    migrationWageWeight: number;        // weight of wage level versus satisfaction in attractiveness (default 0.5)
  };
  government: {
    hiringRatePerDay: number;           // share of the gap to target government jobs filled per day (default 0.1)
    quitRatePerDay: number;             // quitting speed per unit of wage shortfall or unpaid share (default 0.1)
    startingTreasuryDays: number;       // starting treasury, in days of the realm's income (default 30)
    standingOrderShareOfDemandPerDay: number; // pacing of standing orders, as a share of the area's daily demand (default 0.2)
  };
  infrastructure: {
    maximumLevel: number;               // highest level of every kind; airports at this level link to each other as hubs (default 3)
    costPerLevel: Record<InfrastructureKind, number>;      // man-hours: building level n costs n times this (port 150,000; airport 300,000; roads 60,000; fort 80,000)
    buildDaysPerLevel: Record<InfrastructureKind, number>; // game days to build one level (port 60, airport 90, roads 45, fort 30)
    staffPerLevel: Record<InfrastructureKind, number>;     // workers each built level needs to run (port 100, airport 150, roads 25, fort 50)
    defaultStaffWageShare: number;      // staff pay as a share of the local wage level, where no policy sets it (default 1.1)
    minimumTransportCostFactor: number; // land transport cost between two areas with roads at the maximum level (default 0.3)
    startingPorts: number;              // ports of level 1 each realm starts with (default 2)
    startingAirports: number;           // airports of level 1 each realm starts with (default 1)
  };
  network: {
    priceTableRate: number;             // global price table broadcasts per wall-clock second (default 1)
    snapshotRate: number;               // snapshots per wall-clock second for owned areas and the viewport (default 3)
  };
  military: {
    weaponsGood: GoodId;                // good soldiers are equipped with; taken from the goods catalog
    weaponWearRatePerDay: number;       // share of carried weapons worn out per day (default 0.005)
    desertionRatePerDay: number;        // share of soldiers leaving per day per unit of wage shortfall or unpaid share (default 0.05)
    soldierWage: number;                // starting soldier wage of every government, per soldier-hour, in man-hours (default 1.5)
    combatLethalityPerDay: number;      // losses per day per unit of enemy power over own power per soldier (default 0.05)
    militiaShare: number;               // share of an area's population that defends it as militia (default 0.02)
    siegeRatePerDay: number;            // siege progress per day per unit of power per inhabitant (default 0.25)
    battleStockDestructionPerDay: number; // share of an area's stock destroyed per day of fighting (default 0.02)
    battleCivilianLossPerDay: number;   // share of an area's population lost per day of fighting (default 0.002)
    siegeDecayRatePerDay: number;       // speed at which siege progress decays once the attackers leave (default 0.1)
  };
  map: {                                // map generation (section 5, Map generation)
    landAreaCount: number;              // areas on a generated map (default 1000)
    cellSpacing: number;                // average distance between neighboring cell centers, in km (default 100)
    landShare: number;                  // share of the cells that are land (default 0.45)
    elevationOctaves: number;           // octaves of the elevation noise (default 4)
    meanAreaPopulation: number;         // average starting population of an area (default 10000)
    capacityHeadroom: number;           // world capacity of a primary good as a multiple of its reference demand (default 2.5)
    presence: { common: number; regional: number; rare: number }; // share of eligible areas holding a primary good (default 0.85, 0.3, 0.08)
    extractionLaborShare: number;       // producing areas of a primary good could supply the world with this share of their labor (default 0.1)
    governmentCount: number;            // realms founded, which split the whole map; chosen by the player (default 6)
    minimumIslandAreas: number;         // smaller islands sink (default 2)
  };
  warmupDays: number;                   // game days simulated with no players before the game opens (default 180)
  warmupResponsivenessBoost: number;    // responsiveness multiplier during warm-up (default 3)
}
```
