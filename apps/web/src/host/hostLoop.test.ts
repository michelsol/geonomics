import { unpack } from "@geonomics/net";
import type { Snapshot } from "@geonomics/sim";
import { describe, expect, it } from "vitest";
import { createGame } from "./createGame";
import { HostLoop } from "./hostLoop";
import { type FromWorker, LOCAL_PLAYER } from "./protocol";

/** A fake clock and scheduler: tasks run when the clock passes their time. */
function fakeTime() {
  let now = 0;
  let tasks: { at: number; run: () => void }[] = [];
  return {
    now: () => now,
    schedule: (run: () => void, delay: number) => tasks.push({ at: now + delay, run }),
    advance(ms: number, maxTasks = 100_000) {
      const end = now + ms;
      for (let i = 0; i < maxTasks; i++) {
        tasks.sort((a, b) => a.at - b.at);
        const next = tasks[0];
        if (!next || next.at > end) break;
        tasks = tasks.slice(1);
        now = next.at;
        next.run();
      }
      now = end;
    },
  };
}

function setup(speed: number | "max" = 5) {
  const world = createGame({ catalog: "small", areas: 60, seed: 3, realms: 4, warmupDays: 0 }, () => {});
  (world.governments[0] as (typeof world.governments)[number]).controller = { kind: "human", player: LOCAL_PLAYER };
  const time = fakeTime();
  const messages: FromWorker[] = [];
  const loop = new HostLoop({ world, post: (m) => messages.push(m), ...time, speed });
  loop.setPlayer(LOCAL_PLAYER, 0, true);
  const count = (type: FromWorker["type"]) => messages.filter((m) => m.type === type).length;
  return { world, time, messages, loop, count };
}

describe("HostLoop", () => {
  it("runs ticks at the target speed and only while running", () => {
    const { world, time, loop } = setup(5);
    time.advance(1000);
    expect(world.tick).toBe(0); // starts paused
    loop.resume(); // the first tick runs at once, then one every 200 ms
    time.advance(999);
    expect(world.tick).toBe(5);
    loop.setSpeed(10);
    time.advance(1000);
    expect(world.tick).toBeGreaterThanOrEqual(14);
    expect(world.tick).toBeLessThanOrEqual(16);
    loop.pause();
    const paused = world.tick;
    time.advance(5000);
    expect(world.tick).toBe(paused);
  });

  it("posts snapshots and price tables at their wall-clock rates", () => {
    const { time, loop, count, world } = setup(10);
    loop.resume();
    time.advance(2000);
    const { snapshotRate, priceTableRate } = world.config.network;
    expect(count("snapshot")).toBeGreaterThanOrEqual(2 * snapshotRate - 1);
    expect(count("snapshot")).toBeLessThanOrEqual(2 * snapshotRate + 1);
    expect(count("priceTable")).toBeGreaterThanOrEqual(2 * priceTableRate - 1);
    expect(count("priceTable")).toBeLessThanOrEqual(2 * priceTableRate + 1);
  });

  it("applies queued commands on the next tick, at once while paused, and reports rejections", () => {
    const { world, time, loop, messages } = setup(5);
    loop.enqueue({ type: "setWageOffer", area: world.governments[0]?.capital as number, wageOffer: 3 });
    const capital = world.governments[0]?.capital as number;
    expect(world.governments[0]?.areaStates.get(capital)?.wageOffer).toBe(3);
    expect(messages.at(-1)?.type).toBe("snapshot");

    loop.resume();
    loop.enqueue({ type: "setWageOffer", area: capital, wageOffer: 4 });
    expect(world.governments[0]?.areaStates.get(capital)?.wageOffer).toBe(3);
    time.advance(250);
    expect(world.governments[0]?.areaStates.get(capital)?.wageOffer).toBe(4);

    loop.enqueue({ type: "setWageOffer", area: capital, wageOffer: 99 });
    time.advance(250);
    expect(messages.find((m) => m.type === "rejected")).toMatchObject({
      type: "rejected",
      reason: expect.stringMatching(/wage/),
    });
  });

  it("carries the trade flows of the chosen good, sending a snapshot at once while paused", () => {
    const { time, messages, loop } = setup(5);
    const snapshots = () => messages.flatMap((m) => (m.type === "snapshot" ? [m.snapshot] : []));
    loop.setFlowGood(1);
    expect(snapshots()).toHaveLength(1);
    expect(snapshots().at(-1)?.edges.goodFlow).not.toBeNull();
    loop.setFlowGood(1); // unchanged: nothing sent
    expect(snapshots()).toHaveLength(1);
    loop.setFlowGood(null);
    expect(snapshots().at(-1)?.edges.goodFlow).toBeNull();
    loop.setFlowGood(2);
    loop.resume();
    time.advance(1000);
    expect(snapshots().length).toBeGreaterThan(3);
    expect(
      snapshots()
        .slice(2)
        .every((s) => s.edges.goodFlow !== null),
    ).toBe(true);
  });

  it("sends each joined player its own snapshot, packed, and spectators public data only", async () => {
    const { world, messages, loop } = setup(5);
    (world.governments[1] as (typeof world.governments)[number]).controller = { kind: "ai", personality: "idle" };
    loop.setPlayer("bob", 1, true);
    loop.setPlayer("eve", null, true);
    expect(world.governments[1]?.controller).toEqual({ kind: "human", player: "bob" });
    await new Promise((resolve) => setTimeout(resolve, 50)); // packing is asynchronous
    const remote = messages.flatMap((m) => (m.type === "remote" ? [m] : []));
    const unpacked = await Promise.all(remote.map(async (m) => ({ to: m.to, message: await unpack(m.bytes) })));
    const snapshotFor = (player: string) =>
      unpacked.find((u) => u.to === player && (u.message as { type: string }).type === "snapshot")?.message as
        | { snapshot: Snapshot }
        | undefined;
    expect(snapshotFor("bob")?.snapshot.government?.id).toBe(1);
    expect(snapshotFor("bob")?.snapshot.detail.length).toBeGreaterThan(0);
    expect(snapshotFor("eve")?.snapshot.government).toBeNull();
    expect(snapshotFor("eve")?.snapshot.detail).toEqual([]);
    expect(unpacked.some((u) => u.to === null && (u.message as { type: string }).type === "priceTable")).toBe(true);

    // Taking another realm gives the first back to the idle AI; stopping to watch keeps the realm.
    loop.setPlayer("bob", 2, false);
    expect(world.governments[1]?.controller.kind).toBe("ai");
    expect(world.governments[2]?.controller).toEqual({ kind: "human", player: "bob" });
  });

  it("applies a joined player's commands for its own realm only, and routes rejections back", () => {
    const { world, messages, loop } = setup(5);
    loop.setPlayer("bob", 1, true);
    const own = world.governments[1]?.capital as number;
    const other = world.governments[0]?.capital as number;
    loop.enqueue({ type: "setWageOffer", area: own, wageOffer: 2 }, "bob");
    expect(world.governments[1]?.areaStates.get(own)?.wageOffer).toBe(2);
    loop.enqueue({ type: "setWageOffer", area: other, wageOffer: 2 }, "bob");
    expect(world.governments[0]?.areaStates.get(other)?.wageOffer).toBe(1);
    expect(messages.find((m) => m.type === "rejected")).toMatchObject({ to: "bob" });
    loop.enqueue({ type: "setWageOffer", area: own, wageOffer: 2 }, "nobody");
    expect(messages.filter((m) => m.type === "rejected").at(-1)).toMatchObject({ to: "nobody" });
  });

  it("runs back to back at max speed, yielding through the scheduler", () => {
    const { world, time, loop } = setup("max");
    loop.resume();
    time.advance(0, 20);
    expect(world.tick).toBe(20);
    loop.stop();
  });
});
