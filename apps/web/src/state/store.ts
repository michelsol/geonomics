// Interface state (specification §10): fed by worker messages, read by React panels and the map renderer.
import type { Command, GovernmentSummary, Snapshot, StaticData, StaticEdge } from "@geonomics/sim";
import { useStore } from "zustand";
import { createStore, type StoreApi } from "zustand/vanilla";
import type { FromWorker, GameOptions, HostStatus, Speed, ToWorker } from "../host/protocol";
import { History } from "./history";
import { priceExtremes, priceOf, realmPopulation } from "./selectors";

export type Screen = "newGame" | "chooseRealm" | "game" | "ended";
export type Layer =
  | "realms"
  | "population"
  | "prices"
  | "resources"
  | "satisfaction"
  | "wage"
  | "migration"
  | "transport"
  | "terrain";
export type Mode = { kind: "select" } | { kind: "moveArmy"; army: number } | { kind: "pickPeaceAreas" };

export interface Toast {
  id: number;
  text: string;
}

export interface Summary {
  days: number;
  peakPopulation: number;
  finalPopulation: number;
  areas: number;
  treasury: number;
  eliminated: boolean;
}

export interface Port {
  postMessage(message: ToWorker): void;
}

export interface GameState {
  screen: Screen;
  progress: { stage: string; done: number } | null;
  data: StaticData | null;
  edges: StaticEdge[]; // static edges plus routes created during the game
  governments: GovernmentSummary[];
  viewer: number | null;
  snapshot: Snapshot | null;
  priceTable: Uint16Array | null;
  history: History | null;
  historyVersion: number; // bumped on every new sample, so charts know when to redraw
  status: HostStatus;
  selectedArea: number | null;
  selectedGood: number;
  selectedArmy: number | null;
  layer: Layer;
  transportAllGoods: boolean; // the transport layer shows total tonnes, not the selected good
  mode: Mode;
  peaceAreas: number[]; // areas picked on the map for a peace proposal
  toasts: Toast[];
  peakPopulation: number;
  summary: Summary | null;

  newGame(options: GameOptions): void;
  chooseRealm(government: number): void;
  send(command: Command): void;
  setSpeed(speed: Speed): void;
  togglePause(): void;
  setPaused(paused: boolean): void;
  endGame(): void;
  backToMenu(): void;
  clickArea(area: number | null): void;
  selectArea(area: number | null): void;
  selectGood(good: number): void;
  selectArmy(army: number | null): void;
  setLayer(layer: Layer): void;
  setTransportGood(good: number | "all"): void;
  setMode(mode: Mode): void;
  togglePeaceArea(area: number): void;
  toast(text: string): void;
  dismissToast(id: number): void;
  receive(message: FromWorker): void;
}

const IDLE_STATUS: HostStatus = { paused: true, speed: 5, ticksPerSecond: 0, msPerTick: 0, tick: 0 };
const TOAST_LIMIT = 4;
let nextToast = 1;

export function createGameStore(port: Port): StoreApi<GameState> {
  const store = createStore<GameState>()((set, get) => ({
    screen: "newGame",
    progress: null,
    data: null,
    edges: [],
    governments: [],
    viewer: null,
    snapshot: null,
    priceTable: null,
    history: null,
    historyVersion: 0,
    status: IDLE_STATUS,
    selectedArea: null,
    selectedGood: 0,
    selectedArmy: null,
    layer: "realms",
    transportAllGoods: true,
    mode: { kind: "select" },
    peaceAreas: [],
    toasts: [],
    peakPopulation: 0,
    summary: null,

    newGame(options) {
      set({ screen: "newGame", progress: { stage: "Starting", done: 0 }, data: null, snapshot: null, summary: null });
      port.postMessage({ type: "create", options });
    },
    chooseRealm(government) {
      const capital = get().governments[government]?.capital ?? null;
      set({ viewer: government, screen: "game", selectedArea: capital, peakPopulation: 0 });
      port.postMessage({ type: "start", government });
    },
    send(command) {
      port.postMessage({ type: "command", command });
    },
    setSpeed(speed) {
      port.postMessage({ type: "setSpeed", speed });
      if (get().status.paused) get().setPaused(false);
    },
    togglePause() {
      get().setPaused(!get().status.paused);
    },
    setPaused(paused) {
      port.postMessage({ type: paused ? "pause" : "resume" });
    },
    endGame() {
      port.postMessage({ type: "endGame" });
      set({ screen: "ended", summary: summarize(get(), false) });
    },
    backToMenu() {
      set({ screen: "newGame", progress: null, snapshot: null, data: null, summary: null, status: IDLE_STATUS });
    },
    clickArea(area) {
      const { mode } = get();
      if (area === null) return;
      if (mode.kind === "moveArmy") {
        get().send({ type: "moveArmy", army: mode.army, destination: area });
        set({ mode: { kind: "select" } });
      } else if (mode.kind === "pickPeaceAreas") get().togglePeaceArea(area);
      else get().selectArea(area);
    },
    selectArea(area) {
      if (area !== null) get().history?.track(area);
      set({ selectedArea: area });
    },
    selectGood(good) {
      set({ selectedGood: good });
      watchFlows();
    },
    selectArmy(army) {
      set({ selectedArmy: army });
    },
    setLayer(layer) {
      set({ layer });
      watchFlows();
    },
    setTransportGood(good) {
      set(good === "all" ? { transportAllGoods: true } : { transportAllGoods: false, selectedGood: good });
      watchFlows();
    },
    setMode(mode) {
      // Picking peace areas starts from an empty selection; the picks stay for the proposal form afterwards.
      set(mode.kind === "pickPeaceAreas" ? { mode, peaceAreas: [] } : { mode });
    },
    togglePeaceArea(area) {
      const areas = get().peaceAreas;
      set({ peaceAreas: areas.includes(area) ? areas.filter((a) => a !== area) : [...areas, area] });
    },
    toast(text) {
      set({ toasts: [...get().toasts, { id: nextToast++, text }].slice(-TOAST_LIMIT) });
    },
    dismissToast(id) {
      set({ toasts: get().toasts.filter((toast) => toast.id !== id) });
    },

    receive(message) {
      const state = get();
      switch (message.type) {
        case "progress":
          set({ progress: { stage: message.stage, done: message.done } });
          return;
        case "static":
          set({
            screen: "chooseRealm",
            progress: null,
            data: message.data,
            edges: [...message.data.edges],
            governments: message.governments,
            history: new History(message.data.goods.length),
            historyVersion: 0,
            selectedGood: firstNecessityGood(message.data),
            layer: "realms",
            transportAllGoods: true,
            mode: { kind: "select" },
            peaceAreas: [],
          });
          watchFlows();
          return;
        case "snapshot": {
          if (state.screen !== "game") return;
          const { snapshot } = message;
          const history = state.history;
          const population = realmPopulation(snapshot);
          if (history && snapshot.government) {
            history.realm.push(snapshot.gameDay, [population, snapshot.government.treasury]);
            for (const detail of snapshot.detail) history.track(detail.area);
          }
          set({
            snapshot,
            governments: snapshot.governments,
            edges: snapshot.newEdges.length > 0 ? [...state.edges, ...snapshot.newEdges] : state.edges,
            peakPopulation: Math.max(state.peakPopulation, population),
            historyVersion: state.historyVersion + 1,
          });
          if (snapshot.government?.isEliminated) {
            port.postMessage({ type: "endGame" });
            set({ screen: "ended", summary: summarize(get(), true) });
          }
          return;
        }
        case "priceTable": {
          if (state.screen !== "game" || !state.data) return;
          const { data, history } = state;
          if (history) {
            for (let g = 0; g < data.goods.length; g++) {
              const { low, median, high } = priceExtremes(data, message.table, g);
              history.goodPrices[g]?.push(message.gameDay, [low.price, median.price, high.price]);
            }
            for (const [area, series] of history.areaPrices) {
              const prices = data.goods.map((good) => priceOf(data, message.table, area, good.id));
              series.push(message.gameDay, prices);
            }
          }
          set({ priceTable: message.table, historyVersion: state.historyVersion + 1 });
          return;
        }
        case "status":
          set({ status: message.status });
          return;
        case "rejected":
          state.toast(`${message.command.type}: ${message.reason}`);
          return;
        case "error":
          state.toast(`Error: ${message.message}`);
          if (state.screen === "newGame") set({ progress: null });
          return;
      }
    },
  }));

  // Snapshots carry one good's trade flows, only while the transport layer shows that good.
  let watched: number | null = null;
  function watchFlows(): void {
    const { layer, transportAllGoods, selectedGood } = store.getState();
    const good = layer === "transport" && !transportAllGoods ? selectedGood : null;
    if (good === watched) return;
    watched = good;
    port.postMessage({ type: "setFlowGood", good });
  }
  return store;
}

/** The good shown first: the first one satisfying a necessity, such as food. */
function firstNecessityGood(data: StaticData): number {
  const good = data.goods.find((g) => g.satisfies && data.needs[g.satisfies.need]?.tier === "necessity");
  return good?.id ?? 0;
}

function summarize(state: GameState, eliminated: boolean): Summary {
  const snapshot = state.snapshot;
  return {
    days: snapshot?.gameDay ?? 0,
    peakPopulation: state.peakPopulation,
    finalPopulation: snapshot ? realmPopulation(snapshot) : 0,
    areas: snapshot?.government?.ownedAreas.length ?? 0,
    treasury: snapshot?.government?.treasury ?? 0,
    eliminated,
  };
}

/** The app's store, connected to the simulation worker by `connectWorker`. */
const workerPort: Port & { target: Port | null } = {
  target: null,
  postMessage(message) {
    this.target?.postMessage(message);
  },
};
export const gameStore = createGameStore(workerPort);

export function connectWorker(worker: Worker): void {
  workerPort.target = worker;
  worker.onmessage = (event: MessageEvent<FromWorker>) => gameStore.getState().receive(event.data);
}

export function useGame<T>(selector: (state: GameState) => T): T {
  return useStore(gameStore, selector);
}
