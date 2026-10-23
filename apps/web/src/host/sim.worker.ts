// Simulation worker entry point: owns the world, runs the host loop (specification §9, Host loop) and saves the game
// (specification §9, Save and load).
import {
  buildSnapshot,
  buildStaticData,
  deserializeWorld,
  type SaveInfo,
  serializeWorld,
  type World,
} from "@geonomics/sim";
import { createGame } from "./createGame";
import { HostLoop } from "./hostLoop";
import { type FromWorker, LOCAL_PLAYER, type ToWorker } from "./protocol";
import { compress, decompress, readSave, storeSave } from "./saves";

const scope = self as unknown as {
  postMessage(message: FromWorker, transfer?: Transferable[]): void;
  onmessage: ((event: MessageEvent<ToWorker>) => void) | null;
};
const post = (message: FromWorker, transfer: Transferable[] = []) => scope.postMessage(message, transfer);
const report = (error: unknown) =>
  post({ type: "error", message: error instanceof Error ? error.message : String(error) });

interface Hosted {
  world: World;
  loop: HostLoop;
  gameId: string; // the game's autosave slot
  catalog: string;
  started: boolean; // the local player entered: from then on the game is worth saving
}

let game: Hosted | null = null;
let saving = false;
let autosaveFailed = false;

scope.onmessage = (event) => {
  try {
    handle(event.data);
  } catch (error) {
    report(error);
  }
};

/** Runs a new or loaded world: the loop exists from the start, paused, so players can join while the host chooses. */
function host(world: World, gameId: string, catalog: string): void {
  game?.loop.stop();
  const loop = new HostLoop({
    world,
    post,
    now: () => performance.now(),
    schedule: (callback, delay) => setTimeout(callback, delay),
    autosave: () => void autosave(),
  });
  game = { world, loop, gameId, catalog, started: false };
  post({ type: "static", data: buildStaticData(world), governments: buildSnapshot(world, null).governments });
}

function infoOf(hosted: Hosted): SaveInfo {
  const realm = hosted.world.governments.find(
    (g) => g.controller.kind === "human" && g.controller.player === LOCAL_PLAYER,
  );
  return {
    gameId: hosted.gameId,
    title: realm ? realm.name : "Watching",
    gameDay: hosted.world.gameDay,
    savedAt: Date.now(),
    catalog: hosted.catalog,
    areas: hosted.world.areas.length,
  };
}

/** The save file of the current game; the world is serialized at once, so it is the state of this moment. */
function saveFile(hosted: Hosted): { info: SaveInfo; file: Promise<Uint8Array> } {
  const info = infoOf(hosted);
  return { info, file: compress(serializeWorld(hosted.world, info)) };
}

/** Saves the game in its slot. The world is serialized before the first await, so the game may end right after. */
async function autosave(): Promise<void> {
  if (!game?.started || saving) return;
  saving = true;
  try {
    const { info, file } = saveFile(game);
    await storeSave(info, await file);
  } catch (error) {
    // Private windows may refuse storage: say so once, and the game runs on.
    if (!autosaveFailed) report(`Autosave failed: ${error instanceof Error ? error.message : String(error)}`);
    autosaveFailed = true;
  } finally {
    saving = false;
  }
}

async function load(file: Promise<Uint8Array>): Promise<void> {
  post({ type: "progress", stage: "Loading the save", done: 0 });
  const { info, world } = deserializeWorld(await decompress(await file));
  host(world, info.gameId, info.catalog);
}

function handle(message: ToWorker): void {
  switch (message.type) {
    case "create": {
      game?.loop.stop();
      game = null;
      const world = createGame(message.options, (stage, done) => post({ type: "progress", stage, done }));
      host(world, crypto.randomUUID(), message.options.catalog);
      return;
    }
    case "load":
      load(Promise.resolve(message.file)).catch(report);
      return;
    case "loadSaved":
      load(readSave(message.gameId)).catch(report);
      return;
    case "save":
      void autosave();
      return;
    case "export": {
      if (!game) return;
      const { info, file } = saveFile(game);
      file.then((bytes) => post({ type: "exported", info, file: bytes }, [bytes.buffer as ArrayBuffer]), report);
      return;
    }
    case "start":
      if (!game) return;
      if (message.government !== null && !game.world.governments[message.government]) return;
      game.started = true;
      game.loop.setPlayer(LOCAL_PLAYER, message.government, true);
      game.loop.publish();
      game.loop.resume();
      return;
    case "player":
      game?.loop.setPlayer(message.player, message.government, message.watching);
      return;
    case "command":
      game?.loop.enqueue(message.command, message.player);
      return;
    case "setSpeed":
      game?.loop.setSpeed(message.speed);
      return;
    case "setFlowGood":
      game?.loop.setFlowGood(message.good, message.player);
      return;
    case "focus":
      game?.loop.focus(message.player, message.area);
      return;
    case "pause":
      game?.loop.pause();
      return;
    case "resume":
      game?.loop.resume();
      return;
    case "endGame":
      void autosave(); // the session's last state, so it can be continued later
      game?.loop.stop();
      game = null;
      return;
  }
}
