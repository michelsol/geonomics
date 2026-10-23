# Geographic Economics Sandbox — Design Specification

The rules of the game, one file per section. Section numbers are stable: code comments and the other documents refer to them as "specification §N". Rationale and measurements live in [design-notes.md](../design-notes.md), and the build order in [roadmap.md](../roadmap.md).

| § | Section | Covers |
| --- | --- | --- |
| 1 | [Overview](01-overview.md) | Design principles |
| 2 | [Core concepts](02-core-concepts.md) | Labor value, Value added and wage level, Money circulation, Time |
| 3 | [Data model](03-data-model.md) | Identifiers and world, Needs and goods, Areas and edges, Governments, Armies and diplomacy, Commands, Command validation |
| 4 | [Pace, stability and convergence](04-pace-and-stability.md) | Rule 1: two separate clocks, Rule 2: rates become fractions through an exponential, Rule 3: separate the time scales, Rule 4: decide jobs on smoothed prices, Rule 5: hard limits per tick, Rule 6: start near equilibrium, then warm up, Global pace parameters, Diagnostics, WorldConfig |
| 5 | [Economy mechanics](05-economy.md) | Workforce, Production, Consumption, Trade, Sea and air routes, Prices, Labor allocation, Population, Map generation, Goods catalogs |
| 6 | [Government mechanics](06-government.md) | Founding, Policies, Tax collection, Market orders, Depots and transfers, Hiring and wages, Government jobs, Standing orders |
| 7 | [War and conquest](07-war.md) | Relations, Militia, Armies, Equipment and desertion, Power, Combat, Siege and capture, Peace |
| 8 | [Simulation tick](08-tick.md) | — |
| 9 | [Architecture and stack](09-architecture.md) | Stack, Packages, Host loop, Messages, Encoding, Snapshots, Price table, Joining, Hosting on mobile, Save and load, Offline and install, Single player |
| 10 | [Interface](10-interface.md) | Screens, Map, Panels, Time controls, Layout |
| 11 | [AI governments](11-ai.md) | Personalities, Perception, Cadence, Memory, Economy, War and peace |
