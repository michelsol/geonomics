// Joining a game hosted in another browser: the store talks to the host instead of a local worker
// (specification §9, Joining and Dropped connections).
import { ClientSession, connector, type ToHost } from "@geonomics/net";
import type { ToWorker } from "../host/protocol";
import { gameStore, setPortTarget } from "../state/store";
import { brokerOptions, hasJoined, markJoined, playerToken, savedName, saveName } from "./options";

let session: ClientSession | null = null;

/** Translates what the interface would tell its worker into messages for the host; time is the host's to control. */
function toHost(message: ToWorker): ToHost | null {
  switch (message.type) {
    case "command":
      return { type: "command", command: message.command };
    case "start":
      return { type: "choose", government: message.government };
    case "setFlowGood":
      return { type: "setFlowGood", good: message.good };
    case "focus":
      return { type: "focus", area: message.area };
    default:
      return null;
  }
}

/** Points the interface at a host: the join screen first, or straight back in after a reload. */
export function connectClient(hostId: string): void {
  setPortTarget({
    postMessage: (message) => {
      if (message.type === "endGame") session?.leave();
      else {
        const translated = toHost(message);
        if (translated) session?.send(translated);
      }
    },
  });
  const store = gameStore.getState();
  store.setSession({ role: "client" });
  gameStore.setState({ screen: "join" });
  const name = savedName();
  if (hasJoined(hostId) && name) join(hostId, name);
}

export function join(hostId: string, name: string): void {
  saveName(name);
  session?.leave();
  const client = new ClientSession({ connect: connector(hostId, brokerOptions()), name, token: playerToken(hostId) });
  session = client;
  const store = () => gameStore.getState();
  client.onState((connection) => {
    store().setSession({ connection });
    if (connection === "lost") store().toast("The connection to the host is lost.");
  });
  client.onProblem((problem) => {
    console.warn(`Joining ${hostId}: ${problem}`);
    store().setSession({ problem });
  });
  client.onMessage((message) => {
    switch (message.type) {
      case "welcome":
        markJoined(hostId);
        store().setSession({ refused: null, problem: null });
        store().receive({ type: "static", data: message.data, governments: message.governments });
        store().enterAs(message.you);
        return;
      case "refused":
        store().setSession({ refused: message.reason });
        return;
      case "lobby":
        store().setSession({ players: message.players, started: message.started });
        return;
      case "you":
        store().enterAs(message.you);
        return;
      case "snapshot":
        store().receive({ type: "snapshot", snapshot: message.snapshot });
        return;
      case "priceTable":
        store().receive({ type: "priceTable", tick: message.tick, gameDay: message.gameDay, table: message.table });
        return;
      case "commandRejected":
        store().toast(`${message.command.type}: ${message.reason}`);
        return;
      case "notice":
        store().toast(message.text);
        return;
      case "hostStatus": {
        const { hidden, ...status } = message.status;
        store().receive({ type: "status", status });
        store().setSession({ hostHidden: hidden });
        return;
      }
    }
  });
  store().setSession({ connection: "connecting", refused: null, problem: null });
  client.start();
}
