[Specification](README.md) · section 10 of 11

## 10. Interface

The interface is map-first: the map fills the screen and panels sit beside it on desktop, or below it on a phone. It reads only what a snapshot and the price table carry, so a joined player sees exactly what a solo player sees.

### Screens

1. **Join.** Opening a join link asks for the player's name, then connects; a reload of the same tab rejoins without asking. The host's refusal or an unreachable host is shown.
2. **New game.** The menu lists the games saved in this browser (title, day, map, save time) with Continue and Delete, offers Load from file, a How to play link, and, when a new version of the app is installed, a Reload button. For a new game, the player picks a catalog (small, medium or large), a map size (300, 1,000 or 3,000 areas), the number of realms (4, 6, 8, 12, 16, 24 or 32, at most one per 8 areas; default 8), the AI's personality mix (balanced, peaceful or aggressive; section 11) and a seed. The map is then generated and warmed up in the worker, behind a progress bar. Finally comes the **lobby**: the founded governments with capital, population, area count, and the player holding each or its AI personality. Each player picks a free realm, takes a random one or watches. The host can invite players there (a join link with a Copy button), see who is online, and release the realm of a player who went offline. The host's pick starts the game; a joined player enters once the host accepts its pick.
   A loaded game skips generation and goes straight to the lobby.
3. **How to play.** A short guide: the idea, the map, the economy, running the realm, war and peace, the AI realms, playing with friends, saving, and phones.
4. **Game.** The map, the top bar and the panels.
5. **End of session.** Shown when the player's government is eliminated, or when the player ends the game. It lists days played, peak and final population, areas held and treasury, and offers a new game. There is no score.

### Map

Areas are the Voronoi cells of their positions, with the water cells around them.

| Layer | Colors each area by |
| --- | --- |
| Realms | Owner color; neutral areas in grey. Realm borders are drawn on every layer |
| Population | Population, one hue on a log scale between the map's smallest and largest areas |
| Prices | The chosen good's price over its labor value, on a log scale from blue (cheap) through white to red (dear) |
| Resources | The chosen good's maximum natural capacity, brighter for more, relative to the best area; grey where there is none |
| Satisfaction | Necessity satisfaction, from red (0) to green (1) |
| Average wage | Wage level (mean value added per private worker-hour) on a log scale |
| Terrain | Terrain type |

**Flows** are a separate choice, drawn over any layer:

| Flows | Draws |
| --- | --- |
| None | Nothing (the default) |
| Migration | An arrow per edge for the net migrants of the last tick |
| Transport | An arrow per edge and direction for the goods carried in the last tick: every good in tonnes, or one good chosen in the legend in its own units |

**Flow arrows** run from 20% to 80% of the segment between two area centers, with a dark outline. Their width grows from 1 to 6 px with the square root of the flow over the largest flow on the map. Transport arrows sit to the right of their direction, so the two directions of an edge stay apart. Flows under 3% of the largest are left out, as are arrows with less than 14 px of room on screen (they appear when zooming in), and at most the 2,500 largest flows are drawn. The legend shows sample arrows with their values.

One layer and one flow choice are active at a time, each with its own legend, stacked bottom left. Every layer also shows:

- **Routes:** sea routes dashed, air routes dotted; blocked edges red.
- **Capitals:** a star.
- **Armies:** a marker in their government's color, with their remaining path.
- **Sieges:** a ring showing their progress.
- **Selection:** the selected area is outlined.

Mouse or one finger pans and the wheel or a pinch zooms around the pointer. A click or tap selects the area under it. While the player moves an army or picks areas for a peace proposal, a click picks the target instead.

### Selection

- **One area.** A click or tap selects the area under it, alone; Escape or Clear empties a selection of several.
- **Regions.** A double click or double tap starts a polygon at that point. Each tap adds a corner, drawn as a dashed line with a dot; a tap within 20 px of the first corner (drawn as a ring), or Done, closes it once it has three corners, and selects every area whose center lies inside. Dragging and pinching still pan and zoom while drawing; Cancel or Escape stops.
- **Several polygons.** With several areas selected, a new polygon adds its areas to the selection; a switch in the banner makes it remove them instead. With one area or none, a polygon replaces the selection. The double tap's first tap does not change the selection the polygon builds on.
- **Single areas.** Shift-, Ctrl- or Cmd-click adds or removes one area. The Area panel's My realm button selects every area of the player's realm.
- **Drawing.** Selected areas are outlined; with several, each is also lightly filled. A banner shows how many are selected.
- **Totals.** With several areas selected, the Area panel shows the owners and how many areas each holds, total population, militia, savings and unemployed, population-weighted average wage, satisfaction and necessities met, the hardest area to conquer, summed natural capacities, and the market: mean prices, and stock, production, use and net trade summed (trade between two selected areas cancels out). Stocks, flows, savings and unemployment cover only the areas whose detail the snapshot carries, which the panel says. The Good section shows the selection's mean price and records its history.
- **Region actions.** When at least two of the player's areas are selected, the Policies, standing orders, Jobs and Armies panels offer the selection as a scope, over the player's selected areas:
  - **Rates and prices** (taxes, tariffs, price controls, wage offers) are set to the same value in each area, and the setting in force reads "varies by area" when they differ.
  - **Amounts** (workers to hire, recruits) are totals, split over the areas by population, in whole numbers that add up to the total. A port job goes over the coastal areas only; a road job over the land edges inside the selection, evenly. Recruits make one army per area that gets any.
  - Jobs show one line per job across the selection, with summed workers and target; a new target is split again.
  - A peace proposal can take the selection as its areas.

### Panels

| Panel | Shows | Actions |
| --- | --- | --- |
| Area | One view for one selected area or several (see Selection). A header with My realm, Center (the selection, or the capital when nothing is selected) and, for several areas, Clear; it stays when nothing is selected. The area's name, owner and terrain, or the number of areas and their owners. One grid of figures: population, average wage per day (mh/day), necessities met, satisfaction, port, airport and fortification levels (one area), savings per person and unemployed (areas seen in detail), siege, militia, defense power, and for areas not the player's the equipped soldiers needed to conquer. Each figure explains itself on hover; the panel has no explanatory paragraphs. Natural resources: maximum capacity, and current capacity, extraction and use where detail is sent. The market: price, stock, production, consumption and trade per good where detail is sent, prices only elsewhere. For own areas, the depot's contents and the goods on their way to it. At the bottom, one good across the world: lowest, median and highest price with their areas, and a chart over time of these and the selection's price | Sort the market table by any column; send goods between depots; choose the good and show it on the price map |
| Policies | Every tax and price control, realm-wide and per area; the setting in force for the chosen area, policy and good; standing orders | Set or remove a policy for all areas or one area, and for one good or all goods. The production tax is chosen first. Taxes and tariffs have a slider from −100% to +100% (the number field takes up to 500%), head tax one from 0 to 2 mh per person per day; ceilings and floors take a number. The value starts at the setting in force, and Set applies it. Add and remove standing orders |
| Jobs | For one own area or the whole realm: the workforce split between private jobs, government jobs and unemployment, and private workers, output per day and output per worker by good. Per own area: each job's target and workers, and the wage offer | Set job targets and wage offers |
| Armies | Soldier wage, realm average wage, soldiers and their pay per day; weapons in depots and being bought; each army's soldiers, equipment, power, stance, location and path | Set the soldier wage, recruit, buy weapons, set stance, move (then pick the destination on the map), disband |
| Diplomacy | Relations with every government, with who runs each (a player, "AI · personality", or an offline player's realm run by the AI), pending proposals | Declare war; propose peace (payment and areas picked on the map); accept or refuse proposals |
| Game (last tab) | The players and their realms, online or not | Invite players and release offline players' realms (host); export the save (host); end the game, or leave it (joined player) |

A rejected command is shown as a short message with its reason.

**Joined players** see the host's time state (running at a speed, or paused) instead of the time controls, and a banner while the connection is down, the host has paused, or the host's tab is hidden. **Spectators** get the Area and Game panels only.

Numbers show at most two decimals, and none from 100 up; from 10,000 they are compact (24.3k, 1.23M). A nonzero value too small to show reads "<0.01". Quantities that are whole by nature, such as people, workers, soldiers and days, show as whole numbers (24,312), compact only from a million.

### Time controls

The top bar holds pause and four speeds: 1×, 2× and 5× (`maxTicksPerSecond` 2, 5 and 10) and max, which runs ticks back to back. It shows the game day, the treasury, the realm's population, the actual ticks per second and the milliseconds per tick. Space toggles pause. A solo game pauses while its tab is hidden; a hosted game keeps running. A game starts at 1× on phones and 2× elsewhere.

### Layout

- **Desktop** (900 px wide and more): the map fills the window, under a top bar. A sidebar on the right holds the panels as tabs. It is 380 px wide by default; dragging the divider between map and sidebar resizes it between 280 px and the smaller of 900 px and 70% of the window, arrow keys nudge it, and a double-click restores the default. The width is remembered on the device.
- **Phone:** the map fills the screen under a compact top bar, whose map layer and flows take a second row. The panels sit in a bottom sheet with three heights: a peek showing the selection, half the screen, and full screen; centering the map on an area centers it above the sheet. Touch targets are at least 44 px (inline links through a larger hit area), and fields use 16 px text, so phones do not zoom on focus. No page scrolls sideways.
- **Installed app:** the top bar, the sheet and the menus stay clear of the screen's notches and rounded corners (safe areas), and pulling down never reloads the page.
