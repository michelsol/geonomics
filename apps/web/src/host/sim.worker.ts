// Simulation worker entry point: owns the world and runs the host loop (specification §9, Host loop).
import { buildSnapshot, buildStaticData, type World } from "@geonomics/sim";
import { createGame } from "./createGame";
import { HostLoop } from "./hostLoop";
import { type FromWorker, LOCAL_PLAYER, type ToWorker } from "./protocol";

const scope = self as unknown as {
  postMessage(message: FromWorker, transfer?: Transferable[]): void;
  onmessage: ((event: MessageEvent<ToWorker>) => void) | null;
};
const post = (message: FromWorker, transfer: Transferable[] = []) => scope.postMessage(message, transfer);

let world: World | null = null;
let loop: HostLoop | null = null;

scope.onmessage = (event) => {
  try {
    handle(event.data);
  } catch (error) {
    post({ type: "error", message: error instanceof Error ? error.message : String(error) });
  }
};

function handle(message: ToWorker): void {
  switch (message.type) {
    case "create": {
      loop?.stop();
      world = createGame(message.options, (stage, done) => post({ type: "progress", stage, done }));
      // The loop exists from the start, paused, so players can join while the host chooses its realm.
      loop = new HostLoop({
        world,
        post,
        now: () => performance.now(),
        schedule: (callback, delay) => setTimeout(callback, delay),
      });
      post({ type: "static", data: buildStaticData(world), governments: buildSnapshot(world, null).governments });
      return;
    }
    case "start":
      if (!world || !loop) return;
      if (message.government !== null && !world.governments[message.government]) return;
      loop.setPlayer(LOCAL_PLAYER, message.government, true);
      loop.publish();
      loop.resume();
      return;
    case "player":
      loop?.setPlayer(message.player, message.government, message.watching);
      return;
    case "command":
      loop?.enqueue(message.command, message.player);
      return;
    case "setSpeed":
      loop?.setSpeed(message.speed);
      return;
    case "setFlowGood":
      loop?.setFlowGood(message.good, message.player);
      return;
    case "focus":
      loop?.focus(message.player, message.area);
      return;
    case "pause":
      loop?.pause();
      return;
    case "resume":
      loop?.resume();
      return;
    case "endGame":
      loop?.stop();
      loop = null;
      world = null;
      return;
  }
}
