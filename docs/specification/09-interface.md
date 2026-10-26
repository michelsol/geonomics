[Specification](README.md) · section 9 of 10

## 9. Interface

The interface is map-first: the map fills the screen and panels sit beside it on desktop, or below it on a phone. It reads only what a snapshot and the price table carry, so a joined player sees exactly what a solo player sees.

### Screens

1. **Join.** Opening a join link asks for the player's name, then connects; a reload of the same tab rejoins without asking. The host's refusal or an unreachable host is shown.
2. **New game.** The menu lists the games saved in this browser (title, day, map, save time) with Continue and Delete, offers Load from file, Join with a code (a friend's game code or link), a How to play link, and, when a new version of the app is installed, a Reload button. For a new game, the player picks a catalog (small, medium or large; default large), a map size on a slider (50 to 3,000 areas in steps of 50; default 300), the number of realms on a slider (1 to 32, at most one per area; default 8), the AI's personality mix (balanced, peaceful or aggressive; section 10) and a seed. The map is then generated and warmed up in the worker, behind a progress bar. Finally comes the **lobby**: the founded governments with capital, population, area count, and the player holding each or its AI personality. Each player picks a free realm, takes a random one or watches. The host can invite players there (a join link with a Copy button), see who is online, and release the realm of a player who went offline. The host's pick starts the game; a joined player enters once the host accepts its pick.
   A loaded game skips generation and goes straight to the lobby.
3. **How to play.** A short guide: the idea, the map, the economy, running the realm, war and peace, the AI realms, playing with friends, saving, and phones.
4. **Game.** The map, the top bar and the panels.
5. **End of session.** Shown when the player's government is eliminated, or when the player ends the game. It lists days played, peak and final population, areas held and treasury, then every realm's public figures, the largest population first and fallen realms last: who ran it, areas, final and peak population, real net income, necessities met and soldiers. Other realms' treasuries and depots stay private, as during the game. It offers a new game. There is no score.

### Map

Areas are the Voronoi cells of their positions, with the water cells around them, which fill the rest of the map's rectangle. Water cells are shaded by depth, lighter within reach of a level-3 port, and cannot be selected. Selected areas' ports have their water cells lightly filled. The open panel sets the layer; there is no layer menu.

| Layer | Panels | Colors each area by |
| --- | --- | --- |
| Realms | Area, Infrastructure, Armies, Diplomacy, Game | Owner color; neutral areas in grey. Water cells a realm's ports reach take a tint of its color, and cells shared between realms a grey one. Realm borders are drawn on every layer |
| Prices | Goods | The chosen good's price against the map's own prices: white at the median, full blue at the lowest and full red at the highest, on a log scale on each side. The legend gives the three prices |
| Population | Population | Population, one hue on a log scale over the two decades below the largest area: an area with 1% of the largest's people or fewer, an emptied one included, is the darkest |
| Satisfaction | Needs | Necessity satisfaction, from red (0) to green (1) |
| Resources | Resources | Terrain type, with dark diagonal stripes over the areas and water cells that have the chosen resource: thicker for more, in four steps of the square root of the maximum natural capacity over the best cell's. The stripes line up across cells and scale with the map |
| Real net income | Policies | Real net income (see Income below) against the map's own: white at the median, full blue at the lowest (and wherever it is zero or less), full red at the highest, on a log scale on each side; grey for an empty area. The legend gives the three in mh/day. Before the first price table, the net income |
| Employment rate | Jobs | Share of the workforce with a private or government job, from dark (0%) to light blue (100%); grey for an empty area |

**Income.** With no capital or profits in the model, a private worker earns the value they add. Figures are per game day, in man-hours.

- **Wage of a private job:** value added per worker, before income tax (section 4, Labor allocation). The **average private wage** is the mean over private workers (section 4, Value added and wages); government wage offers and the soldier wage are compared with it.
- **Gross income:** private value added, plus the wages of government jobs as paid, per member of the workforce (`population × workforceShare`), the unemployed included.
- **Net income:** gross income less the income tax, the unemployed tax, the consumption tax on what was consumed and the head tax, plus the wage top-ups, benefits, subsidies and allowances paid (scaled down with the treasury's paid share), per member of the workforce. Tariffs come out of the trade margin, so they show in prices instead; soldiers' pay is not counted, as soldiers are not part of the workforce.
- **Cost of living:** the price of a reference basket of needs at the area's public prices over its price at labor values, so ×1 when needs cost their labor value. Each need counts its `demandPerPersonPerDay` units, split between its goods as consumers split them (section 4, Consumption), without consumption tax.
- **Real net income:** net income over the cost of living. A starving area where food is dear has a high income but a low real net income.

**Flows** are drawn over the layer while their panel is open and its checkbox ticked (both off at first; each keeps its state for the session):

| Flows | Panel | Draws |
| --- | --- | --- |
| Migration | Population | An arrow per edge for the net migrants of the last tick |
| Transport | Goods | An arrow per edge and direction for the units of the good chosen in the Goods panel carried in the last tick; services are never carried |

**Flow arrows** run from 20% to 80% of the segment between two area centers, with a dark outline. Their width grows from 1 to 6 px with the square root of the flow over the largest flow on the map. Transport arrows sit to the right of their direction, so the two directions of an edge stay apart. Flows under 3% of the largest are left out, as are arrows with less than 14 px of room on screen (they appear when zooming in), and at most the 2,500 largest flows are drawn. The legend shows sample arrows with their values.

**Between realms only** (a checkbox under each panel's flows checkbox, off at first, shared by both panels) sums the flows of every edge across each border into one arrow per pair of groups: each realm, and the neutral areas as one group. Transport keeps each direction; migration nets into one arrow toward the group that gains people. Arrows run between capitals, or the population-weighted center of the areas for a realm without a capital and for the neutral group, and grow from 3 to 12 px wide. The legend says "between realms" and scales to these sums.

The layer and the flows each have their own legend, stacked bottom left. Every layer also shows:

- **Routes:** sea routes dashed, air routes dotted, while they run (ports or airports with staff at both ends); blocked edges red. Sea lanes are not drawn.
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
- **Totals.** With several areas selected, the Area panel shows the owners and how many areas each holds, total population, militia, savings and unemployed, population-weighted gross, net and real net income and cost of living, satisfaction and necessities met, the hardest area to conquer, and the market: mean prices, and stock, production, use and net trade summed (trade between two selected areas cancels out). The Resources panel sums natural capacities, and the Goods panel shows the selection's mean price and records its history. Stocks, flows, savings and unemployment cover only the areas whose detail the snapshot carries, which the panel says.
- **Action target.** The Policies, standing orders, Jobs, Infrastructure and Armies panels have no area choice of their own: they act on the player's areas in the selection. When nothing is selected, or all of the player's areas, they act on the whole realm: taxes and price controls are set realm-wide, and standing orders apply to every area, including areas taken later. When the selection holds only other realms' or neutral areas, there is no target: these panels show "None of your areas is selected" in place of their figures and forms (the policies table, the standing orders, the soldier wage and the armies stay), rather than the realm's figures. The bar reads "Actions: <area>", "Actions: your N areas", "Actions: your whole realm" or "Actions: none of your areas". A new game opens with the capital selected.
  - **Rates and prices** (taxes, tariffs, price controls, wage offers, the staff wage) are set to the same value in each area; the value starts at the first area's setting.
  - **Amounts** (workers to hire, recruits, weapons to buy) are totals, split over the areas by population, in whole numbers that add up to the total. A job producing a primary good goes over the areas that have it only. Recruits make one army per area that gets any, and weapon purchases one buy order per area. For the whole realm, recruits form one army at the capital, and weapons are bought at the capital.
  - Jobs show one line per job across the areas, with summed workers and target; a new target is split again.
  - Infrastructure buttons raise or lower the target by one level in each area of the target (ports: coastal areas only).
  - A peace proposal can take the selection as its areas.

### Panels

| Panel | Shows | Actions |
| --- | --- | --- |
| Area | One view for one selected area or several (see Selection), or "No area selected". The area's name, owner and terrain, or the number of areas and their owners. One grid of figures: population, average gross, net and real net income (mh/day) and cost of living, necessities met, satisfaction, port, airport, road and fort levels with their staffed shares (one area), savings per person and unemployed (areas seen in detail), siege, militia, defense power, and for areas not the player's the equipped soldiers needed to conquer. Each figure explains itself on hover; the panel has no explanatory paragraphs. The market: price, stock, production, consumption and trade per good where detail is sent, prices only elsewhere. For own areas, the depot's contents | Sort the market table by any column; a good's name opens it in the Goods panel |
| Goods | One good across the world: its kind and labor value; the selection's mean price, first and in bold, then the lowest, median and highest price with their areas; a chart over time of these | Choose the good (goods are listed by name, as in every good list); show its transport flows, between realms only |
| Population | For the selection or, with nothing selected, the player's realm (the whole map for a spectator): population, its change per day, births, deaths, immigration and emigration per day, and charts over time of population, of births and deaths, and of immigration and emigration. Births run at a fixed rate; deaths take the people lacking necessities (section 4, Population), so a full area shows the two about equal. Immigration and emigration count migrants crossing the edge of the areas shown, so moves between two of them cancel out | Show migration flows, between realms only |
| Needs | For the same areas: necessities met and satisfaction, weighted by population, with a chart over time; per need, its tier, the need units wanted per person and day, and the share met, over the areas seen in detail; per consumer group (each wage band, then the unemployed), its share of the people and its necessities met | — |
| Resources | One resource (a primary good) chosen for the map, with the five areas of the map with the most of it, and for a resource found at sea, how ports work it; for the selection, maximum capacity per resource, and current capacity, extraction and use where detail is sent. Capacities count the area's share of the water cells its port reaches | Choose the resource, also by clicking it in the table |
| Policies | Every tax and price control in force, realm-wide and per area; standing orders | Every policy has one line, one under the other, with no menu: its label, a slider with the level written on its thumb, and two stacked arrows for fine steps. The lines are the income tax, one for all bands, one per wage band and one for the unemployed; the head tax; then, for the good picked once above them (or all goods), the consumption tax, the import and export tariffs, and the price ceiling and floor. Rates slide from −100% to +100% in steps of 1%, and the arrows step by 0.5 point up to 500% (negative: a subsidy, or for the income tax a top-up); the unemployed row and the head tax slide from −10 to +10 mh per day in steps of 0.05 (negative: a benefit for each unemployed worker, an allowance for every inhabitant); ceilings and floors slide from 0 to 10 times the good's labor value in steps of 0.1, with "none" at the top for a ceiling and at 0 for a floor. Each line shows the value in force for the action target (see Selection): its own setting, else the one for every band or good, else the realm's. A slider applies when released, an arrow at once; setting every band or every good replaces the target's settings for single bands or goods, so their lines follow it. Remove a setting; add and remove standing orders |
| Jobs | For the action target (see Selection): the workforce split between private jobs, government jobs (infrastructure staff included) and unemployment, and private workers, output per day, output per worker and wage per day by good. Each production job's target and workers, and the wage offer beside the average private wage, in mh/day | Set production job targets and wage offers |
| Infrastructure | For the action target: staff employed over the quota, staff wages and construction payments per day; the staff wage as a share of the local private wage; per kind (no port inland), the level and any construction with its progress for one area, or the number of areas at each level and how many are building for several, staff over quota and the running share; for several areas, a table of those with any infrastructure: P, A, R and F levels, "→" while building; with a coast, the water cells the ports reach and per resource found there the areas' share at full capacity, and what one more port level would add | Set the staff wage (slider from 50% to 200%, and Set); raise or lower each kind one level, the + button showing the cost, build days and staff of the next level. Clicking an area in the table selects it |
| Armies | Recruiting (recruits, for the action target) with the soldier wage beside it, in mh/day and paid to every soldier; soldiers, their pay per day and the realm average private wage in mh/day; weapons in depots and being bought; each army's soldiers, equipment, power, stance, location and path | Set the soldier wage, recruit, buy weapons, set stance, move (then pick the destination on the map), disband |
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
