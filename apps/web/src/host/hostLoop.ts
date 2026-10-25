// Host loop (specification §8, Host loop): drains the command queue, runs ticks at the target speed and posts
// snapshots and price tables at their wall-clock rates, one snapshot per viewer: the local player, and every joined
// player or spectator. Clock and scheduler are injected so it runs in tests.
import { DetailRotation, pack } from "@geonomics/net/worker";
import {
  type AreaId,
  applyCommands,
  buildSnapshot,
  type Command,
  type CommandEnvelope,
  encodePriceTable,
  type GoodId,
  type GovernmentId,
  type PlayerId,
  runTick,
  snapshotTransferables,
  type World,
} from "@geonomics/sim";
import { type FromWorker, type HostStatus, LOCAL_PLAYER, type Speed } from "./protocol";

export interface HostLoopOptions {
  world: World;
  post: (message: FromWorker, transfer?: Transferable[]) => void;
  now: () => number; // milliseconds
  schedule: (callback: () => void, delayMs: number) => void;
  speed?: Speed;
  autosave?: () => void; // called every AUTOSAVE_INTERVAL_DAYS game days while the game runs
}

/** Game days between autosaves (specification §8, Save and load). */
export const AUTOSAVE_INTERVAL_DAYS = 30;

interface Viewer {
  government: GovernmentId | null; // null: a spectator
  flowGood: GoodId | null;
  knownEdges: number; // edges the viewer already has, from static data or earlier snapshots
  rotation: DetailRotation | null; // remote viewers get area detail in turns; the local one gets all of it
  sending: Promise<void>; // packing is asynchronous: this chain keeps a remote viewer's snapshots in order
}

const MS_PER_TICK_SMOOTHING = 0.1;

export class HostLoop {
  readonly world: World;
  private readonly post: HostLoopOptions["post"];
  private readonly now: () => number;
  private readonly schedule: HostLoopOptions["schedule"];
  private readonly autosave: (() => void) | undefined;
  private nextAutosaveDay: number;
  private readonly viewers = new Map<PlayerId, Viewer>();
  private readonly staticEdges: number; // edges in the static data newcomers receive
  private queue: { player: PlayerId; command: Command }[] = [];
  private paused = true;
  private stopped = false;
  private scheduled = false;
  private speed: Speed;
  private lastSnapshot = Number.NEGATIVE_INFINITY;
  private lastPriceTable = Number.NEGATIVE_INFINITY;
  private recentTicks: number[] = []; // wall times of the ticks in the last second
  private msPerTick = 0;

  constructor(options: HostLoopOptions) {
    this.world = options.world;
    this.post = options.post;
    this.now = options.now;
    this.schedule = options.schedule;
    this.speed = options.speed ?? 5;
    this.staticEdges = options.world.edges.length;
    this.autosave = options.autosave;
    this.nextAutosaveDay = options.world.gameDay + AUTOSAVE_INTERVAL_DAYS;
  }

  /**
   * Gives `player` the government (null: none) and, while `watching`, snapshots for it. Any government the player
   * held before goes back to the AI. A player who is not watching is offline: the AI runs its realm until it returns
   * (specification §8, Dropped connections). A new remote viewer gets a snapshot at once.
   */
  setPlayer(player: PlayerId, government: GovernmentId | null, watching: boolean): void {
    for (const g of this.world.governments) {
      if (g.controller.kind === "human" && g.controller.player === player && (g.id !== government || !watching))
        g.controller = { kind: "ai" };
    }
    const held = government === null || !watching ? undefined : this.world.governments[government];
    if (held) held.controller = { kind: "human", player };
    if (!watching) {
      this.viewers.delete(player);
      return;
    }
    const viewer = this.viewers.get(player);
    if (viewer) viewer.government = government;
    else {
      this.viewers.set(player, {
        government,
        flowGood: null,
        knownEdges: this.staticEdges,
        rotation: player === LOCAL_PLAYER ? null : new DetailRotation(),
        sending: Promise.resolve(),
      });
      if (player !== LOCAL_PLAYER) {
        this.emitSnapshot(player);
        this.emitPriceTable(true);
      }
    }
  }

  /** Queues a command from a player; while paused it is applied at once, as no tick runs in between. */
  enqueue(command: Command, player: PlayerId = LOCAL_PLAYER): void {
    if (this.stopped) return;
    if (this.paused) {
      this.reportRejections(applyCommands(this.world, [this.envelope(player, command)]));
      this.emitSnapshot();
    } else this.queue.push({ player, command });
  }

  /** Stops the clock; every viewer gets the state it stopped on, so no one is left a tick behind. */
  pause(): void {
    const wasRunning = !this.paused;
    this.paused = true;
    if (wasRunning && !this.stopped) this.emitSnapshot();
    this.emitStatus();
  }

  resume(): void {
    if (this.stopped) return;
    this.paused = false;
    this.emitStatus();
    this.wake(0);
  }

  /** Chooses the good whose trade flows a viewer's snapshots carry; while paused its next snapshot goes out at once. */
  setFlowGood(good: GoodId | null, player: PlayerId = LOCAL_PLAYER): void {
    const viewer = this.viewers.get(player);
    if (this.stopped || !viewer || good === viewer.flowGood) return;
    viewer.flowGood = good;
    if (this.paused) this.emitSnapshot(player);
  }

  /** The area a remote player looks at: its detail comes in every snapshot. */
  focus(player: PlayerId, area: AreaId | null): void {
    const rotation = this.viewers.get(player)?.rotation;
    if (rotation) rotation.focus = area;
  }

  setSpeed(speed: Speed): void {
    this.speed = speed;
    this.emitStatus();
  }

  stop(): void {
    this.stopped = true;
    this.paused = true;
  }

  /** Posts the current state at once: snapshots, the price table and the status. */
  publish(): void {
    this.emitSnapshot();
    this.emitPriceTable();
    this.emitStatus();
  }

  /** A command acts for the government its player controls; the validation rejects it if there is none. */
  private envelope(player: PlayerId, command: Command): CommandEnvelope {
    const government = this.world.governments.findIndex(
      (g) => g.controller.kind === "human" && g.controller.player === player,
    );
    return { player, government, command };
  }

  private wake(delayMs: number): void {
    if (this.scheduled || this.paused || this.stopped) return;
    this.scheduled = true;
    this.schedule(() => {
      this.scheduled = false;
      this.step();
    }, delayMs);
  }

  private step(): void {
    if (this.paused || this.stopped) return;
    const started = this.now();
    const commands = this.queue;
    this.queue = [];
    this.reportRejections(
      runTick(
        this.world,
        commands.map(({ player, command }) => this.envelope(player, command)),
      ),
    );
    const finished = this.now();
    const elapsed = finished - started;
    this.msPerTick =
      this.msPerTick === 0 ? elapsed : this.msPerTick + MS_PER_TICK_SMOOTHING * (elapsed - this.msPerTick);
    this.recentTicks.push(finished);
    while ((this.recentTicks[0] as number) <= finished - 1000) this.recentTicks.shift();

    const network = this.world.config.network;
    if (finished - this.lastSnapshot >= 1000 / network.snapshotRate) {
      this.emitSnapshot();
      this.emitStatus();
    }
    if (finished - this.lastPriceTable >= 1000 / network.priceTableRate) this.emitPriceTable();
    if (this.autosave && this.world.gameDay >= this.nextAutosaveDay) {
      this.nextAutosaveDay = this.world.gameDay + AUTOSAVE_INTERVAL_DAYS;
      this.autosave();
    }

    // Late ticks start at once, but always through the scheduler, so messages are handled between ticks.
    const interval = this.speed === "max" ? 0 : 1000 / this.speed;
    this.wake(Math.max(0, interval - (this.now() - started)));
  }

  private reportRejections(rejections: ReturnType<typeof runTick>): void {
    for (const { envelope, reason } of rejections)
      this.post({ type: "rejected", to: envelope.player, command: envelope.command, reason });
  }

  /** A snapshot for every viewer, or only `only`. */
  private emitSnapshot(only?: PlayerId): void {
    this.lastSnapshot = this.now();
    for (const [player, viewer] of this.viewers) {
      if (only !== undefined && player !== only) continue;
      const snapshot = buildSnapshot(this.world, viewer.government, viewer.knownEdges, {
        flowGood: viewer.flowGood,
        detailAreas: viewer.rotation?.pick,
      });
      viewer.knownEdges = this.world.edges.length;
      if (!viewer.rotation) {
        this.post({ type: "snapshot", snapshot }, snapshotTransferables(snapshot));
        continue;
      }
      viewer.sending = viewer.sending.then(async () => {
        const bytes = await pack({ type: "snapshot", snapshot });
        this.post({ type: "remote", to: player, bytes }, [bytes.buffer as ArrayBuffer]);
      });
    }
  }

  /** The price table for the local viewer and, packed once, for every remote one. */
  private emitPriceTable(remoteOnly = false): void {
    const { tick, gameDay } = this.world;
    if (!remoteOnly) this.lastPriceTable = this.now();
    if (!remoteOnly && this.viewers.has(LOCAL_PLAYER)) {
      const table = encodePriceTable(this.world);
      this.post({ type: "priceTable", tick, gameDay, table }, [table.buffer]);
    }
    if ([...this.viewers.values()].some((viewer) => viewer.rotation)) {
      const table = encodePriceTable(this.world);
      void pack({ type: "priceTable", tick, gameDay, table }).then((bytes) =>
        this.post({ type: "remote", to: null, bytes }, [bytes.buffer as ArrayBuffer]),
      );
    }
  }

  private emitStatus(): void {
    const status: HostStatus = {
      paused: this.paused,
      speed: this.speed,
      ticksPerSecond: this.paused ? 0 : this.recentTicks.length,
      msPerTick: this.msPerTick,
      tick: this.world.tick,
    };
    this.post({ type: "status", status });
  }
}
