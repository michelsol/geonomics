import { expect, test } from "@playwright/test";

test("the app is installable, and plays offline once loaded", async ({ page, context }) => {
  await page.goto("/?warmup=10");

  // The manifest names the app and its icons, and every icon is served.
  const manifest = await page.evaluate(async () => {
    const link = document.querySelector<HTMLLinkElement>('link[rel="manifest"]');
    if (!link) return null;
    const json = (await (await fetch(link.href)).json()) as { name: string; display: string; icons: { src: string }[] };
    const icons = await Promise.all(json.icons.map(async (icon) => (await fetch(new URL(icon.src, link.href))).ok));
    return { name: json.name, display: json.display, icons };
  });
  expect(manifest).toEqual({ name: "Geonomics", display: "standalone", icons: [true, true, true] });

  // Once the service worker is active, the whole app is cached: a new game runs without the network.
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined));
  await context.setOffline(true);
  await page.reload();
  expect(await page.evaluate(() => navigator.serviceWorker.controller !== null)).toBe(true);
  await page.getByLabel("Map size").fill("300");
  await page.getByLabel("Goods catalog").selectOption("small");
  await page.getByRole("button", { name: "New game" }).click();
  await expect(page.getByRole("heading", { name: "Choose your realm" })).toBeVisible({ timeout: 60_000 });
  await page.locator(".realm-list button").first().click();
  await expect(page.getByTestId("map-canvas")).toBeVisible();
  await expect(page.getByTestId("area-name")).toBeVisible();
  await context.setOffline(false);
});
