import { type Browser, expect, type Page, test } from "@playwright/test";

// One browser hosts, another joins with its code, both command and see each other's realms.

const BROKER = "?peer=localhost:8787";

async function openTab(page: Page, name: string) {
  await page.getByRole("navigation").getByRole("button", { name, exact: true }).click();
}

async function host(browser: Browser) {
  const page = await (await browser.newContext()).newPage();
  await page.goto(`/${BROKER}&warmup=10`);
  await page.getByLabel("Map size").selectOption("300");
  await page.getByLabel("Goods catalog").selectOption("small");
  await page.getByLabel("Realms").selectOption("4");
  await page.getByRole("button", { name: "New game" }).click();
  await expect(page.getByRole("heading", { name: "Choose your realm" })).toBeVisible({ timeout: 60_000 });
  await page.getByRole("button", { name: "Invite players" }).click();
  const link = await page.getByTestId("join-link").inputValue({ timeout: 20_000 });
  const code = (await page.getByTestId("invite-code").textContent()) ?? "";
  expect(code).toMatch(/^[a-z2-9]{6}$/); // a short code, to type from one device into another
  expect(link).toMatch(new RegExp(`#join=${code}$`));
  expect(link).toContain("peer=localhost");
  return { page, link, code };
}

test("a host and a joined player share a game", async ({ browser }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "two-browser session on desktop only");
  test.setTimeout(180_000);
  const { page: hostPage, code } = await host(browser);

  // The guest types the code, as read from another screen (capitals included), names itself and joins the lobby.
  const guest = await (await browser.newContext()).newPage();
  await guest.goto(`/${BROKER}`);
  await guest.getByLabel("Game code").fill(code.toUpperCase());
  await guest.getByRole("button", { name: "Join", exact: true }).click();
  await guest.getByLabel("Your name").fill("Bob");
  await guest.getByRole("button", { name: "Join" }).click();
  await expect(guest.getByRole("heading", { name: "Choose your realm" })).toBeVisible({ timeout: 30_000 });
  await expect(hostPage.getByTestId("players")).toContainText("Bob");

  // The guest takes the second realm; the host sees it taken and starts with the first.
  const realms = guest.locator(".realm-list button");
  await realms.nth(1).click();
  await expect(guest.getByTestId("map-canvas")).toBeVisible({ timeout: 30_000 });
  await expect(hostPage.locator(".realm-list button").nth(1)).toBeDisabled();
  await expect(hostPage.locator(".realm-list button").nth(1)).toContainText("Bob");
  await hostPage.locator(".realm-list button").first().click();
  await expect(hostPage.getByTestId("map-canvas")).toBeVisible();
  await expect(guest.getByTestId("host-status")).toContainText("Running", { timeout: 15_000 });

  // The guest recruits an army; the host sees it among the other armies.
  await openTab(guest, "Armies");
  await guest.getByLabel("Recruits").fill("150");
  await guest.getByRole("button", { name: "Recruit", exact: true }).click();
  await expect(guest.getByTestId("army")).toHaveCount(1, { timeout: 15_000 });
  await openTab(hostPage, "Armies");
  await expect(hostPage.getByText(/150 soldiers of/)).toBeVisible({ timeout: 15_000 });

  // The host declares war on the guest's realm; the guest sees it, with the host's name beside the realm.
  await openTab(hostPage, "Diplomacy");
  const guestRealm = hostPage.locator('[data-testid^="relation-"]', { hasText: "Bob" });
  await guestRealm.getByRole("button", { name: "Declare war" }).click();
  await expect(guestRealm).toContainText("at war", { timeout: 15_000 });
  await openTab(guest, "Diplomacy");
  await expect(guest.locator('[data-testid^="relation-"]', { hasText: "Host" })).toContainText("at war", {
    timeout: 15_000,
  });

  // The guest sets an income tax for its realm.
  await openTab(guest, "Policies");
  await guest.getByLabel("Income tax · all bands level").fill("12");
  await guest.getByRole("button", { name: "Set Income tax · all bands", exact: true }).click();
  await expect(guest.getByTestId("policies")).toContainText("12%", { timeout: 15_000 });

  // Pausing on the host shows on the guest.
  await hostPage.getByRole("button", { name: "Pause" }).click();
  await expect(guest.getByTestId("host-status")).toContainText("Paused", { timeout: 15_000 });
  await expect(guest.getByTestId("status-banner")).toContainText("Host paused");
  await hostPage.getByRole("button", { name: "Resume" }).click();

  // A reload of the guest's tab reconnects to the same realm without asking again.
  await guest.reload();
  await expect(guest.getByTestId("map-canvas")).toBeVisible({ timeout: 30_000 });
  await openTab(guest, "Armies");
  await expect(guest.getByTestId("army")).toHaveCount(1, { timeout: 15_000 });
  await openTab(hostPage, "Game");
  await expect(hostPage.getByTestId("players")).toContainText("Bob");
});
