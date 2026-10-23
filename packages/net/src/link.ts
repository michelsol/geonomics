// A connection to one peer, whatever carries it: a PeerJS data channel in the browser, a memory pair in tests.
import { pack, Reassembler, toFrames, unpack } from "./frames";

export interface Link {
  send(frame: Uint8Array): void;
  readonly bufferedAmount: number; // bytes queued but not yet sent
  onFrame(listener: (frame: Uint8Array) => void): void;
  onClose(listener: () => void): void;
  close(): void;
}

/**
 * Sends and receives whole messages over a link. Packing is asynchronous, so sends go through a queue that keeps them
 * in order; received messages are delivered in order too.
 */
export class MessageLink<In, Out> {
  private queue: Promise<void> = Promise.resolve();
  private inbox: Promise<void> = Promise.resolve();
  private nextId = 1;
  private readonly reassembler = new Reassembler();
  closed = false;

  constructor(readonly link: Link) {
    link.onClose(() => {
      this.closed = true;
    });
  }

  get bufferedAmount(): number {
    return this.link.bufferedAmount;
  }

  send(message: Out): void {
    this.queue = this.queue.then(async () => this.sendPacked(await pack(message)));
  }

  /** Sends a message packed elsewhere (snapshots are packed in the simulation worker), keeping the order. */
  sendPackedInOrder(packed: Uint8Array): void {
    this.queue = this.queue.then(() => this.sendPacked(packed));
  }

  private sendPacked(packed: Uint8Array): void {
    if (this.closed) return;
    try {
      for (const frame of toFrames(packed, this.nextId++)) this.link.send(frame);
    } catch {
      // A channel closing mid-send ends the link; its close listener does the rest.
    }
  }

  onMessage(listener: (message: In) => void, onError?: (error: unknown) => void): void {
    this.link.onFrame((frame) => {
      let packed: Uint8Array | null;
      try {
        packed = this.reassembler.push(frame);
      } catch (error) {
        onError?.(error);
        return;
      }
      if (!packed) return;
      const bytes = packed;
      this.inbox = this.inbox.then(async () => {
        try {
          listener(await unpack<In>(bytes));
        } catch (error) {
          onError?.(error);
        }
      });
    });
  }

  close(): void {
    this.closed = true;
    this.link.close();
  }
}

/** Two links joined in memory, for tests: what one sends, the other receives, asynchronously like a network. */
export function memoryLinks(): [Link & { buffered: number }, Link & { buffered: number }] {
  const make = () => {
    const frames: ((frame: Uint8Array) => void)[] = [];
    const closes: (() => void)[] = [];
    return { frames, closes, open: true };
  };
  const a = make();
  const b = make();
  const side = (self: ReturnType<typeof make>, other: ReturnType<typeof make>) => ({
    buffered: 0,
    get bufferedAmount() {
      return this.buffered;
    },
    send(frame: Uint8Array) {
      if (!self.open) throw new Error("link closed");
      const copy = frame.slice();
      setTimeout(() => {
        if (other.open) for (const listener of other.frames) listener(copy);
      }, 0);
    },
    onFrame(listener: (frame: Uint8Array) => void) {
      self.frames.push(listener);
    },
    onClose(listener: () => void) {
      self.closes.push(listener);
    },
    close() {
      for (const end of [self, other]) {
        if (!end.open) continue;
        end.open = false;
        for (const listener of end.closes) setTimeout(listener, 0);
      }
    },
  });
  return [side(a, b), side(b, a)];
}
