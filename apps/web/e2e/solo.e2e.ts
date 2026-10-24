import { expect, type Page, test } from "@playwright/test";

/** Starts a small game with a short warm-up and takes the first realm. */
async function startGame(page: Page) {
  await page.goto("/?warmup=10");
  await page.getByLabel("Map size").selectOption("300");
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
  await expect(page.getByTestId("realm-population")).toHaveText(/^👥 [\d,]+$/);

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

  // Policies open on the production tax; with nothing selected, the slider sets a realm-wide rate.
  await openTab(page, "Policies");
  await page.getByRole("button", { name: "Clear", exact: true }).click();
  await expect(page.getByTestId("action-target")).toHaveText("Actions: your whole realm");
  await expect(page.getByLabel("Policy", { exact: true })).toHaveValue("productionTaxRate");
  await page.getByLabel("Policy level").fill("10");
  await expect(page.getByLabel("Policy value")).toHaveValue("10");
  await page.getByRole("button", { name: "Set", exact: true }).click();
  await expect(page.getByTestId("policies")).toContainText("Production tax · all goods");
  await expect(page.getByTestId("policies")).toContainText("10%");

  await expect(page.getByTestId("policies").locator("th", { hasText: "Only in" })).toHaveCount(0);

  // A realm head tax shows up as the tax in force.
  await page.getByLabel("Policy", { exact: true }).selectOption("headTaxPerPersonPerDay");
  await page.getByLabel("Policy value").fill("0.25");
  await page.getByRole("button", { name: "Set", exact: true }).click();
  await expect(page.getByTestId("head-tax")).toContainText("0.25");
  // A negative head tax is an allowance paid to everyone.
  await page.getByLabel("Policy value").fill("-1");
  await page.getByRole("button", { name: "Set", exact: true }).click();
  await expect(page.getByTestId("head-tax")).toContainText("-1 mh");

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
  await expect(page.getByTestId("population")).not.toContainText(".");
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
  await page.getByLabel("Map size").selectOption("300");
  await page.getByLabel("Goods catalog").selectOption("small");
  await page.getByLabel("Realms").selectOption("12");
  await page.getByRole("button", { name: "New game" }).click();
  await expect(page.getByRole("heading", { name: "Choose your realm" })).toBeVisible({ timeout: 60_000 });
  await expect(page.locator(".realm-list button")).toHaveCount(12);
});

test("each panel shows its map layer, and flows when its checkbox is on", async ({ page }) => {
  await startGame(page);
  const legend = page.getByTestId("legend");
  const flowLegend = page.getByTestId("flow-legend");
  await expect(legend).toHaveCount(0); // the Area panel shows the realms, which need no legend

  await openTab(page, "Population");
  await expect(legend).toContainText("Population per area");
  await expect(page.getByTestId("population-total")).toHaveText(/^[\d,]+$/);
  await expect(page.getByTestId("births-deaths")).toHaveText(/^[+-]?<?[\d.,]+[kM]?\/day$/);
  await page.getByLabel("Show migration flows").check();
  await expect(flowLegend).toContainText("People moving per day");
  await expect(legend).toContainText("Population per area"); // both at once

  await openTab(page, "Goods");
  await expect(legend).toContainText("vs labor value");
  await expect(flowLegend).toHaveCount(0); // migration belongs to the Population panel
  await page.getByLabel("Show transport flows").check();
  await expect(flowLegend).toContainText("Goods carried per day");
  await expect(flowLegend).toContainText("t/day");
  // One good, in its own unit, then back to every good.
  const good = page.getByLabel("Transported good");
  const first = (await good.locator("option").nth(1).getAttribute("value")) as string;
  await good.selectOption(first);
  await expect(flowLegend).not.toContainText("t/day", { timeout: 5000 });
  await good.selectOption("-1");
  await expect(flowLegend).toContainText("t/day");

  await openTab(page, "Needs");
  await expect(legend).toContainText("Necessities met");
  await expect(page.getByTestId("needs").locator("tbody tr").first()).toBeVisible();

  await openTab(page, "Resources");
  await expect(legend).toContainText("Natural capacity of");
  const resource = page.getByLabel("Resource", { exact: true });
  const last = (await resource.locator("option").last().getAttribute("value")) as string;
  await resource.selectOption(last);
  await expect(legend).toContainText(`Natural capacity of ${await resource.locator("option:checked").textContent()}`);
  await expect(legend).toContainText("plains"); // the stripes lie over the terrain

  await openTab(page, "Jobs");
  await expect(legend).toContainText("Employment rate");
  await openTab(page, "Policies");
  await expect(legend).toContainText("Average wage");
  await openTab(page, "Area");
  await expect(flowLegend).toHaveCount(0);
  await expect(legend).toHaveCount(0);
});

test("a good in the market table opens it in the Goods panel", async ({ page }) => {
  await startGame(page);
  const name = (await page.getByTestId("market").locator("tbody tr button").nth(1).textContent()) as string;
  await page.getByTestId("market").locator("tbody tr button").nth(1).click();
  await expect(page.getByRole("navigation").getByRole("button", { name: "Goods", exact: true })).toHaveClass(/active/);
  await expect(page.getByLabel("Good", { exact: true }).locator("option:checked")).toHaveText(name);
  await expect(page.getByTestId("price-low")).toBeVisible();
});

test("rejected commands are explained", async ({ page }) => {
  await startGame(page);
  await openTab(page, "Armies");
  await page.getByLabel("Recruits").fill("1000000");
  await page.getByRole("button", { name: "Recruit", exact: true }).click();
  await expect(page.locator(".toast")).toContainText("not enough");
});
