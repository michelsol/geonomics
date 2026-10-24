[Specification](README.md) · section 10 of 11

## 10. Interface

The interface is map-first: the map fills the screen and panels sit beside it on desktop, or below it on a phone. It reads only what a snapshot and the price table carry, so a joined player sees exactly what a solo player sees.

### Screens

1. **Join.** Opening a join link asks for the player's name, then connects; a reload of the same tab rejoins without asking. The host's refusal or an unreachable host is shown.
2. **New game.** The menu lists the games saved in this browser (title, day, map, save time) with Continue and Delete, offers Load from file, Join with a code (a friend's game code or link), a How to play link, and, when a new version of the app is installed, a Reload button. For a new game, the player picks a catalog (small, medium or large), a map size (300, 1,000 or 3,000 areas), the number of realms (4, 6, 8, 12, 16, 24 or 32, at most one per 8 areas; default 8), the AI's personality mix (balanced, peaceful or aggressive; section 11) and a seed. The map is then generated and warmed up in the worker, behind a progress bar. Finally comes the **lobby**: the founded governments with capital, population, area count, and the player holding each or its AI personality. Each player picks a free realm, takes a random one or watches. The host can invite players there (a join link with a Copy button), see who is online, and release the realm of a player who went offline. The host's pick starts the game; a joined player enters once the host accepts its pick.
   A loaded game skips generation and goes straight to the lobby.
3. **How to play.** A short guide: the idea, the map, the economy, running the realm, war and peace, the AI realms, playing with friends, saving, and phones.
4. **Game.** The map, the top bar and the panels.
5. **End of session.** Shown when the player's government is eliminated, or when the player ends the game. It lists days played, peak and final population, areas held and treasury, and offers a new game. There is no score.

### Map

Areas are the Voronoi cells of their positions, with the water cells around them. The open panel sets the layer; there is no layer menu.

| Layer | Panels | Colors each area by |
| --- | --- | --- |
| Realms | Area, Armies, Diplomacy, Game | Owner color; neutral areas in grey. Realm borders are drawn on every layer |
| Prices | Goods | The chosen good's price over its labor value, on a log scale from blue (cheap) through white to red (dear) |
| Population | Population | Population, one hue on a log scale over the two decades below the largest area: an area with 1% of the largest's people or fewer, an emptied one included, is the darkest |
| Satisfaction | Needs | Necessity satisfaction, from red (0) to green (1) |
| Resources | Resources | Terrain type, with dark diagonal stripes over the areas that have the chosen resource: thicker for more, in four steps of the square root of the maximum natural capacity over the best area's. The stripes line up across areas and scale with the map |
| Average wage | Policies | Wage level (mean value added per private worker-hour) on a log scale |
| Employment rate | Jobs | Share of the workforce with a private or government job, from dark (0%) to light blue (100%); grey for an empty area |

**Flows** are drawn over the layer while their panel is open and its checkbox ticked (both off at first; each keeps its state for the session):

| Flows | Panel | Draws |
| --- | --- | --- |
| Migration | Population | An arrow per edge for the net migrants of the last tick |
| Transport | Goods | An arrow per edge and direction for the goods carried in the last tick: every good in tonnes, or one good chosen in the legend in its own units |

**Flow arrows** run from 20% to 80% of the segment between two area centers, with a dark outline. Their width grows from 1 to 6 px with the square root of the flow over the largest flow on the map. Transport arrows sit to the right of their direction, so the two directions of an edge stay apart. Flows under 3% of the largest are left out, as are arrows with less than 14 px of room on screen (they appear when zooming in), and at most the 2,500 largest flows are drawn. The legend shows sample arrows with their values.

The layer and the flows each have their own legend, stacked bottom left. Every layer also shows:

- **Routes:** sea routes dashed, air routes dotted; blocked edges red.
- **Capitals:** a star.
- **Armies:** a marker in their government's color, with their remaining path.
- **Sieges:** a ring showing their progress.
- **Selection:** the selected area is outlined.

Mouse or one finger pans and the wheel or a pinch zooms around the pointer. A click or tap selects the area under it. While the player moves an army or picks areas for a peace proposal, a click picks the target instead. While the selection brush is on, one finger or the left button paints instead (see Selection).

### Selection

- **The bar.** A bar under the panel tabs, on every tab, shows the selection: the area's name and owner, the number of areas, or "Nothing selected". For a player, a second line says what actions apply to (see Action target). Its buttons: My realm (players with two areas or more, unless exactly the realm is selected) selects every area of the realm; Brush turns the brush on or off; Center centers the map on the selection, or on the capital when nothing is selected; Clear (when something is selected) empties the selection.
- **One area.** A click or tap selects the area under it, alone. Shift-, Ctrl- or Cmd-click adds or removes one area. Escape empties a selection of several areas.
- **Brush.** While the brush is on, dragging one finger or the left mouse button paints areas, and a tap paints the area under it. A banner over the map has Add and Erase (Add by default), the brush size and Done. Size S paints the areas under the pointer's path; M and L also paint the areas whose center lies within 24 or 60 screen pixels of it. The areas painted by a stroke are filled, white when adding and red when erasing, with a ring at the pointer showing the brush's reach; when the stroke ends, they are added to the selection or taken out of it. Two fingers pan and pinch, the wheel zooms, and a right or middle mouse drag pans, without painting; a second finger landing during a stroke cancels it. The brush keeps its mode and size until changed. Done, the Brush button, Escape, or moving an army or picking peace areas turn it off.
- **Drawing.** The selection's frontier is outlined, 3 px wide whatever its size: sides between two selected areas are not drawn, so a region shows as one shape (with its holes and separate parts). With several areas, each is also lightly filled.
- **Totals.** With several areas selected, the Area panel shows the owners and how many areas each holds, total population, militia, savings and unemployed, population-weighted average wage, satisfaction and necessities met, the hardest area to conquer, and the market: mean prices, and stock, production, use and net trade summed (trade between two selected areas cancels out). The Resources panel sums natural capacities, and the Goods panel shows the selection's mean price and records its history. Stocks, flows, savings and unemployment cover only the areas whose detail the snapshot carries, which the panel says.
- **Action target.** The Policies, standing orders, Jobs and Armies panels have no area choice of their own: they act on the player's areas in the selection. When the selection holds none of the player's areas, or all of them, they act on the whole realm: taxes and price controls are set realm-wide, and standing orders apply to every area, including areas taken later. The bar reads "Actions: <area>", "Actions: your N areas" or "Actions: your whole realm". A new game opens with the capital selected.
  - **Rates and prices** (taxes, tariffs, price controls, wage offers) are set to the same value in each area, and the setting in force reads "varies by area" when they differ.
  - **Amounts** (workers to hire, recruits, weapons to buy) are totals, split over the areas by population, in whole numbers that add up to the total. A port job goes over the coastal areas only; a road job over the land edges inside the selection, evenly. Recruits make one army per area that gets any, and weapon purchases one buy order per area. For the whole realm, recruits form one army at the capital, and weapons are bought at the capital.
  - Jobs show one line per job across the areas, with summed workers and target; a new target is split again.
  - A peace proposal can take the selection as its areas.

### Panels

| Panel | Shows | Actions |
| --- | --- | --- |
| Area | One view for one selected area or several (see Selection), or "No area selected". The area's name, owner and terrain, or the number of areas and their owners. One grid of figures: population, average wage per day (mh/day), necessities met, satisfaction, port, airport and fortification levels (one area), savings per person and unemployed (areas seen in detail), siege, militia, defense power, and for areas not the player's the equipped soldiers needed to conquer. Each figure explains itself on hover; the panel has no explanatory paragraphs. The market: price, stock, production, consumption and trade per good where detail is sent, prices only elsewhere. For own areas, the depot's contents | Sort the market table by any column; a good's name opens it in the Goods panel |
| Goods | One good across the world: its kind and labor value; lowest, median and highest price with their areas, and the selection's mean price; a chart over time of these | Choose the good; show transport flows |
| Population | For the selection or, with nothing selected, the player's realm (the whole map for a spectator): population, its change per day, births & deaths, immigration and emigration per day, and charts over time of population and of the three flows. Births & deaths is the net natural change: growth where necessities are met, less starvation where they run short (section 5, Population); the model has no separate birth and death rates. Immigration and emigration count migrants crossing the edge of the areas shown, so moves between two of them cancel out | Show migration flows |
| Needs | For the same areas: necessities met and satisfaction, weighted by population, with a chart over time; per need, its tier, the need units wanted per person and day, and the share met, over the areas seen in detail | — |
| Resources | One resource (a primary good) chosen for the map, with the five areas of the map with the most of it; for the selection, maximum capacity per resource, and current capacity, extraction and use where detail is sent | Choose the resource, also by clicking it in the table |
| Policies | Every tax and price control, realm-wide and per area; the setting in force for the action target, policy and good; standing orders | Set or remove a policy for the action target (see Selection), for one good or all goods. The production tax is chosen first. Taxes and tariffs have a slider from −100% to +100% (the number field takes up to 500%), head tax one from −10 to +10 mh per person per day (negative: an allowance paid to every inhabitant); ceilings and floors take a number. The value starts at the setting in force, and Set applies it. Add and remove standing orders |
| Jobs | For the action target (see Selection): the workforce split between private jobs, government jobs and unemployment, and private workers, output per day and output per worker by good. Each job's target and workers, and the wage offer, in mh/day | Set job targets and wage offers |
| Armies | Recruiting (recruits, for the action target) with the soldier wage beside it, in mh/day and paid to every soldier; soldiers, their pay per day and the realm average wage in mh/day; weapons in depots and being bought; each army's soldiers, equipment, power, stance, location and path | Set the soldier wage, recruit, buy weapons, set stance, move (then pick the destination on the map), disband |
| Diplomacy | Relations with every government, with who runs each (a player, "AI · personality", or an offline player's realm run by the AI), pending proposals | Declare war; propose peace (payment and areas picked on the map); accept or refuse proposals |
| Game (last tab) | The players and their realms, online or not | Invite players and release offline players' realms (host); export the save (host); end the game, or leave it (joined player) |

A rejected command is shown as a short message with its reason.

**Joined players** see the host's time state (running at a speed, or paused) instead of the time controls, and a banner while the connection is down, the host has paused, or the host's tab is hidden. **Spectators** get the Area, Goods, Population, Needs, Resources and Game panels.

Numbers show at most two decimals, and none from 100 up; from 10,000 they are compact (24.3k, 1.23M). A nonzero value too small to show reads "<0.01". Quantities that are whole by nature, such as people, workers, soldiers and days, show as whole numbers (24,312), compact only from a million.

### Time controls

The top bar holds pause and four speeds: 1×, 2× and 5× (`maxTicksPerSecond` 2, 5 and 10) and max, which runs ticks back to back. It shows the game day, the treasury, the realm's population (a whole number), the actual ticks per second and the milliseconds per tick. Space toggles pause. A solo game pauses while its tab is hidden; a hosted game keeps running. A game starts at 1× on phones and 2× elsewhere.

### Layout

- **Desktop** (900 px wide and more): the map fills the window, under a top bar. A sidebar on the right holds the panels as tabs, wrapping onto a second row. It is 380 px wide by default; dragging the divider between map and sidebar resizes it between 280 px and the smaller of 900 px and 70% of the window, arrow keys nudge it, and a double-click restores the default. The width is remembered on the device.
- **Phone:** the map fills the screen under a compact top bar. The panels sit in a bottom sheet with three heights: a peek showing the tabs (one row that scrolls sideways, to the chosen tab) and the selection bar, half the screen, and full screen; centering the map on an area centers it above the sheet. Touch targets are at least 44 px (inline links through a larger hit area), and fields use 16 px text, so phones do not zoom on focus. No page scrolls sideways.
- **Installed app:** the top bar, the sheet and the menus stay clear of the screen's notches and rounded corners (safe areas), and pulling down never reloads the page.
