import { expect, type Locator, type Page, test } from "@playwright/test";

/** Starts a small game with a short warm-up and takes the first realm, paused. */
async function startGame(page: Page) {
  await page.goto("/?warmup=10");
  await page.getByLabel("Map size").selectOption("300");
  await page.getByLabel("Goods catalog").selectOption("small");
  await page.getByRole("button", { name: "New game" }).click();
  await expect(page.getByRole("heading", { name: "Choose your realm" })).toBeVisible({ timeout: 60_000 });
  await page.locator(".realm-list button").first().click();
  await expect(page.getByTestId("area-name")).toBeVisible();
  await page.getByRole("button", { name: "Pause" }).click();
}

/** The middle of the map part not covered by the phone's bottom sheet, where the capital opens. */
async function mapCenter(page: Page, canvas: Locator) {
  const box = await canvas.boundingBox();
  if (!box) throw new Error("map canvas has no size");
  const sheet = await page.locator(".side").boundingBox();
  const bottom = sheet && sheet.y > box.y + 100 ? Math.min(box.y + box.height, sheet.y) : box.y + box.height;
  return { x: box.width / 2, y: (bottom - box.y) / 2 };
}

/** Draws a triangle: a double click on its first corner, a click on each other, and a click back on the first. */
async function lasso(canvas: Locator, corners: { x: number; y: number }[], remove = false) {
  const [first, ...rest] = corners as [{ x: number; y: number }, ...{ x: number; y: number }[]];
  await canvas.dblclick({ position: first });
  if (remove) await canvas.page().getByRole("button", { name: "Remove", exact: true }).click();
  for (const corner of rest) await canvas.click({ position: corner });
  await canvas.page().waitForTimeout(350); // not a double click with the last corner
  await canvas.click({ position: first });
}

/** Areas selected: the banner's count, or one or none when it is gone. */
async function selected(page: Page): Promise<number> {
  const banner = page.getByTestId("selection-count");
  if ((await banner.count()) === 0) return (await page.getByTestId("area-name").count()) > 0 ? 1 : 0;
  return Number((await banner.textContent())?.replace(/\D/g, ""));
}

test("regions drawn on the map select their areas, add up, and take actions", async ({ page }) => {
  await startGame(page);
  const canvas = page.getByTestId("map-canvas");
  const c = await mapCenter(page, canvas);
  // Triangles around the capital, which opens at the center: a larger one holds the smaller.
  const triangle = (r: number) => [
    { x: c.x - r, y: c.y - r },
    { x: c.x + r, y: c.y - r },
    { x: c.x, y: c.y + r },
  ];
  const small = triangle(60);
  const large = triangle(150);

  // One polygon.
  await lasso(canvas, large);
  await expect.poll(() => selected(page)).toBeGreaterThan(1);
  const whole = await selected(page);
  await expect(page.getByTestId("selection-name")).toHaveText(`${whole} areas`);
  await expect(page.getByTestId("population")).toBeVisible();

  // A Remove polygon cuts the middle out; an Add polygon puts exactly that back.
  await lasso(canvas, small, true);
  await expect.poll(() => selected(page)).toBeLessThan(whole);
  await lasso(canvas, small);
  await expect.poll(() => selected(page)).toBe(whole);

  // The capital is inside: Shift-click takes it out, and puts it back.
  const shiftClick = () => canvas.click({ position: c, modifiers: ["Shift"] });
  await shiftClick();
  await expect.poll(() => selected(page)).toBe(whole - 1);
  await page.waitForTimeout(350); // two Shift-clicks, not a double click
  await shiftClick();
  await expect.poll(() => selected(page)).toBe(whole);

  // A tax for the selection is an override in each of the player's selected areas.
  await page.getByRole("navigation").getByRole("button", { name: "Policies", exact: true }).click();
  const scope = page.getByLabel("Policy area");
  const option = scope.locator("option", { hasText: "Selection (" });
  await expect(option).toHaveCount(1);
  const owned = Number((await option.textContent())?.match(/\((\d+)/)?.[1]);
  await scope.selectOption({ label: (await option.textContent()) as string });
  await page.getByLabel("Policy value").fill("12");
  await page.getByRole("button", { name: "Set", exact: true }).click();
  await expect(page.getByTestId("policies").locator("th", { hasText: "Only in" })).toHaveCount(owned);

  // Workers hired for the selection are a total, split over its areas.
  await page.getByRole("navigation").getByRole("button", { name: "Jobs", exact: true }).click();
  await page.getByLabel("Job", { exact: true }).selectOption("fortify");
  await page.getByLabel("New job workers").fill("1000");
  await page.getByRole("button", { name: "Hire" }).click();
  const job = page.getByTestId("job").first();
  await expect(job).toContainText("Fortify");
  await expect(job).toContainText(`${owned} areas`);
  await expect(job).toContainText("/ 1,000 workers");
});
