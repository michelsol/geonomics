// The joining side: connects to the host, says hello, and reconnects after a dropped connection
// (specification §9, Joining and Dropped connections).
import type { PlayerId } from "@geonomics/sim";
import { type Link, MessageLink } from "./link";
import { PROTOCOL_VERSION, type ToClient, type ToHost } from "./messages";

export type ConnectionState = "connecting" | "connected" | "reconnecting" | "refused" | "lost" | "left";

export interface ClientOptions {
  connect: () => Promise<Link>; // opens a new link to the host
  name: string;
  token: PlayerId; // kept by the tab, so a reconnection gets the same realm back
  schedule?: (callback: () => void, delayMs: number) => unknown;
  now?: () => number;
  retryDelaysMs?: readonly number[]; // waits between attempts; the last one repeats
  giveUpAfterMs?: number; // stops retrying this long after the connection dropped
}

const RETRY_DELAYS_MS = [1000, 2000, 4000, 8000];
const GIVE_UP_AFTER_MS = 120_000;

export class ClientSession {
  state: ConnectionState = "connecting";
  private link: MessageLink<ToClient, ToHost> | null = null;
  private readonly messageListeners = new Set<(message: ToClient) => void>();
  private readonly stateListeners = new Set<(state: ConnectionState) => void>();
  private attempt = 0;
  private droppedAt = 0;
  private readonly schedule: NonNullable<ClientOptions["schedule"]>;
  private readonly now: () => number;

  constructor(private readonly options: ClientOptions) {
    this.schedule = options.schedule ?? ((callback, delay) => setTimeout(callback, delay));
    this.now = options.now ?? (() => Date.now());
  }

  start(): void {
    this.droppedAt = this.now(); // a first connection that never opens also gives up in time
    void this.open();
  }

  onMessage(listener: (message: ToClient) => void): () => void {
    this.messageListeners.add(listener);
    return () => this.messageListeners.delete(listener);
  }

  onState(listener: (state: ConnectionState) => void): () => void {
    this.stateListeners.add(listener);
    return () => this.stateListeners.delete(listener);
  }

  /** Sends a message to the host; messages sent while disconnected are dropped. */
  send(message: ToHost): void {
    if (this.state === "connected") this.link?.send(message);
  }

  /** Leaves the game for good: the host frees the realm. */
  leave(): void {
    this.send({ type: "leave" });
    this.setState("left");
    setTimeout(() => this.link?.close(), 300);
  }

  private async open(): Promise<void> {
    let link: Link;
    try {
      link = await this.options.connect();
    } catch {
      this.retry();
      return;
    }
    if (this.state === "left") {
      link.close();
      return;
    }
    const messages = new MessageLink<ToClient, ToHost>(link);
    this.link = messages;
    messages.onMessage((message) => {
      if (message.type === "welcome") {
        this.attempt = 0;
        this.setState("connected");
      } else if (message.type === "refused") this.setState("refused");
      for (const listener of this.messageListeners) listener(message);
    });
    link.onClose(() => {
      if (this.link !== messages) return;
      this.link = null;
      this.retry();
    });
    messages.send({ type: "hello", version: PROTOCOL_VERSION, name: this.options.name, token: this.options.token });
  }

  private retry(): void {
    if (this.state === "refused" || this.state === "left" || this.state === "lost") return;
    if (this.state === "connected") {
      this.droppedAt = this.now();
      this.setState("reconnecting");
    }
    if (this.now() - this.droppedAt > (this.options.giveUpAfterMs ?? GIVE_UP_AFTER_MS)) {
      this.setState("lost");
      return;
    }
    const delays = this.options.retryDelaysMs ?? RETRY_DELAYS_MS;
    const delay = delays[Math.min(this.attempt, delays.length - 1)] as number;
    this.attempt++;
    this.schedule(() => void this.open(), delay);
  }

  private setState(state: ConnectionState): void {
    if (state === this.state) return;
    this.state = state;
    for (const listener of this.stateListeners) listener(state);
  }
}
