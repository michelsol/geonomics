import {
  buildSnapshot,
  createConfig,
  encodePriceTable,
  foundGovernments,
  generateMap,
  initializeWorld,
  loadCatalog,
  runTick,
  type Snapshot,
} from "@geonomics/sim";
import { describe, expect, it } from "vitest";
import small from "../../../data/goods/small.json";
import { decode, encode } from "./codec";
import { MAX_FRAME, pack, Reassembler, toFrames, unpack } from "./frames";

function world() {
  const catalog = loadCatalog(small);
  const { world, capitals } = generateMap(catalog, createConfig(catalog, { map: { landAreaCount: 80 } }), 4);
  initializeWorld(world);
  foundGovernments(world, capitals);
  for (let i = 0; i < 5; i++) runTick(world);
  return world;
}

describe("codec", () => {
  it("round-trips a snapshot with every kind of typed array", () => {
    const w = world();
    const snapshot = buildSnapshot(w, 0, undefined, { flowGood: 1 });
    const back = decode<Snapshot>(encode(snapshot));
    expect(back.areas.owner).toBeInstanceOf(Int16Array);
    expect(back.areas.population).toBeInstanceOf(Float32Array);
    expect(back.edges.flags).toBeInstanceOf(Uint8Array);
    expect(back.detail[0]?.stock).toBeInstanceOf(Float32Array);
    expect(back).toEqual(snapshot);
    const table = encodePriceTable(w);
    expect(decode<{ table: Uint16Array }>(encode({ table })).table).toEqual(table);
  });

  it("sends mostly-zero float arrays sparse, and keeps them exact", () => {
    const sparse = new Float32Array(1000);
    sparse[3] = 1.5;
    sparse[997] = -2;
    const dense = Float32Array.from({ length: 1000 }, (_, i) => i + 0.5);
    expect(encode(sparse).byteLength).toBeLessThan(40);
    expect(encode(dense).byteLength).toBeGreaterThan(4000);
    expect(decode(encode(sparse))).toEqual(sparse);
    expect(decode(encode(dense))).toEqual(dense);
    expect(decode(encode(new Float64Array([1, 2.25])))).toEqual(new Float64Array([1, 2.25]));
    expect(decode(encode(new Int32Array([-7, 9])))).toEqual(new Int32Array([-7, 9]));
  });
});

describe("frames", () => {
  it("packs, cuts, and joins a 2 MB message back", async () => {
    const big = { values: Float32Array.from({ length: 512 * 1024 }, () => Math.random()) };
    const packed = await pack(big);
    const frames = toFrames(packed, 7);
    expect(frames.length).toBeGreaterThan(2);
    expect(frames.every((frame) => frame.byteLength <= MAX_FRAME + 9)).toBe(true);
    const reassembler = new Reassembler();
    const results = frames.map((frame) => reassembler.push(frame));
    expect(results.slice(0, -1).every((r) => r === null)).toBe(true);
    expect(await unpack(results.at(-1) as Uint8Array)).toEqual(big);
  });

  it("refuses frames out of order", () => {
    const frames = toFrames(new Uint8Array(3 * 10), 1, 10);
    const reassembler = new Reassembler();
    reassembler.push(frames[0] as Uint8Array);
    expect(() => reassembler.push(frames[2] as Uint8Array)).toThrow(/order/);
  });
});
