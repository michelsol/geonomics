import { expect, test } from "@playwright/test";

// Roadmap stage 8 exit: an acceptable frame rate on a 3,000-area map while the simulation runs.
test("the map stays smooth on a 3,000-area map", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "measured on desktop only");
  test.setTimeout(180_000);
  await page.goto("/?warmup=0");
  await page.getByLabel("Map size").selectOption("3000");
  await page.getByLabel("Goods catalog").selectOption("large");
  await page.getByRole("button", { name: "New game" }).click();
  await expect(page.getByRole("heading", { name: "Choose your realm" })).toBeVisible({ timeout: 120_000 });
  await page.locator(".realm-list button").first().click();
  await expect(page.getByTestId("map-canvas")).toBeVisible();
  // Measure with the busiest overlay: trade arrows on every edge, redrawn with each snapshot.
  await page.getByLabel("Map layer").selectOption("transport");
  await page.waitForTimeout(2000);

  // Count frames for five seconds while dragging the map back and forth.
  const box = await page.getByTestId("map-canvas").boundingBox();
  if (!box) throw new Error("map canvas has no size");
  const counting = page.evaluate(
    () =>
      new Promise<number>((resolve) => {
        let frames = 0;
        const start = performance.now();
        const frame = (now: number) => {
          frames++;
          if (now - start < 5000) requestAnimationFrame(frame);
          else resolve((frames * 1000) / (now - start));
        };
        requestAnimationFrame(frame);
      }),
  );
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  for (let i = 0; i < 10; i++) {
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    await page.mouse.move(cx + 150, cy + 60, { steps: 10 });
    await page.mouse.move(cx, cy, { steps: 10 });
    await page.mouse.up();
  }
  const fps = await counting;
  const status = await page.locator(".topbar .stat.muted").textContent();
  testInfo.annotations.push({ type: "performance", description: `${fps.toFixed(1)} fps; worker ${status}` });
  console.log(`3,000 areas: ${fps.toFixed(1)} fps; worker ${status}`);
  // CI runners render without a GPU, so they only guard against a collapse; the 30 fps bar applies locally.
  expect(fps).toBeGreaterThan(process.env.CI ? 10 : 30);
});
