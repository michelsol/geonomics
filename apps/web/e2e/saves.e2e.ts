import { expect, type Page, test } from "@playwright/test";

/** Starts a small game with a short warm-up and takes the first realm. */
async function startGame(page: Page) {
  await page.goto("/?warmup=10");
  await page.getByLabel("Map size").fill("300");
  await page.getByLabel("Goods catalog").selectOption("small");
  await page.getByRole("button", { name: "New game" }).click();
  await enterFirstRealm(page);
}

async function enterFirstRealm(page: Page) {
  await expect(page.getByRole("heading", { name: "Choose your realm" })).toBeVisible({ timeout: 60_000 });
  await page.locator(".realm-list button").first().click();
  await expect(page.getByTestId("area-name")).toBeVisible();
}

const day = async (page: Page) => Number((await page.getByTestId("game-day").textContent())?.replace(/\D/g, ""));

/** Runs the game a few days, pauses it, and returns the day it stopped on. */
async function playAFewDays(page: Page): Promise<number> {
  await expect.poll(() => day(page), { timeout: 10_000 }).toBeGreaterThan(4);
  await page.getByRole("button", { name: "Pause" }).click();
  await page.waitForTimeout(500);
  return day(page);
}

/** Games in the browser's save database. */
const savedGames = (page: Page) =>
  page.evaluate(
    () =>
      new Promise<number>((resolve) => {
        const request = indexedDB.open("geonomics");
        request.onsuccess = () => {
          const db = request.result;
          if (!db.objectStoreNames.contains("info")) return resolve(0);
          const count = db.transaction("info").objectStore("info").count();
          count.onsuccess = () => resolve(count.result);
        };
        request.onerror = () => resolve(0);
      }),
  );

test("an exported save loads into a new session at the same day", async ({ page }) => {
  await startGame(page);
  const saved = await playAFewDays(page);

  await page.getByRole("navigation").getByRole("button", { name: "Game", exact: true }).click();
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "Export save" }).click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/^geonomics-day-\d+\.geonomics$/);
  const file = await download.path();

  await page.getByRole("button", { name: "End game" }).click();
  await page.getByRole("button", { name: "New game" }).click();
  await page.getByLabel("Save file").setInputFiles(file);
  await enterFirstRealm(page);
  expect(await day(page)).toBeGreaterThanOrEqual(saved);
  expect(await day(page)).toBeLessThan(saved + 10);
});

test("a game saves itself when its tab is hidden, and continues after a reload", async ({ page }) => {
  await startGame(page);
  await playAFewDays(page);
  await page.evaluate(() => {
    Object.defineProperty(document, "hidden", { value: true, configurable: true });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect.poll(() => savedGames(page), { timeout: 10_000 }).toBe(1);
  const saved = await day(page);

  await page.reload();
  const entry = page.getByTestId("saved-game");
  await expect(entry).toHaveCount(1);
  await expect(entry).toContainText(`day ${saved}`);
  await entry.getByRole("button", { name: "Continue" }).click();
  await enterFirstRealm(page);
  expect(await day(page)).toBeGreaterThanOrEqual(saved);
});

test("a file that is not a save is refused on the menu", async ({ page }) => {
  await page.goto("/");
  await page
    .getByLabel("Save file")
    .setInputFiles({ name: "notes.txt", mimeType: "text/plain", buffer: Buffer.from("hi") });
  await expect(page.getByRole("alert")).toHaveText("This file is not a Geonomics save");
  await expect(page.getByRole("button", { name: "New game" })).toBeVisible();
});
