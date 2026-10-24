// Interface state (specification §10): fed by worker messages, or by the host's messages when joined, and read by
// React panels and the map renderer.
import type { ConnectionState, LobbyPlayer } from "@geonomics/net";
import type { AreaDetail, Command, GovernmentSummary, Snapshot, StaticData, StaticEdge } from "@geonomics/sim";
import { useStore } from "zustand";
import { createStore, type StoreApi } from "zustand/vanilla";
import type { FromWorker, GameOptions, HostStatus, Speed, ToWorker } from "../host/protocol";
import { History } from "./history";
import { areasInPolygon, meanPrices, type Point, priceExtremes, priceOf, realmPopulation } from "./selectors";

export type Screen = "newGame" | "guide" | "join" | "chooseRealm" | "game" | "ended";
export type Layer = "realms" | "population" | "prices" | "resources" | "satisfaction" | "wage" | "terrain";
export type Flows = "none" | "migration" | "transport"; // arrows drawn over the area layer
/** What closing a lasso does with the areas inside it: replace the selection, add to it, or remove from it. */
export type LassoOperation = "replace" | "add" | "remove";
export type Mode =
  | { kind: "select" }
  | { kind: "moveArmy"; army: number }
  | { kind: "pickPeaceAreas" }
  | { kind: "lasso"; points: Point[]; operation: LassoOperation }; // corners in map units

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

/** Solo, hosting or joined: who runs the game and who else is in it (specification §9, Joining). */
export interface Session {
  role: "solo" | "host" | "client";
  link: string | null; // the join link, once hosting
  players: LobbyPlayer[];
  me: LobbyPlayer | null; // a joined player's own entry
  started: boolean; // the host has chosen its realm and the game runs
  connection: ConnectionState | null; // a joined player's link to the host
  hostHidden: boolean; // the host's tab is hidden: browsers may slow it down, and phones freeze it
  refused: string | null; // why the host refused a joined player
  problem: string | null; // why the last attempt to reach the host failed
}

const SOLO: Session = {
  role: "solo",
  link: null,
  players: [],
  me: null,
  started: false,
  connection: null,
  hostHidden: false,
  refused: null,
  problem: null,
};

export interface GameState {
  screen: Screen;
  progress: { stage: string; done: number } | null;
  menuError: string | null; // why the last new or loaded game failed, shown on the menu
  updateReady: boolean; // a new version of the app is installed and waits for a reload
  data: StaticData | null;
  edges: StaticEdge[]; // static edges plus routes created during the game
  governments: GovernmentSummary[];
  viewer: number | null;
  snapshot: Snapshot | null;
  priceTable: Uint16Array | null;
  history: History | null;
  historyVersion: number; // bumped on every new sample, so charts know when to redraw
  status: HostStatus;
  selection: number[]; // the selected areas (specification §10, Selection)
  selectedArea: number | null; // the selected area when exactly one is selected
  selectedGood: number;
  selectedArmy: number | null;
  layer: Layer;
  flows: Flows;
  transportAllGoods: boolean; // transport flows show total tonnes, not the selected good
  mode: Mode;
  peaceAreas: number[]; // areas picked on the map for a peace proposal
  toasts: Toast[];
  peakPopulation: number;
  summary: Summary | null;
  session: Session;

  newGame(options: GameOptions): void;
  /** Loads a save file, or a game saved in this browser; the lobby follows, as for a new game. */
  loadGame(source: { file: Uint8Array } | { gameId: string }): void;
  /** Saves the game in its autosave slot now, as when the tab is hidden. */
  autosave(): void;
  exportSave(): void;
  setUpdateReady(): void;
  openGuide(): void;
  closeGuide(): void; // back to the new game screen
  chooseRealm(government: number | null): void; // null: watch as a spectator
  setSession(session: Partial<Session>): void;
  /** A joined player's role, from the host: in the game once it holds a realm or watches. */
  enterAs(you: LobbyPlayer): void;
  send(command: Command): void;
  setSpeed(speed: Speed): void;
  togglePause(): void;
  setPaused(paused: boolean): void;
  endGame(): void;
  backToMenu(): void;
  /** A tap on the map; `additive` (Shift or Ctrl) adds or removes the area from the selection. */
  clickArea(area: number | null, additive?: boolean): void;
  selectArea(area: number | null): void;
  selectAreas(areas: readonly number[]): void;
  toggleArea(area: number): void;
  startLasso(point: Point): void;
  addLassoPoint(point: Point): void;
  setLassoOperation(operation: LassoOperation): void;
  /** Applies the lasso to the selection; fewer than three corners cancel it. */
  closeLasso(): void;
  selectGood(good: number): void;
  selectArmy(army: number | null): void;
  setLayer(layer: Layer): void;
  setFlows(flows: Flows): void;
  setTransportGood(good: number | "all"): void;
  setMode(mode: Mode): void;
  togglePeaceArea(area: number): void;
  setPeaceAreas(areas: readonly number[]): void;
  toast(text: string): void;
  dismissToast(id: number): void;
  receive(message: FromWorker): void;
}

const IDLE_STATUS: HostStatus = { paused: true, speed: 5, ticksPerSecond: 0, msPerTick: 0, tick: 0 };
const TOAST_LIMIT = 4;
let nextToast = 1;

/** A double tap's first tap selects one area; a lasso started this soon after it keeps the selection from before. */
const DOUBLE_TAP_RESTORE_MS = 600;

export function createGameStore(port: Port): StoreApi<GameState> {
  let lastTap = { at: Number.NEGATIVE_INFINITY, selection: [] as number[] };
  const store = createStore<GameState>()((set, get) => ({
    screen: "newGame",
    progress: null,
    menuError: null,
    updateReady: false,
    data: null,
    edges: [],
    governments: [],
    viewer: null,
    snapshot: null,
    priceTable: null,
    history: null,
    historyVersion: 0,
    status: IDLE_STATUS,
    selection: [],
    selectedArea: null,
    selectedGood: 0,
    selectedArmy: null,
    layer: "realms",
    flows: "none",
    transportAllGoods: true,
    mode: { kind: "select" },
    peaceAreas: [],
    toasts: [],
    peakPopulation: 0,
    summary: null,
    session: SOLO,

    newGame(options) {
      set({
        screen: "newGame",
        progress: { stage: "Starting", done: 0 },
        menuError: null,
        data: null,
        snapshot: null,
        summary: null,
      });
      port.postMessage({ type: "create", options });
    },
    loadGame(source) {
      set({
        screen: "newGame",
        progress: { stage: "Loading the save", done: 0 },
        menuError: null,
        data: null,
        snapshot: null,
        summary: null,
      });
      port.postMessage("file" in source ? { type: "load", file: source.file } : { type: "loadSaved", ...source });
    },
    autosave() {
      port.postMessage({ type: "save" });
    },
    exportSave() {
      port.postMessage({ type: "export" });
    },
    setUpdateReady() {
      set({ updateReady: true });
    },
    openGuide() {
      set({ screen: "guide" });
    },
    closeGuide() {
      set({ screen: "newGame" });
    },
    chooseRealm(government) {
      port.postMessage({ type: "start", government, speed: startSpeed() });
      // A joined player enters once the host accepts the choice (enterAs); the host enters at once.
      if (get().session.role === "client") return;
      const capital = government === null ? null : (get().governments[government]?.capital ?? null);
      set({
        viewer: government,
        screen: "game",
        selectedArea: capital,
        selection: capital === null ? [] : [capital],
        peakPopulation: 0,
      });
    },
    setSession(session) {
      set({ session: { ...get().session, ...session } });
    },
    enterAs(you) {
      set({ session: { ...get().session, me: you } });
      if (you.role === "choosing") {
        if (get().screen === "game") set({ screen: "chooseRealm", snapshot: null });
        return;
      }
      if (get().screen === "game" && get().viewer === you.government) return;
      const capital = you.government === null ? null : (get().governments[you.government]?.capital ?? null);
      set({
        viewer: you.government,
        screen: "game",
        selectedArea: capital,
        selection: capital === null ? [] : [capital],
        peakPopulation: 0,
      });
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
      port.postMessage({ type: "pause" }); // nothing runs behind the menu
    },
    clickArea(area, additive = false) {
      const { mode } = get();
      // Every tap counts as a double tap's possible first one, water included, so a lasso restores the right selection.
      if (mode.kind === "select" && !additive) lastTap = { at: Date.now(), selection: get().selection };
      if (area === null) return;
      if (mode.kind === "moveArmy") {
        get().send({ type: "moveArmy", army: mode.army, destination: area });
        set({ mode: { kind: "select" } });
      } else if (mode.kind === "pickPeaceAreas") get().togglePeaceArea(area);
      else if (mode.kind === "select") {
        if (additive) get().toggleArea(area);
        else get().selectArea(area);
      }
    },
    selectArea(area) {
      if (area !== null) get().history?.track(area);
      set({ selectedArea: area, selection: area === null ? [] : [area] });
      port.postMessage({ type: "focus", player: "local", area });
    },
    selectAreas(areas) {
      const unique = [...new Set(areas)];
      if (unique.length <= 1) {
        get().selectArea(unique[0] ?? null);
        return;
      }
      get().history?.trackSelection(unique);
      set({ selectedArea: null, selection: unique });
      port.postMessage({ type: "focus", player: "local", area: null });
    },
    toggleArea(area) {
      const { selection } = get();
      get().selectAreas(selection.includes(area) ? selection.filter((a) => a !== area) : [...selection, area]);
    },
    startLasso(point) {
      if (Date.now() - lastTap.at < DOUBLE_TAP_RESTORE_MS) get().selectAreas(lastTap.selection);
      lastTap = { at: Number.NEGATIVE_INFINITY, selection: [] };
      const operation = get().selection.length > 1 ? "add" : "replace";
      set({ mode: { kind: "lasso", points: [point], operation } });
    },
    addLassoPoint(point) {
      const { mode } = get();
      if (mode.kind === "lasso") set({ mode: { ...mode, points: [...mode.points, point] } });
    },
    setLassoOperation(operation) {
      const { mode } = get();
      if (mode.kind === "lasso") set({ mode: { ...mode, operation } });
    },
    closeLasso() {
      const { mode, data, selection } = get();
      set({ mode: { kind: "select" } });
      if (mode.kind !== "lasso" || mode.points.length < 3 || !data) return;
      const inside = areasInPolygon(data, mode.points);
      const next =
        mode.operation === "replace"
          ? inside
          : mode.operation === "add"
            ? [...selection, ...inside]
            : selection.filter((area) => !inside.includes(area));
      get().selectAreas(next);
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
    },
    setFlows(flows) {
      set({ flows });
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
    setPeaceAreas(areas) {
      set({ peaceAreas: [...areas] });
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
            flows: "none",
            transportAllGoods: true,
            mode: { kind: "select" },
            peaceAreas: [],
          });
          watchFlows();
          return;
        case "snapshot": {
          if (state.screen !== "game") return;
          // Joined players receive area detail in turns: keep the last detail of each area still visible.
          const snapshot = withDetailOf(message.snapshot, state.snapshot);
          const history = state.history;
          const population = realmPopulation(snapshot);
          if (history && snapshot.government) for (const detail of snapshot.detail) history.track(detail.area);
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
            for (const { areas, series } of history.selectionPrices.values())
              series.push(message.gameDay, meanPrices(data, message.table, areas));
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
          if (state.screen === "newGame") set({ progress: null, menuError: message.message });
          else state.toast(`Error: ${message.message}`);
          return;
      }
    },
  }));

  // Snapshots carry one good's trade flows, only while the transport flows show that good.
  let watched: number | null = null;
  function watchFlows(): void {
    const { flows, transportAllGoods, selectedGood } = store.getState();
    const good = flows === "transport" && !transportAllGoods ? selectedGood : null;
    if (good === watched) return;
    watched = good;
    port.postMessage({ type: "setFlowGood", good });
  }
  return store;
}

/** A game starts at 1× on phones, which heat up and drain their battery as hosts, and at 2× elsewhere. */
function startSpeed(): Speed {
  return typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches ? 2 : 5;
}

/** The good shown first: the first one satisfying a necessity, such as food. */
function firstNecessityGood(data: StaticData): number {
  const good = data.goods.find((g) => g.satisfies && data.needs[g.satisfies.need]?.tier === "necessity");
  return good?.id ?? 0;
}

/** The snapshot with the detail of every visible area, taking what it lacks from the previous snapshot. */
function withDetailOf(snapshot: Snapshot, previous: Snapshot | null): Snapshot {
  if (snapshot.detail.length === snapshot.visibleAreas.length) return snapshot;
  const known = new Map<number, AreaDetail>();
  for (const detail of previous?.detail ?? []) known.set(detail.area, detail);
  for (const detail of snapshot.detail) known.set(detail.area, detail);
  const detail = snapshot.visibleAreas.flatMap((area) => known.get(area) ?? []);
  return { ...snapshot, detail };
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

/** The app's store, connected to the simulation worker by `connectWorker`, or to a host by the client module. */
const appPort: Port & { target: Port | null } = {
  target: null,
  postMessage(message) {
    this.target?.postMessage(message);
  },
};
export const gameStore = createGameStore(appPort);

/** Where the store's messages go: the worker, or a host's connection for a joined player. */
export function setPortTarget(target: Port): void {
  appPort.target = target;
}

/** Sends a message to the worker directly, as the host does for its joined players. */
export function postToWorker(message: ToWorker): void {
  appPort.target?.postMessage(message);
}

/** Feeds the store from the worker; `route` takes the messages meant for joined players first. */
export function connectWorker(worker: Worker, route: (message: FromWorker) => boolean = () => false): void {
  appPort.target = worker;
  worker.onmessage = (event: MessageEvent<FromWorker>) => {
    if (!route(event.data)) gameStore.getState().receive(event.data);
  };
}

export function useGame<T>(selector: (state: GameState) => T): T {
  return useStore(gameStore, selector);
}
