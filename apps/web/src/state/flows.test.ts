import type { GovernmentSummary, Snapshot, StaticData, StaticEdge } from "@geonomics/sim";
import { describe, expect, it } from "vitest";
import { realmFlows } from "./selectors";

// Four areas in a row: 0 and 1 belong to realm 0 (capital 0), 2 to realm 1 (no capital), 3 is neutral.
const data = { areas: [0, 1, 2, 3].map((i) => ({ x: 100 * i, y: 0, z: 0 })), map: null } as unknown as StaticData;
const edges = [
  [0, 1], // inside realm 0
  [1, 2],
  [0, 2],
  [2, 3],
].map(([areaA, areaB]) => ({ areaA, areaB })) as unknown as StaticEdge[];
const governments = [{ capital: 0 }, { capital: null }] as unknown as GovernmentSummary[];

function snapshot(migration: number[], goodFlow: number[] | null): Snapshot {
  return {
    areas: { owner: Int16Array.from([0, 0, 1, -1]), population: Float32Array.from([10, 10, 30, 5]) },
    edges: { migration: Float32Array.from(migration), goodFlow: goodFlow ? Float32Array.from(goodFlow) : null },
  } as unknown as Snapshot;
}

describe("flows between realms", () => {
  it("sum transport across every border edge, each direction apart, capital to capital", () => {
    // Per edge: A→B, then B→A.
    const flows = realmFlows(data, snapshot([0, 0, 0, 0], [50, 50, 3, 1, 4, 0, 0, 2]), edges, governments, "transport");
    const between = (fromX: number, toX: number) => flows.find((f) => f.from.x === fromX && f.to.x === toX)?.flow;
    expect(flows).toHaveLength(3); // the edge inside realm 0 is left out
    expect(between(0, 200)).toBe(7); // realm 0 (its capital, area 0) to realm 1 (its only area, 2): 3 + 4
    expect(between(200, 0)).toBe(1);
    expect(between(300, 200)).toBe(2); // neutral to realm 1
  });

  it("net migration into one arrow toward the group that gains people", () => {
    // Positive: from area A to area B. Realm 0 → realm 1: +5 on edge 1, −2 on edge 2: a net of 3.
    const flows = realmFlows(data, snapshot([9, 5, -2, -4], null), edges, governments, "migration");
    expect(flows).toContainEqual({ from: { x: 0, y: 0, z: 0 }, to: { x: 200, y: 0, z: 0 }, flow: 3 });
    expect(flows).toContainEqual({ from: { x: 300, y: 0, z: 0 }, to: { x: 200, y: 0, z: 0 }, flow: 4 });
    expect(flows).toHaveLength(2);
  });

  it("anchor a realm with no capital, and the neutral group, at their population-weighted center", () => {
    const neutral = snapshot([0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0]);
    neutral.areas.owner[1] = -1; // areas 1 and 3 neutral: their center weighs 10 at x 100 and 5 at x 300
    const flows = realmFlows(data, neutral, edges, governments, "transport");
    expect(flows).toEqual([]);
    neutral.edges.goodFlow?.set([6, 0], 0); // area 0 (realm 0) to area 1 (neutral)
    const [flow] = realmFlows(data, neutral, edges, governments, "transport");
    expect(flow?.to.x).toBeCloseTo((10 * 100 + 5 * 300) / 15, 6);
    expect(flow?.flow).toBe(6);
  });
});
