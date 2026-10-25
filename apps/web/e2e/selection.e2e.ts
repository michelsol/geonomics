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

/** Drags the left mouse button (or another) through points on the map canvas. */
async function drag(
  page: Page,
  canvas: Locator,
  points: { x: number; y: number }[],
  button: "left" | "right" = "left",
) {
  const box = await canvas.boundingBox();
  if (!box) throw new Error("map canvas has no size");
  const [first, ...rest] = points as [{ x: number; y: number }, ...{ x: number; y: number }[]];
  await page.mouse.move(box.x + first.x, box.y + first.y);
  await page.mouse.down({ button });
  for (const point of rest) await page.mouse.move(box.x + point.x, box.y + point.y, { steps: 8 });
  await page.mouse.up({ button });
}

/** Areas selected: the bar's count, or one or none. */
async function selected(page: Page): Promise<number> {
  const count = page.getByTestId("selection-count");
  if ((await count.count()) === 0) return (await page.getByTestId("area-name").count()) > 0 ? 1 : 0;
  return Number((await count.textContent())?.replace(/\D/g, ""));
}

test("the brush paints areas into the selection, and actions follow it", async ({ page }) => {
  await startGame(page);
  const canvas = page.getByTestId("map-canvas");
  const c = await mapCenter(page, canvas);
  const across = (half: number, dy = 0) => [
    { x: c.x - half, y: c.y + dy },
    { x: c.x + half, y: c.y + dy },
  ];

  // A wide stroke through the capital, which opens at the center.
  await page.getByRole("button", { name: "Brush", exact: true }).click();
  await expect(page.getByTestId("brush-banner")).toBeVisible();
  await page.getByRole("button", { name: "Brush size L" }).click();
  await drag(page, canvas, across(120));
  await expect.poll(() => selected(page)).toBeGreaterThan(1);
  const whole = await selected(page);
  await expect(page.getByTestId("selection-name")).toHaveText(`${whole} areas`);
  await expect(page.getByTestId("population")).toBeVisible();

  // A thin Erase stroke cuts some out; the same stroke with Add puts exactly those back.
  await page.getByRole("button", { name: "Brush size S" }).click();
  await page.getByRole("button", { name: "Erase", exact: true }).click();
  await drag(page, canvas, across(20));
  await expect.poll(() => selected(page)).toBeLessThan(whole);
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await drag(page, canvas, across(20));
  await expect.poll(() => selected(page)).toBe(whole);

  // A right-button drag moves the map without painting; this one goes there and back.
  await page.getByRole("button", { name: "Brush size L" }).click();
  const [left, right] = across(120, 0.6 * c.y) as [{ x: number; y: number }, { x: number; y: number }];
  await drag(page, canvas, [left, right, left], "right");
  await page.waitForTimeout(200);
  expect(await selected(page)).toBe(whole);
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await expect(page.getByTestId("brush-banner")).toHaveCount(0);

  // Without the brush, Shift-click takes one area out, and puts it back.
  const shiftClick = () => canvas.click({ position: c, modifiers: ["Shift"] });
  await shiftClick();
  await expect.poll(() => selected(page)).toBe(whole - 1);
  await shiftClick();
  await expect.poll(() => selected(page)).toBe(whole);

  // A tax applies to the player's areas in the selection: an override in each.
  await page.getByRole("navigation").getByRole("button", { name: "Policies", exact: true }).click();
  const target = (await page.getByTestId("action-target").textContent()) ?? "";
  const owned = Number(/your (\d+) area/.exec(target)?.[1]);
  expect(owned).toBeGreaterThan(0);
  await page.getByLabel("Policy value").fill("12");
  await page.getByRole("button", { name: "Set", exact: true }).click();
  await expect(page.getByTestId("policies").locator("th", { hasText: "Only in" })).toHaveCount(owned);

  // Workers hired for the selection are a total, split over its areas.
  await page.getByRole("navigation").getByRole("button", { name: "Jobs", exact: true }).click();
  await page.getByLabel("Job good").selectOption({ label: "Bread" });
  await page.getByLabel("New job workers").fill("1000");
  await page.getByRole("button", { name: "Hire" }).click();
  const job = page.getByTestId("job").first();
  await expect(job).toContainText("Produce Bread");
  if (owned > 1) await expect(job).toContainText(`${owned} areas`);
  await expect(job).toContainText("/ 1,000 workers");

  // My realm makes the actions realm-wide.
  await page.getByRole("button", { name: "My realm", exact: true }).click();
  await expect(page.getByTestId("action-target")).toHaveText("Actions: your whole realm");
  await page.getByRole("navigation").getByRole("button", { name: "Policies", exact: true }).click();
  await expect(page.getByLabel("Policy", { exact: true })).toBeVisible();
  await expect(page.getByTestId("no-own-area")).toHaveCount(0);
});
