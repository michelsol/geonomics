import { expect, test } from "@playwright/test";

// Toolchain check: the production build loads in a real browser.
test("app shell loads", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Geonomics" })).toBeVisible();
});

test("the guide opens from the menu and comes back", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "How to play" }).click();
  await expect(page.getByRole("heading", { name: "How to play" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Saving" })).toBeVisible();
  await page.getByRole("button", { name: "Back" }).click();
  await expect(page.getByRole("button", { name: "New game" })).toBeVisible();
});
