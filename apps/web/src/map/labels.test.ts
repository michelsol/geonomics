import type { GovernmentSummary, Snapshot } from "@geonomics/sim";
import { describe, expect, it } from "vitest";
import { realmLabels } from "./labels";

// A row of 20 areas, 10 wide: realm 0 holds the first 16, realm 1 the next 4; realm 2 holds none; realm 3 has fallen.
const areas = Array.from({ length: 20 }, (_, i) => ({ x: 10 * i + 5, y: 5 }));
const data = { areas, waters: [], map: { width: 200, height: 10 } } as unknown as Parameters<typeof realmLabels>[0];
const owner = Int16Array.from(areas.map((_, i) => (i < 16 ? 0 : 1)));
const snapshot = { areas: { owner, population: new Float32Array(20).fill(100) } } as unknown as Snapshot;
const governments = ["Anulmon", "Iselard", "Tooth", "Fallen"].map((name, id) => ({
  id,
  name,
  isEliminated: id === 3,
})) as unknown as GovernmentSummary[];

describe("realm labels", () => {
  it("name every realm holding land, on one of its own areas, in capitals", () => {
    const labels = realmLabels(data, snapshot, governments);
    expect(labels.map((l) => l.text)).toEqual(["ANULMON", "ISELARD"]);
    const isel = labels[1] as (typeof labels)[number];
    expect([165, 175, 185, 195]).toContain(isel.x); // inside realm 1, near its center of 180
  });

  it("follow the population-weighted center", () => {
    const crowded = { areas: { owner, population: new Float32Array(20).fill(1) } } as unknown as Snapshot;
    crowded.areas.population[2] = 1000;
    expect(realmLabels(data, crowded, governments)[0]?.x).toBe(25);
  });

  it("grow with the square root of the area count, and shrink with longer names", () => {
    const [anulmon, iselard] = realmLabels(data, snapshot, governments);
    expect((anulmon?.size as number) / (iselard?.size as number)).toBeCloseTo(2, 9); // 16 areas against 4
    const renamed = governments.map((g) => (g.id === 1 ? { ...g, name: "Isel" } : g));
    expect((realmLabels(data, snapshot, renamed)[1]?.size as number) / (iselard?.size as number)).toBeCloseTo(7 / 4, 9);
  });
});
