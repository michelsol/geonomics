// Host loop (specification §9, Host loop): drains the command queue, runs ticks at the target speed and posts
// snapshots and price tables at their wall-clock rates. Clock and scheduler are injected so it runs in tests.
import {
  applyCommands,
  buildSnapshot,
  type Command,
  type CommandEnvelope,
  encodePriceTable,
  type GovernmentId,
  runTick,
  snapshotTransferables,
  type World,
} from "@geonomics/sim";
import { type FromWorker, type HostStatus, LOCAL_PLAYER, type Speed } from "./protocol";

export interface HostLoopOptions {
  world: World;
  viewer: GovernmentId;
  post: (message: FromWorker, transfer?: Transferable[]) => void;
  now: () => number; // milliseconds
  schedule: (callback: () => void, delayMs: number) => void;
  speed?: Speed;
}

const MS_PER_TICK_SMOOTHING = 0.1;

export class HostLoop {
  readonly world: World;
  private readonly viewer: GovernmentId;
  private readonly post: HostLoopOptions["post"];
  private readonly now: () => number;
  private readonly schedule: HostLoopOptions["schedule"];
  private queue: Command[] = [];
  private paused = true;
  private stopped = false;
  private scheduled = false;
  private speed: Speed;
  private knownEdges: number;
  private lastSnapshot = Number.NEGATIVE_INFINITY;
  private lastPriceTable = Number.NEGATIVE_INFINITY;
  private recentTicks: number[] = []; // wall times of the ticks in the last second
  private msPerTick = 0;

  constructor(options: HostLoopOptions) {
    this.world = options.world;
    this.viewer = options.viewer;
    this.post = options.post;
    this.now = options.now;
    this.schedule = options.schedule;
    this.speed = options.speed ?? 5;
    this.knownEdges = options.world.edges.length;
  }

  /** Queues a command from the local player; while paused it is applied at once, as no tick runs in between. */
  enqueue(command: Command): void {
    if (this.stopped) return;
    if (this.paused) {
      this.reportRejections(applyCommands(this.world, [this.envelope(command)]));
      this.emitSnapshot();
    } else this.queue.push(command);
  }

  pause(): void {
    this.paused = true;
    this.emitStatus();
  }

  resume(): void {
    if (this.stopped) return;
    this.paused = false;
    this.emitStatus();
    this.wake(0);
  }

  setSpeed(speed: Speed): void {
    this.speed = speed;
    this.emitStatus();
  }

  stop(): void {
    this.stopped = true;
    this.paused = true;
  }

  /** Posts the current state at once: a snapshot, the price table and the status. */
  publish(): void {
    this.emitSnapshot();
    this.emitPriceTable();
    this.emitStatus();
  }

  private envelope(command: Command): CommandEnvelope {
    return { player: LOCAL_PLAYER, government: this.viewer, command };
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
        commands.map((command) => this.envelope(command)),
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

    // Late ticks start at once, but always through the scheduler, so messages are handled between ticks.
    const interval = this.speed === "max" ? 0 : 1000 / this.speed;
    this.wake(Math.max(0, interval - (this.now() - started)));
  }

  private reportRejections(rejections: ReturnType<typeof runTick>): void {
    for (const { envelope, reason } of rejections) this.post({ type: "rejected", command: envelope.command, reason });
  }

  private emitSnapshot(): void {
    const snapshot = buildSnapshot(this.world, this.viewer, this.knownEdges);
    this.knownEdges = this.world.edges.length;
    this.lastSnapshot = this.now();
    this.post({ type: "snapshot", snapshot }, snapshotTransferables(snapshot));
  }

  private emitPriceTable(): void {
    const table = encodePriceTable(this.world);
    this.lastPriceTable = this.now();
    this.post({ type: "priceTable", tick: this.world.tick, gameDay: this.world.gameDay, table }, [table.buffer]);
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
