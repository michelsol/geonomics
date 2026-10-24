import type { Command, GovernmentId, PlayerId } from "@geonomics/sim";
import { describe, expect, it, vi } from "vitest";
import { ClientSession, type ConnectionState } from "./client";
import { pack } from "./frames";
import { type HostGame, HostSession } from "./host";
import { type Link, memoryLinks } from "./link";
import { PROTOCOL_VERSION, type ToClient } from "./messages";

/** A game of three realms that records what the session asks of it. */
function fakeGame() {
  const calls: unknown[][] = [];
  const game: HostGame = {
    welcome: () => ({ data: { config: {} } as never, governments: [] }),
    unavailable: (government: GovernmentId) => (government === 2 ? "that realm is eliminated" : null),
    setPlayer: (player: PlayerId, government: GovernmentId | null, watching: boolean) =>
      calls.push(["setPlayer", player, government, watching]),
    command: (player: PlayerId, command: Command) => calls.push(["command", player, command]),
    setFlowGood: (player, good) => calls.push(["setFlowGood", player, good]),
    focus: (player, area) => calls.push(["focus", player, area]),
  };
  return { game, calls };
}

/**
 * Waits until `check` passes: packing is asynchronous and memory links deliver on a later turn, so how long messages
 * take to cross depends on the machine's load. Polling for the outcome keeps the tests fast and steady.
 */
const until = (check: () => void) => vi.waitFor(check, { timeout: 5000, interval: 5 });

/** A short wait for messages that should not arrive, before checking they did not. */
const pause = (ms = 100) => new Promise((resolve) => setTimeout(resolve, ms));

/** A host and a way to join it; each join returns a client session and the messages it received. */
function setup() {
  const { game, calls } = fakeGame();
  const host = new HostSession(game, "Alice");
  const hostEnds: Link[] = [];
  const join = (token: string, name = "Bob") => {
    const received: ToClient[] = [];
    const states: ConnectionState[] = [];
    const client = new ClientSession({
      name,
      token,
      retryDelaysMs: [5],
      connect: async () => {
        const [a, b] = memoryLinks();
        hostEnds.push(b);
        host.accept(b);
        return a;
      },
    });
    client.onMessage((message) => received.push(message));
    client.onState((state) => states.push(state));
    client.start();
    return { client, received, states };
  };
  return { host, calls, join, hostEnds };
}

describe("host and client sessions", () => {
  it("welcome a player, who chooses a free realm and commands for it", async () => {
    const { host, calls, join } = setup();
    host.setHostChoice(0);
    const bob = join("bob-token");
    await until(() => expect(bob.received[0]).toMatchObject({ type: "welcome" }));
    expect(bob.client.state).toBe("connected");
    expect(bob.received[0]).toMatchObject({ type: "welcome", you: { id: "bob-token", role: "choosing" } });
    expect(host.lobby().map((p) => [p.name, p.online])).toEqual([
      ["Alice", true],
      ["Bob", true],
    ]);

    bob.client.send({ type: "choose", government: 0 }); // the host's realm
    bob.client.send({ type: "choose", government: 2 }); // eliminated
    bob.client.send({ type: "choose", government: 1 });
    // Bob hears of both refusals; the host applies the third choice before Bob even receives them.
    const notices = () => bob.received.filter((m) => m.type === "notice").map((m) => (m as { text: string }).text);
    await until(() => expect(notices()).toEqual(["Alice already holds this realm", "that realm is eliminated"]));
    await until(() => expect(host.lobby()[1]).toMatchObject({ role: "player", government: 1 }));
    expect(host.lobby()[1]).toMatchObject({ role: "player", government: 1 });
    expect(calls).toContainEqual(["setPlayer", "bob-token", 1, true]);

    const command: Command = { type: "declareWar", target: 0 };
    bob.client.send({ type: "command", command });
    bob.client.send({ type: "setFlowGood", good: 3 });
    bob.client.send({ type: "focus", area: 12 });
    await until(() => expect(calls).toContainEqual(["focus", "bob-token", 12]));
    // The command goes up under the connection's player, whatever the message claims.
    expect(calls).toContainEqual(["command", "bob-token", command]);
    expect(calls).toContainEqual(["setFlowGood", "bob-token", 3]);
    expect(calls).toContainEqual(["focus", "bob-token", 12]);
  });

  it("refuse another protocol version", async () => {
    const { host } = setup();
    const [a, b] = memoryLinks();
    host.accept(b);
    const received: unknown[] = [];
    const { MessageLink } = await import("./link");
    const link = new MessageLink<ToClient, unknown>(a);
    link.onMessage((m) => received.push(m));
    link.send({ type: "hello", version: PROTOCOL_VERSION + 1, name: "Old", token: "t" });
    await until(() => expect(received[0]).toBeDefined());
    expect(received[0]).toMatchObject({ type: "refused" });
    expect(host.lobby()).toHaveLength(1);
  });

  it("let spectators watch but not command", async () => {
    const { host, calls, join } = setup();
    const eve = join("eve");
    await until(() => expect(eve.client.state).toBe("connected"));
    eve.client.send({ type: "choose", government: null });
    eve.client.send({ type: "command", command: { type: "declareWar", target: 0 } });
    await until(() => expect(eve.received.some((m) => m.type === "commandRejected")).toBe(true));
    expect(host.lobby()[1]).toMatchObject({ role: "spectator", government: null });
    expect(calls).toContainEqual(["setPlayer", "eve", null, true]);
    expect(calls.some((c) => c[0] === "command")).toBe(false);
    expect(eve.received.some((m) => m.type === "commandRejected")).toBe(true);
  });

  it("keep a dropped player's realm and give it back on reconnection", async () => {
    const { host, calls, join, hostEnds } = setup();
    const bob = join("bob");
    await until(() => expect(bob.client.state).toBe("connected"));
    bob.client.send({ type: "choose", government: 1 });
    await until(() => expect(host.lobby()[1]).toMatchObject({ government: 1 }));
    const offline: unknown[] = [];
    host.onLobby((players) => offline.push(players[1]?.online === false && players[1]?.government === 1));
    hostEnds[0]?.close(); // the connection drops; the client retries after 5 ms
    await until(() => expect(bob.received.filter((m) => m.type === "welcome")).toHaveLength(2));
    await until(() => expect(calls.at(-1)).toEqual(["setPlayer", "bob", 1, true]));
    expect(offline).toContain(true); // shown offline with the realm kept, until the reconnection
    const dropped = calls.findIndex((c) => c[0] === "setPlayer" && c[3] === false);
    expect(calls[dropped]).toEqual(["setPlayer", "bob", 1, false]);
    expect(bob.states).toContain("reconnecting");
    expect(bob.client.state).toBe("connected");
    expect(host.lobby()[1]).toMatchObject({ online: true, government: 1, role: "player" });
    expect(calls.at(-1)).toEqual(["setPlayer", "bob", 1, true]);
    expect(bob.received.filter((m) => m.type === "welcome")).toHaveLength(2);
  });

  it("let the host release an offline player's realm, and free it when a player leaves", async () => {
    const { host, join, hostEnds } = setup();
    const bob = join("bob");
    const carol = join("carol", "Carol");
    await until(() => expect([bob.client.state, carol.client.state]).toEqual(["connected", "connected"]));
    bob.client.send({ type: "choose", government: 1 });
    carol.client.send({ type: "choose", government: 0 });
    await until(() => expect(host.holder(0)).toBeDefined());
    await until(() => expect(host.holder(1)).toBeDefined());
    host.release(1);
    await until(() => expect(bob.received.some((m) => m.type === "notice")).toBe(true));
    expect(host.lobby().find((p) => p.id === "bob")).toMatchObject({ role: "choosing", government: null });
    expect(bob.received.some((m) => m.type === "notice")).toBe(true);
    carol.client.leave();
    await until(() => expect(host.lobby().map((p) => p.id)).toEqual(["local", "bob"]));
    expect(host.holder(0)).toBeUndefined();
    expect(hostEnds.length).toBe(2);
  });

  it("skip packed messages for a backed-up client", async () => {
    const { game } = fakeGame();
    const host = new HostSession(game);
    const [a, b] = memoryLinks();
    host.accept(b);
    const { MessageLink } = await import("./link");
    const client = new MessageLink<ToClient, unknown>(a);
    const snapshots: unknown[] = [];
    client.onMessage((m) => snapshots.push(m));
    client.send({ type: "hello", version: PROTOCOL_VERSION, name: "Slow", token: "slow" });
    await until(() => expect(host.lobby()).toHaveLength(2));
    client.send({ type: "choose", government: null });
    await until(() => expect(host.lobby()[1]).toMatchObject({ role: "spectator" }));
    const packed = await pack({ type: "hostStatus", status: {} });
    host.sendPacked("slow", packed);
    b.buffered = 2 * 1024 * 1024;
    host.sendPacked("slow", packed);
    await until(() => expect(snapshots.some((m) => (m as { type: string }).type === "hostStatus")).toBe(true));
    await pause(); // the skipped one must not arrive
    expect(snapshots.filter((m) => (m as { type: string }).type === "hostStatus")).toHaveLength(1);
    expect(host.skipped).toBe(1);
  });

  it("give up when the host never answers", async () => {
    vi.useFakeTimers();
    let now = 0;
    const client = new ClientSession({
      name: "Bob",
      token: "t",
      now: () => now,
      retryDelaysMs: [1000],
      giveUpAfterMs: 5000,
      connect: () => Promise.reject(new Error("no host")),
    });
    client.start();
    for (let i = 0; i < 10; i++) {
      now += 1000;
      await vi.advanceTimersByTimeAsync(1000);
    }
    expect(client.state).toBe("lost");
    vi.useRealTimers();
  });

  it("tell why each attempt to reach the host failed, and keep trying", async () => {
    let attempts = 0;
    const client = new ClientSession({
      name: "Bob",
      token: "bob-token",
      retryDelaysMs: [5],
      connect: async () => {
        attempts++;
        throw new Error("the host is not on the signaling server: is its tab still open?");
      },
    });
    const problems: string[] = [];
    client.onProblem((problem) => problems.push(problem));
    client.start();
    await until(() => expect(attempts).toBeGreaterThan(1));
    expect(problems[0]).toBe("the host is not on the signaling server: is its tab still open?");
    expect(client.state).toBe("connecting");
    client.leave();
  });
});
