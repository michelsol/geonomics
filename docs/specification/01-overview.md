[Specification](README.md) · section 1 of 11

## 1. Overview

A real-time sandbox where players run governments over regions of a map of areas, on top of a lightweight economy that runs by itself. Each area produces, consumes, trades, sets prices, allocates labor and grows or shrinks its population every tick. Governments act on that economy through taxes, subsidies, market orders, employment and war.

The game runs in a browser, on desktop or mobile. The first human player hosts the game and runs the simulation; other humans join through a link, and AI governments run on the host.

### Design principles

- **Areas, not individuals.** Each area is simulated as a whole. Inhabitants are a number, not agents.
- **One feedback loop drives everything.** Prices signal scarcity, labor moves toward the jobs that add the most value, and goods flow from cheap areas to expensive ones.
- **Cheap per tick.** Cost is roughly proportional to (areas + edges) × goods. A few thousand areas must run comfortably on a phone.
- **The government is a separate actor.** The base economy runs with no players at all. Human and AI governments use the same command interface.
- **Open prices.** Every player, human or AI, sees the current price of every good in every area. Stocks, flows and government internals stay private. Markets themselves stay local: an area trades only with the areas its edges connect it to.
- **Stability before realism.** Every adjustment is damped, bounded and scaled by global pace parameters (section 4).
- **Sandbox first.** There is no mandatory win condition; goals can be layered on later.
