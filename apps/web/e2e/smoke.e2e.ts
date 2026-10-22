import { expect, test } from "@playwright/test";

// Toolchain check: the production build loads in a real browser.
test("app shell loads", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "GeoTrade" })).toBeVisible();
});
