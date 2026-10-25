[Specification](README.md) · section 7 of 11

## 7. War and conquest

War is an economic activity: soldiers are withdrawn from the workforce and paid from the treasury, wear out weapons and cut trade. Conquest happens by besieging an undefended area until it changes owner.

### Relations

Every pair of governments is at `peace` or `war`. A `declareWar` command takes effect immediately, on both sides. Peace needs a `proposePeace` command accepted by the other side; a proposal can transfer areas and include a money payment.

An edge is **blocked** when its two areas belong to governments at war, or when either area is under siege. Blocked edges carry no trade or migration. Armies still cross them.

### Militia

Every area defends itself with a militia, beside its owner's armies. `Area.militia` is `population × militiaShare` (default 2%) whenever no attacker is present. Combat depletes it, and militia losses are also losses of population. The militia has no equipment. Once it falls below one soldier and no defending army is left, the attackers besiege the area. A captured area's militia restarts, now defending its new owner. Areas can still become neutral through code paths such as peace terms in later stages; they defend with their militia alone.

### Armies

- **Recruiting** takes soldiers from the area's unemployed workers first, then from private jobs, and removes them from the population. A new army carries nothing and holds.
- **Disbanding** returns soldiers to the population of the area where the army stands (or the area it left, while marching) as unemployed workers. A fully disbanded army leaves what it carries in its government's depot there, or in the area's stock if the government does not own the area.
- **Marching** follows the fastest path by `travelDays` over active land and sea edges. Crossing an edge takes its `travelDays`; each tick an army covers `days × militaryResponsiveness` days of travel, carrying leftover days into the next edge. A new order replans from the area the army stands in or is heading to.
- **Sea crossings**, over lanes and routes, are allowed only from an area owned by the army's government with a running port (built and staffed, section 6, Infrastructure). This is checked when the path is planned and again when the army sets out; an army that can no longer embark stops. So an invasion by sea needs a friendly port to embark from. Armies never use air routes.
- **Attacking.** An army in `attack` stance attacks every area it stands in that is neutral or owned by a government at war with its own. It stays there until the area falls or the war ends, then follows the rest of its path. An army in `hold` stance never attacks and passes through.
- **Wages** of `government.soldierWage × hoursPerWorkerDay × soldiers × days` go from the treasury into the savings of the area where the army stands (or the area it left). They join the government's bill and are scaled down with it when the treasury is short (section 6, Tax collection). The player sets the wage with `setSoldierWage`.

### Equipment and desertion

- **Equipment** (phase 3). An army standing in an area of its own government takes weapons from the local depot, up to one per soldier. Carried weapons wear out at `weaponWearRatePerDay` in phase 10.
- **Desertion** (phase 7, after taxes). Soldiers desert like government workers quit: at `desertionRatePerDay × max(0, 1 − soldierWage / realm wage level, unpaid share)`, scaled by `militaryResponsiveness`. The realm wage level is the population-weighted mean `wageLevel` of the government's areas; the unpaid share is what the treasury could not pay this tick. Deserters join the population of the army's area as unemployed workers.

An army with fewer than one soldier is disbanded.

### Power

```typescript
equipment    = min(1, weapons / max(soldiers, epsilon))
powerPerSoldier = 1 + equipment                       // an equipped soldier counts double
armyPower    = soldiers * powerPerSoldier
defensePower = (sum of defending army power + militia) * (1 + runningFortLevel)   // fort level × staffed share
```

Defenders are the area's militia and its owner's armies in the area (any stance). Attackers are the attacking armies standing there (see Armies).

### Combat

Combat runs every tick in an area where attackers and defenders are both present. It is a simplified Lanchester model:

```typescript
k = combatLethalityPerDay * militaryResponsiveness * days
attackerSoldiersLost = min(attackerSoldiers, k * defensePower / attackerPowerPerSoldier)
defenderSoldiersLost = min(defenderSoldiers, k * attackPower / defenderPowerPerSoldier)
// powers per soldier are averages over each side; militia counts as defenders with power 1
// losses are shared across the armies of each side (and the militia) in proportion to their soldiers
// militia losses reduce the area's population
```

Each tick of fighting also destroys `fraction(battleStockDestructionPerDay)` of the area's stock and kills `fraction(battleCivilianLossPerDay)` of its population.

Several governments attacking the same area fight the defender together. Armies of governments at war with each other fight only in an area owned by one of them; in a neutral or third area they ignore each other.

### Siege and capture

Once no defender is left, the attacking government with the most attack power present besieges the area. It becomes `besiegingGovernment`, and the area's edges are blocked. If another government takes the lead, progress restarts from zero.

```typescript
siegeProgress += siegeRatePerDay * militaryResponsiveness * days
               * leaderAttackPower / ((1 + runningFortLevel) * max(population, 1))
```

With default values, 1,000 equipped soldiers take an unfortified area of 10,000 people in about 20 days, plus a few days to defeat its militia.

Without attackers, siege progress decays:
- by `fraction(siegeDecayRatePerDay)` per tick, scaled by `militaryResponsiveness`;
- also by 0.005 per day, so it reaches zero.

At zero, `besiegingGovernment` is cleared.

When `siegeProgress` reaches 1, the area changes owner. The same rules apply to every transfer, including peace treaties:

- The area's owner becomes the besieger, and its fortification level drops by one. Siege progress and militia are reset.
- The old owner's depot in that area is merged into the new owner's depot there.
- The old owner's government jobs and infrastructure staff there end; their workers become unemployed. Its construction there stops, and its market orders on the area are cancelled. Built levels stay, idle until the new owner hires staff.
- The new owner's realm policies apply.
- If it was the old owner's capital, the capital moves to its most populous remaining area.
- A government with no area left is eliminated:
  - its armies disband where they stand;
  - its orders, standing orders and peace proposals are dropped;
  - its `capital` becomes null.

### Peace

**Proposing.** A proposal goes from one government to another it is at war with. It lists areas, each owned by one side and going to the other, and a payment from the proposer (negative to demand one). It expires at a future game day; expired proposals are dropped in phase 0.

**Accepting.** The answer is rejected if the payer's treasury cannot cover the payment, or if a listed area has changed hands. On acceptance:
- the relation becomes `peace`;
- the listed areas are transferred with the same rules as a capture, with capitals and eliminations settled after all transfers;
- the payment moves between treasuries;
- every other pending proposal between the two governments is dropped.
