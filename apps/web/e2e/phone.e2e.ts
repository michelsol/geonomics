import { expect, type Page, test } from "@playwright/test";

/** The page is no wider than the screen: nothing makes it scroll sideways. */
const fitsTheScreen = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);

const PANELS = ["Area", "Goods", "Population", "Needs", "Resources", "Policies", "Jobs", "Armies", "Diplomacy", "Game"];

/** Every screen and panel fits the width, and the top bar keeps its figures together on screen. */
async function checkLayout(page: Page) {
  await page.goto("/?warmup=10");
  expect(await fitsTheScreen(page)).toBe(true);
  await page.getByLabel("Map size").fill("300");
  await page.getByLabel("Goods catalog").selectOption("small");
  await page.getByRole("button", { name: "New game" }).click();
  await expect(page.getByRole("heading", { name: "Choose your realm" })).toBeVisible({ timeout: 60_000 });
  expect(await fitsTheScreen(page)).toBe(true);
  await page.locator(".realm-list button").first().click();
  await expect(page.getByTestId("area-name")).toBeVisible();

  // The realm's population shares a row of the top bar with the day and the treasury, whatever the font.
  const row = async (id: string) => (await page.getByTestId(id).boundingBox())?.y;
  expect(await row("realm-population")).toBe(await row("game-day"));
  const population = await page.getByTestId("realm-population").boundingBox();
  expect(population && population.x + population.width).toBeLessThanOrEqual(page.viewportSize()?.width ?? 0);

  // The selection bar shows in the peeking sheet, with its buttons on screen.
  const bar = await page.getByTestId("selection-bar").boundingBox();
  expect(bar && bar.y + bar.height).toBeLessThanOrEqual(page.viewportSize()?.height ?? 0);
  const clear = await page.getByRole("button", { name: "Clear", exact: true }).boundingBox();
  expect(clear && clear.x + clear.width).toBeLessThanOrEqual(page.viewportSize()?.width ?? 0);
  for (const tab of PANELS) {
    const button = page.getByRole("navigation").getByRole("button", { name: tab, exact: true });
    await button.click();
    await expect(button).toBeInViewport({ ratio: 0.95 }); // the tabs scroll to show the chosen one
    expect(await fitsTheScreen(page), tab).toBe(true);
  }
}

test("every screen and panel fits a phone's width", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "phone", "phone layout only");
  await checkLayout(page);
});

test.describe("on a small phone", () => {
  // 360 px is a common Android width; it also stands in for wider system fonts, such as the CI runner's.
  test.use({ viewport: { width: 360, height: 780 } });
  test("every screen and panel fits", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "phone", "phone layout only");
    await checkLayout(page);
  });
});
