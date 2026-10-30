import { expect, type Page, test } from "@playwright/test";

/** Starts a small game with a short warm-up and takes the first realm. */
async function startGame(page: Page) {
  await page.goto("/?warmup=10");
  await page.getByLabel("Map size").fill("300");
  await page.getByLabel("Goods catalog").selectOption("small");
  await page.getByRole("button", { name: "New game" }).click();
  await expect(page.getByRole("heading", { name: "Choose your realm" })).toBeVisible({ timeout: 60_000 });
  await page.locator(".realm-list button").first().click();
  await expect(page.getByTestId("map-canvas")).toBeVisible();
  await expect(page.getByTestId("area-name")).toBeVisible();
}

const day = async (page: Page) => Number((await page.getByTestId("game-day").textContent())?.replace(/\D/g, ""));

/** Opens a panel tab; on a phone the sheet opens to half height first. */
async function openTab(page: Page, name: string) {
  await page.getByRole("navigation").getByRole("button", { name, exact: true }).click();
}

test("a solo game runs, pauses, and takes commands", async ({ page }) => {
  await startGame(page);
  // People are whole numbers, compact from a million: billions on an Earth-sized planet.
  await expect(page.getByTestId("realm-population")).toHaveText(/^👥 ([\d,]+|\d+(\.\d+)?[MBT])$/);

  // Time runs, and pause stops it.
  const start = await day(page);
  await expect.poll(() => day(page), { timeout: 10_000 }).toBeGreaterThan(start + 2);
  await page.getByRole("button", { name: "Pause" }).click();
  await page.waitForTimeout(400);
  const paused = await day(page);
  await page.waitForTimeout(1200);
  expect(await day(page)).toBe(paused);

  // Clicking the map selects another area.
  const capital = await page.getByTestId("area-name").textContent();
  const canvas = page.getByTestId("map-canvas");
  const box = await canvas.boundingBox();
  if (!box) throw new Error("map canvas has no size");
  // The map opens centered on the capital: try points around it until one lands on a neighboring area.
  const cx = box.width / 2;
  const cy = box.height / 2;
  for (let step = 0; step < 16; step++) {
    const angle = (step * Math.PI) / 4;
    const radius = 40 + 30 * Math.floor(step / 8);
    await canvas.click({ position: { x: cx + radius * Math.cos(angle), y: cy + radius * Math.sin(angle) } });
    if ((await page.getByTestId("area-name").textContent()) !== capital) break;
  }
  expect(await page.getByTestId("area-name").textContent()).not.toBe(capital);

  // Every tax has its own line; with nothing selected, a slider sets a realm-wide rate when released.
  await openTab(page, "Policies");
  await page.getByRole("button", { name: "Clear", exact: true }).click();
  await expect(page.getByTestId("action-target")).toHaveText("Actions: your whole realm");
  await page.getByLabel("Income tax · all bands level").fill("10");
  await expect(page.getByLabel("Income tax · under 0.5 mh/h level")).toHaveValue("10"); // every band follows
  await expect(page.getByTestId("policies")).toContainText("Income tax · all bands");
  await expect(page.getByTestId("policies")).toContainText("10%");

  await expect(page.getByTestId("policies").locator("th", { hasText: "Only in" })).toHaveCount(0);

  // A realm head tax shows up among the policies.
  const headTax = page.getByTestId("policies").locator("tr", { hasText: "Head tax" });
  await page.getByLabel("Head tax level").fill("0.25");
  await expect(headTax).toContainText("0.25 mh");
  // An arrow steps it finely, at once.
  await page.getByRole("button", { name: "Raise Head tax", exact: true }).click();
  await expect(headTax).toContainText("0.3 mh");
  // A negative head tax is an allowance paid to everyone.
  await page.getByLabel("Head tax level").fill("-1");
  await expect(headTax).toContainText("-1 mh");

  // The income tax's unemployed row, negative, is a benefit for every unemployed worker.
  const benefit = page.getByTestId("policies").locator("tr", { hasText: "Income tax · unemployed" });
  await page.getByLabel("Income tax · unemployed level").fill("-2");
  await expect(benefit).toContainText("-2 mh");

  // Price controls are multiples of labor value, for the good picked once for every goods policy.
  await page.getByLabel("Price ceiling level").fill("2");
  await expect(page.getByTestId("policies").locator("tr", { hasText: "Price ceiling · all goods" })).toContainText(
    "2× labor value",
  );

  // The Jobs tab shows how the workforce is employed.
  await openTab(page, "Jobs");
  await expect(page.getByTestId("employment-bar")).toBeVisible();
  await expect(page.getByText("Private jobs")).toBeVisible();

  // Soldiers are paid a wage set in the Armies tab.
  await openTab(page, "Armies");
  await page.getByLabel("Soldier wage").fill("2");
  await expect(page.getByLabel("Soldier wage")).toHaveValue("2");

  // Recruiting creates an army.
  await openTab(page, "Armies");
  await page.getByLabel("Recruits").fill("200");
  await page.getByRole("button", { name: "Recruit", exact: true }).click();
  await expect(page.getByTestId("army")).toHaveCount(1);

  // The other realms are run by the AI, each with its personality; war on a neighbor is recorded.
  await openTab(page, "Diplomacy");
  await expect(page.locator('[data-testid^="relation-"]').first()).toContainText(/AI · (trader|builder|conqueror)/);
  await page.getByRole("button", { name: "Declare war" }).first().click();
  await expect(page.getByText("at war").first()).toBeVisible();

  // Ending the session shows the summary.
  await openTab(page, "Game");
  await page.getByRole("button", { name: "End game" }).click();
  await expect(page.getByRole("heading", { name: "Session over" })).toBeVisible();
  // Every realm's public figures, the player's among them.
  const results = page.getByTestId("realm-results");
  await expect(results.locator("tbody tr")).toHaveCount(8);
  await expect(results.locator("tr.chosen-row")).toContainText("you");
  await page.getByRole("button", { name: "New game" }).click();
  await expect(page.getByRole("heading", { name: "Geonomics" })).toBeVisible();
});

test("the panels resize by dragging the divider", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "the divider is desktop only");
  await startGame(page);
  const side = page.getByRole("complementary", { name: "Panels" });
  const before = (await side.boundingBox())?.width ?? 0;
  const divider = await page.getByTestId("divider").boundingBox();
  if (!divider) throw new Error("no divider");
  const x = divider.x + divider.width / 2;
  const y = divider.y + divider.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x - 150, y, { steps: 5 });
  await page.mouse.up();
  await expect.poll(async () => (await side.boundingBox())?.width ?? 0).toBeGreaterThan(before + 100);
});

test("the market table sorts by column, and counts show no decimals", async ({ page }) => {
  await startGame(page);
  // A count: whole below a million, compact (three digits at most) above.
  await expect(page.getByTestId("population")).toHaveText(/^([\d,]+|\d{1,3}(\.\d{1,2})?[MBT])$/);
  const market = page.getByTestId("market");
  await market.getByRole("button", { name: "Price" }).click();
  await expect(market.getByRole("columnheader", { name: /Price/ })).toHaveAttribute("aria-sort", "descending");
  const prices = await market.locator("tbody tr td:nth-child(2)").allTextContents();
  const values = prices.map((text) => {
    const number = Number.parseFloat(text.replace("<", ""));
    return text.endsWith("k") ? number * 1e3 : text.endsWith("M") ? number * 1e6 : number;
  });
  expect(values).toEqual([...values].sort((a, b) => b - a));
  await market.getByRole("button", { name: /Price/ }).click();
  await expect(market.getByRole("columnheader", { name: /Price/ })).toHaveAttribute("aria-sort", "ascending");
});

test("the realm count is chosen at the start", async ({ page }) => {
  await page.goto("/?warmup=10");
  await page.getByLabel("Map size").fill("300");
  await page.getByLabel("Goods catalog").selectOption("small");
  await page.getByLabel("Realms").fill("12");
  await page.getByRole("button", { name: "New game" }).click();
  await expect(page.getByRole("heading", { name: "Choose your realm" })).toBeVisible({ timeout: 60_000 });
  await expect(page.locator(".realm-list button")).toHaveCount(12);
});

test("the planet and the pace are chosen at the start, Earth's by default", async ({ page }) => {
  await page.goto("/?warmup=10");
  await page.getByLabel("Map size").fill("300");
  await page.getByLabel("Goods catalog").selectOption("small");
  await expect(page.locator(".range-field", { has: page.getByLabel("Circumference") })).toContainText(
    "40,000 km around (Earth)",
  );
  await expect(page.locator(".range-field", { has: page.getByLabel("World population") })).toContainText("8 billion");
  await expect(page.getByTestId("planet-scale")).toContainText("26.7M people per area");
  const reset = page.getByRole("button", { name: "Reset to Earth" });
  await expect(reset).toBeDisabled();
  // A small, sparse world at a quicker pace.
  await page.getByLabel("Circumference").fill("10000");
  await page.getByLabel("World population").fill("2"); // the third preset: 100 million
  await page.getByLabel("Demography responsiveness").fill("3"); // ×1
  await expect(page.getByTestId("planet-scale")).toContainText(
    "218 km between neighboring areas · 333,333 people per area",
  );
  await expect(reset).toBeEnabled();
  await page.getByRole("button", { name: "New game" }).click();
  await expect(page.getByRole("heading", { name: "Choose your realm" })).toBeVisible({ timeout: 60_000 });
  await page.locator(".realm-list button").first().click();
  await page.getByRole("navigation").getByRole("button", { name: "Game", exact: true }).click();
  await expect(page.getByTestId("planet")).toContainText("10,000 km around");
  await expect(page.getByTestId("planet")).toContainText("demography ×1");
});

test("each panel shows its map layer, and flows when its checkbox is on", async ({ page }) => {
  await startGame(page);
  const legend = page.getByTestId("legend");
  const flowLegend = page.getByTestId("flow-legend");
  await expect(legend).toHaveCount(0); // the Area panel shows the realms, which need no legend

  await openTab(page, "Population");
  await expect(legend).toContainText("Population per area");
  await expect(page.getByTestId("population-total")).toHaveText(/^([\d,]+|\d+(\.\d+)?[MBT])$/);
  await expect(page.getByTestId("births")).toHaveText(/^<?[\d.,]+[kM]?\/day$/);
  await expect(page.getByTestId("deaths")).toHaveText(/^<?[\d.,]+[kM]?\/day$/);
  await page.getByLabel("Show migration flows").check();
  await expect(flowLegend).toContainText("People moving per day");
  await expect(legend).toContainText("Population per area"); // both at once
  // Between realms only: one arrow per pair of realms, summed over their borders.
  await page.getByLabel("Between realms only").check();
  await expect(flowLegend).toContainText("net between realms");
  await page.getByLabel("Between realms only").uncheck();
  await expect(flowLegend).toContainText("net per edge");

  await openTab(page, "Goods");
  await expect(legend).toContainText("Price of");
  await expect(legend.locator(".ends span")).toHaveCount(3); // lowest, median and highest on the map
  await expect(flowLegend).toHaveCount(0); // migration belongs to the Population panel
  await page.getByLabel("Show transport flows").check();
  // The flows are the chosen good's, which the legend names; another good changes them.
  const good = page.getByLabel("Good", { exact: true });
  await expect(flowLegend).toContainText(`${await good.locator("option:checked").textContent()} carried per day`);
  await expect(page.getByLabel("Transported good")).toHaveCount(0);
  const other = good.locator("option:not(:checked)").first();
  const otherName = (await other.textContent()) as string;
  await good.selectOption((await other.getAttribute("value")) as string);
  await expect(flowLegend).toContainText(`${otherName} carried per day`);
  await page.getByLabel("Between realms only").check();
  await expect(flowLegend).toContainText(`${otherName} carried per day between realms`);
  await page.getByLabel("Between realms only").uncheck();
  // Goods are listed by name.
  const names = await good.locator("option").allTextContents();
  expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)));

  await openTab(page, "Needs");
  await expect(legend).toContainText("Necessities met");
  await expect(page.getByTestId("needs").locator("tbody tr").first()).toBeVisible();
  const groups = page.getByTestId("consumer-groups").locator("tbody tr");
  await expect(groups).toHaveCount(5); // the four wage bands and the unemployed
  await expect(groups.last()).toContainText("Unemployed");

  await openTab(page, "Resources");
  await expect(legend).toContainText("Natural capacity of");
  const resource = page.getByLabel("Resource", { exact: true });
  const last = (await resource.locator("option").last().getAttribute("value")) as string;
  await resource.selectOption(last);
  await expect(legend).toContainText(`Natural capacity of ${await resource.locator("option:checked").textContent()}`);
  await expect(legend).toContainText("plains"); // the stripes lie over the terrain

  await openTab(page, "Jobs");
  await expect(legend).toContainText("Employment rate");
  await expect(page.getByRole("columnheader", { name: "Wage/day" })).toBeVisible();
  await openTab(page, "Policies");
  await expect(legend).toContainText("Real net income");
  await openTab(page, "Area");
  for (const id of ["gross-income", "net-income", "real-net-income"]) {
    await expect(page.getByTestId(id)).toContainText("mh/day");
  }
  await expect(page.getByTestId("cost-of-living")).toHaveText(/^×[\d.]+$/);
  await expect(flowLegend).toHaveCount(0);
  await expect(legend).toHaveCount(0);
});

test("infrastructure is built level by level with money, and taken down at once", async ({ page }) => {
  await startGame(page);
  await openTab(page, "Infrastructure");
  await expect(page.getByTestId("action-target")).toHaveText(/^Actions: /);
  const fort = page.getByTestId("level-fort");
  await expect(fort).toHaveText("0");
  await expect(page.getByTestId("construction-spending")).toHaveText("0 mh/day");
  // The capital starts with an airport, fully staffed.
  await expect(page.getByTestId("level-airport")).toHaveText("1");
  await expect(page.getByTestId("infrastructure-staff")).not.toHaveText(/^0 \//);

  await expect(page.getByRole("button", { name: "Build Fort up" })).toHaveAttribute("title", /mh over \d+ days/);
  await page.getByRole("button", { name: "Build Fort up" }).click();
  await expect(fort).toContainText("0 → 1");
  await expect(page.getByTestId("construction-spending")).not.toHaveText("0 mh/day");
  await page.getByRole("button", { name: "Take Fort down" }).click();
  await expect(fort).toHaveText("0");

  // The staff wage is a share of the local private wage; it stays out of the Policies table.
  await page.getByLabel("Staff wage", { exact: true }).fill("150");
  await page.getByRole("button", { name: "Set", exact: true }).click();
  await expect(page.getByLabel("Staff wage", { exact: true })).toHaveValue("150");
  await openTab(page, "Policies");
  await expect(page.getByTestId("policies")).not.toContainText("staff");
});

test("a good in the market table opens it in the Goods panel", async ({ page }) => {
  await startGame(page);
  const name = (await page.getByTestId("market").locator("tbody tr button").nth(1).textContent()) as string;
  await page.getByTestId("market").locator("tbody tr button").nth(1).click();
  await expect(page.getByRole("navigation").getByRole("button", { name: "Goods", exact: true })).toHaveClass(/active/);
  await expect(page.getByLabel("Good", { exact: true }).locator("option:checked")).toHaveText(name);
  await expect(page.getByTestId("price-low")).toBeVisible();
  // The selection's price comes first among the prices across the world.
  await expect(page.locator("tr.chosen-row").first()).toBeVisible();
  await expect(
    page
      .locator("table")
      .filter({ has: page.getByTestId("price-low") })
      .locator("tbody tr")
      .first(),
  ).toHaveClass(/chosen-row/);
  // A crafted good lists its inputs, and each opens in the panel.
  await page.getByLabel("Good", { exact: true }).selectOption({ label: "Bread" });
  await expect(page.getByTestId("good-inputs")).toContainText("of Grain");
  await page.getByTestId("good-inputs").getByRole("button", { name: "Grain" }).click();
  await expect(page.getByLabel("Good", { exact: true }).locator("option:checked")).toHaveText("Grain");
  await expect(page.getByTestId("good-inputs")).toHaveCount(0);
});

test("a selection with none of your areas has no action target", async ({ page }) => {
  await startGame(page);
  const canvas = page.getByTestId("map-canvas");
  const box = await canvas.boundingBox();
  if (!box) throw new Error("map canvas has no size");
  const target = page.getByTestId("action-target");
  // Walk out from the capital, at the center, until a click lands on another realm's area.
  search: for (let radius = 40; radius < Math.min(box.width, box.height) / 2; radius += 25) {
    for (let step = 0; step < 12; step++) {
      const angle = (step * Math.PI) / 6;
      const x = box.width / 2 + radius * Math.cos(angle);
      const y = box.height / 2 + radius * Math.sin(angle);
      if (x < 10 || x > box.width - 10 || y < 10 || y > box.height - 180) continue; // the phone's sheet covers the bottom
      await canvas.click({ position: { x, y } });
      if ((await target.textContent()) === "Actions: none of your areas") break search;
    }
  }
  await expect(target).toHaveText("Actions: none of your areas");
  await openTab(page, "Jobs");
  await expect(page.getByTestId("no-own-area")).toBeVisible();
  await expect(page.getByTestId("employment-bar")).toHaveCount(0);
  await openTab(page, "Policies");
  await expect(page.getByTestId("no-own-area").first()).toBeVisible();
  await expect(page.getByLabel("Income tax · all bands level")).toHaveCount(0);
  await page.getByRole("button", { name: "Clear", exact: true }).click();
  await expect(target).toHaveText("Actions: your whole realm");
  await expect(page.getByLabel("Income tax · all bands level")).toBeVisible();
  await openTab(page, "Jobs");
  await expect(page.getByTestId("employment-bar")).toBeVisible();
});

test("a share of the selection's soldiers spreads over areas picked on the map", async ({ page }) => {
  await startGame(page);
  await openTab(page, "Armies");
  await page.getByLabel("Recruits").fill("200");
  await page.getByRole("button", { name: "Recruit", exact: true }).click();
  await expect(page.getByTestId("army")).toHaveCount(1);
  // More recruits in the same area join the army there.
  await page.getByRole("button", { name: "Recruit", exact: true }).click();
  await expect(page.getByTestId("selection-soldiers")).toHaveText("400");
  await expect(page.getByTestId("army")).toHaveCount(1);
  // With nothing selected, the panel acts on every soldier, wherever the march takes them.
  await page.getByRole("button", { name: "Clear", exact: true }).click();
  await page.getByLabel("Share of soldiers").fill("25");
  await page.getByRole("button", { name: "Move 100" }).click();
  const banner = page.getByTestId("move-banner");
  await expect(banner).toContainText("Click areas to send 100 soldiers (25%) to · 0 picked");
  await expect(banner.getByRole("button", { name: "Send" })).toBeDisabled();
  const canvas = page.getByTestId("map-canvas");
  const box = await canvas.boundingBox();
  const sheet = await page.getByRole("complementary", { name: "Panels" }).boundingBox();
  if (!box || !sheet) throw new Error("map canvas has no size");
  // The capital is in the middle of the map's uncovered part (above the phone's sheet): click points around it, off
  // the capital, until two areas are picked (water picks nothing).
  const cx = box.width / 2;
  const cy = (sheet.y > box.y + 100 ? sheet.y - box.y : box.height) / 2;
  for (let step = 0; step < 16 && !(await banner.textContent())?.includes("2 picked"); step++) {
    const angle = (step * Math.PI) / 4;
    const radius = 55 + 30 * Math.floor(step / 8);
    await canvas.click({ position: { x: cx + radius * Math.cos(angle), y: cy + radius * Math.sin(angle) } });
  }
  await expect(banner).toContainText("2 picked");
  await banner.getByRole("button", { name: "Send" }).click();
  await expect(banner).toHaveCount(0);
  // The rest stays; the hundred sent split between the two areas, or all go to one when the other is out of reach.
  await expect.poll(() => page.getByTestId("army").count()).toBeGreaterThanOrEqual(2);
  await expect(page.getByTestId("army").first()).toContainText("300 in");
  await expect(page.getByTestId("selection-soldiers")).toHaveText("400");
});

test("rejected commands are explained", async ({ page }) => {
  await startGame(page);
  await openTab(page, "Armies");
  await page.getByLabel("Recruits").fill("1000000000000");
  await page.getByRole("button", { name: "Recruit", exact: true }).click();
  await expect(page.locator(".toast")).toContainText("not enough");
});
