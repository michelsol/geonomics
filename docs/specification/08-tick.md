[Specification](README.md) · section 8 of 11

## 8. Simulation tick

One tick runs eleven phases in a fixed order, and each phase runs over every area before the next one starts. Trade, migration and combat read a snapshot and apply their results together, so the outcome never depends on the order areas are processed in.

```typescript
function runTick(world: World, commands: CommandEnvelope[]): CommandRejection[] // { envelope, reason }
```

0. **Commands and automation.** Validate each command against its sender's government and apply it, in order; `runTick` returns the rejected ones with their reasons. Rebuild `resolvedPolicies` where a setting changed. Handle war declarations, peace answers and expired proposals. Evaluate AI decisions and standing orders, which produce the same effects. Recompute `Edge.isBlocked`.
1. **Production.** For each good in catalog order: primary goods with diminishing returns on natural capacity, crafted goods limited by labor and by inputs rationed between their users. Private output goes to area stock, government output to depots. Production taxes and subsidies are owed on private output. Record `produced`, `inputDemanded`, `outputLimitedByInputs` and the marginal output per worker.
2. **Government market.** Execute buy and sell orders at local prices, then the trades issued by standing orders.
3. **Consumption and army equipment.** Compute purchasing power from wage level and savings. Compute demand per need at consumer prices including consumption tax, split it between substitutes, consume from stock, then run the spillover pass. Compute `satisfaction` and `necessitySatisfaction`. Then armies standing in their own areas take weapons from the local depot.
4. **Trade.** From the snapshot, move each edge's shipping rates toward their targets and compute flows per active, non-blocked edge of every mode, good and direction, including transport and tariffs. Cap sea and air routes at their capacity and imports at the buyer's savings. Apply all goods and money movements together. Record `imported` and `exported`.
5. **Taxes, subsidies and wages.** Collect taxes from savings, with the shortfall taken in kind. Pay subsidies, government wages, infrastructure staff wages, construction payments and soldier wages from the treasury, scaled down together if the treasury is short.
6. **Prices.** Measure each good's scarcity against its stock target and flows, or for services against production and demand. Move each price toward the smoothed price times the scarcity premium, within the per-tick limit and the price bounds, then move `smoothedPrice` toward the price.
7. **Labor.** Compute value added per job from smoothed prices and production taxes, and update `wageLevel`. Move private workers toward the labor each job needs, tilted by value added against the reservation wage, within `maxLaborShiftPerTick`. Then apply hiring, quitting and firing of government workers and infrastructure staff, update each kind's staffed share, and apply soldier desertion.
8. **Military.** Move marching armies. Resolve combat in contested areas and refill the militia of areas without attackers. Advance or decay sieges. Transfer captured areas, move capitals and eliminate governments with no area left.
9. **Population.** Apply growth or starvation from `necessitySatisfaction`. Compute migration along active, non-blocked edges from the snapshot, scaled by each edge's mode, and apply it together.
10. **Decay and progress.** Spoil stock and depots, and wear out carried weapons. Regenerate natural capacity: `capacity += (maximum - capacity) × (1 - exp(-regenerationRatePerDay × days))`. Advance construction by the share of its payments made, and complete levels. If a port opened or closed, rebuild the sea routes; if an airport did, or reached the maximum level, rebuild the air routes. Then set every land edge's transport cost and every route's capacity from the running levels. Increment `tick` and add `gameDaysPerTick` to `gameDay`.

All randomness (AI choices, tie-breaks, future events) uses the seeded generator in `World.randomSeed`, so a saved game with the same command log replays identically on the same device.
