# Geographic Economics Sandbox — Design Specification

The rules of the game, one file per section. Section numbers are stable: code comments and the other documents refer to them as "specification §N". Rationale and measurements live in [design-notes.md](../design-notes.md).

| § | Section | Covers |
| --- | --- | --- |
| 1 | [Overview](01-overview.md) | Design principles |
| 2 | [Data model](02-data-model.md) | Identifiers and world, Needs and goods, Areas and edges, Governments, Armies and diplomacy, Commands, Command validation |
| 3 | [Pace, stability and convergence](03-pace-and-stability.md) | Rule 1: two separate clocks, Rule 2: rates become fractions through an exponential, Rule 3: separate the time scales, Rule 4: decide jobs on smoothed prices, Rule 5: hard limits per tick, Rule 6: start near equilibrium, then warm up, Global pace parameters, Diagnostics, WorldConfig |
| 4 | [Economy mechanics](04-economy.md) | Labor value, Value added and wages, Money circulation, Workforce, Production, Consumption, Trade, Sea and air routes, Prices, Labor allocation, Population, Map generation, Goods catalogs |
| 5 | [Government mechanics](05-government.md) | Founding, Policies, Tax collection, Market orders, Depots, Hiring and wages, Government jobs, Infrastructure, Standing orders |
| 6 | [War and conquest](06-war.md) | Relations, Militia, Armies, Equipment and desertion, Power, Combat, Siege and capture, Peace |
| 7 | [Simulation tick](07-tick.md) | — |
| 8 | [Architecture and stack](08-architecture.md) | Stack, Packages, Host loop, Messages, Encoding, Snapshots, Price table, Joining, Hosting on mobile, Save and load, Offline and install, Single player |
| 9 | [Interface](09-interface.md) | Screens, Map, Selection, Panels, Time controls, Layout |
| 10 | [AI governments](10-ai.md) | Personalities, Perception, Cadence, Memory, Economy, War and peace |
