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

  // A realm head tax shows up as the tax in force.
  await openTab(page, "Realm");
  await page.getByLabel("Policy", { exact: true }).selectOption("headTaxPerPersonPerDay");
  await page.getByLabel("Policy value").fill("0.25");
  await page.getByRole("button", { name: "Set", exact: true }).click();
  await expect(page.getByTestId("head-tax")).toContainText("0.25");

  // Recruiting creates an army.
  await openTab(page, "Armies");
  await page.getByLabel("Recruits").fill("200");
  await page.getByRole("button", { name: "Recruit", exact: true }).click();
  await expect(page.getByTestId("army")).toHaveCount(1);

  // War on a neighbor is recorded.
  await openTab(page, "Diplomacy");
  await page.getByRole("button", { name: "Declare war" }).first().click();
  await expect(page.getByText("at war").first()).toBeVisible();

  // Ending the session shows the summary.
  await openTab(page, "Realm");
  await page.getByRole("button", { name: "End game" }).click();
  await expect(page.getByRole("heading", { name: "Session over" })).toBeVisible();
  await page.getByRole("button", { name: "New game" }).click();
  await expect(page.getByRole("heading", { name: "Geonomics" })).toBeVisible();
});

test("rejected commands are explained", async ({ page }) => {
  await startGame(page);
  await openTab(page, "Armies");
  await page.getByLabel("Recruits").fill("1000000");
  await page.getByRole("button", { name: "Recruit", exact: true }).click();
  await expect(page.locator(".toast")).toContainText("not enough");
});
