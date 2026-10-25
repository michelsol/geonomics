// AI-only games. The full exit runs (1,000 areas, 2,000 days) are `pnpm headless -- --ai <mix>`;
// this shorter one keeps the suite fast.
import { expect, it } from "vitest";
import { runAiGame } from "./aiGame";
import { readCatalog } from "./catalogs";

it("an AI-only game keeps every personality alive, grows, trades, and starts and ends wars", () => {
  const report = runAiGame({ catalog: readCatalog("small"), areas: 300, realms: 6, mix: "balanced", days: 600 });
  for (const [personality, { alive, total }] of Object.entries(report.alive)) {
    expect(total, personality).toBeGreaterThan(0);
    expect(alive, personality).toBeGreaterThan(0);
  }
  expect(report.population).toBeGreaterThan(report.startPopulation);
  expect(report.tonnage).toBeGreaterThan(report.startTonnage);
  expect(report.warsDeclared).toBeGreaterThan(0);
  expect(report.warsEnded).toBeGreaterThan(0);
  expect(report.rejectedCommands).toBe(0);
}, 120_000);
