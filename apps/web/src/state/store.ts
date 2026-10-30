// Interface state (specification §9): fed by worker messages, or by the host's messages when joined, and read by
// React panels and the map renderer.
import type { ConnectionState, LobbyPlayer } from "@geonomics/net";
import type { AreaDetail, Command, GovernmentSummary, Snapshot, StaticData, StaticEdge } from "@geonomics/sim";
import { useStore } from "zustand";
import { createStore, type StoreApi } from "zustand/vanilla";
import type { FromWorker, GameOptions, HostStatus, Speed, ToWorker } from "../host/protocol";
import { History } from "./history";
import {
  DEMOGRAPHY_KEYS,
  demographyOf,
  meanPrices,
  priceExtremes,
  priceOf,
  type RealmResult,
  realmPopulation,
  realmResults,
} from "./selectors";

export type Screen = "newGame" | "guide" | "join" | "chooseRealm" | "game" | "ended";
export type Layer = "realms" | "population" | "prices" | "resources" | "satisfaction" | "income" | "employment";
export type Flows = "none" | "migration" | "transport"; // arrows drawn over the area layer
export type PanelName =
  | "area"
  | "goods"
  | "population"
  | "needs"
  | "resources"
  | "policies"
  | "jobs"
  | "infrastructure"
  | "armies"
  | "diplomacy"
  | "game";
/** The map layer each panel shows (specification §9, Map). */
export const PANEL_LAYERS: Record<PanelName, Layer> = {
  area: "realms",
  goods: "prices",
  population: "population",
  needs: "satisfaction",
  resources: "resources",
  policies: "income",
  jobs: "employment",
  infrastructure: "realms",
  armies: "realms",
  diplomacy: "realms",
  game: "realms",
};
export type Mode =
  | { kind: "select" }
  // `share` of the soldiers in these areas (`soldiers` in all when the move began) wait for their destinations,
  // picked on the map in `targets`, over which they spread when sent
  | { kind: "moveSoldiers"; areas: number[]; share: number; soldiers: number; targets: number[] }
  | { kind: "pickPeaceAreas" }
  | { kind: "brush" };
/** The selection brush (specification §9, Selection): whether a stroke adds or erases, and how wide it paints. */
export type BrushSize = "S" | "M" | "L";
export interface Brush {
  erase: boolean;
  size: BrushSize;
}
/** How far from the pointer each brush size reaches, in screen pixels, past the area under it. */
export const BRUSH_REACH_PX: Record<BrushSize, number> = { S: 0, M: 24, L: 60 };

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
  viewer: number | null; // the player's realm, null for a spectator
  realms: (RealmResult & { ranBy: string })[]; // every realm's public figures, and who ran it
}

export interface Port {
  postMessage(message: ToWorker): void;
}

/** Solo, hosting or joined: who runs the game and who else is in it (specification §8, Joining). */
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
  selection: number[]; // the selected areas (specification §9, Selection)
  selectedArea: number | null; // the selected area when exactly one is selected
  selectedGood: number;
  sendShare: number; // the share of the selection's soldiers that Move and Disband act on, in (0, 1]
  selectedResource: number; // the primary good the Resources panel and the resources layer show
  panel: PanelName; // the open panel, which sets the map layer and flows
  layer: Layer;
  flows: Flows;
  showTransport: boolean; // the Goods panel draws transport flows
  showMigration: boolean; // the Population panel draws migration flows
  flowsBetweenRealms: boolean; // flows are summed into one arrow per pair of realms, capital to capital
  mode: Mode;
  brush: Brush;
  peaceAreas: number[]; // areas picked on the map for a peace proposal
  toasts: Toast[];
  peakPopulation: number;
  realmPeaks: number[]; // per government: its largest population seen this session
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
  setBrush(brush: Partial<Brush>): void;
  /** Applies a finished brush stroke to the selection: adds its areas, or takes them out when erasing. */
  paint(areas: readonly number[]): void;
  selectGood(good: number): void;
  setSendShare(share: number): void;
  sendSoldiers(): void;
  selectResource(good: number): void;
  /** Opens a panel, with its map layer and, if its checkbox is on, its flows. */
  openPanel(panel: PanelName): void;
  setShowTransport(show: boolean): void;
  setShowMigration(show: boolean): void;
  setFlowsBetweenRealms(show: boolean): void;
  setLayer(layer: Layer): void;
  setFlows(flows: Flows): void;
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

export function createGameStore(port: Port): StoreApi<GameState> {
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
    sendShare: 1,
    selectedResource: 0,
    panel: "area",
    layer: "realms",
    flows: "none",
    showTransport: false,
    showMigration: false,
    flowsBetweenRealms: false,
    mode: { kind: "select" },
    brush: { erase: false, size: "M" },
    peaceAreas: [],
    toasts: [],
    peakPopulation: 0,
    realmPeaks: [],
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
        realmPeaks: [],
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
        realmPeaks: [],
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
      if (area === null) return;
      if (mode.kind === "moveSoldiers") {
        const targets = mode.targets.includes(area) ? mode.targets.filter((a) => a !== area) : [...mode.targets, area];
        set({ mode: { ...mode, targets } });
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
    setBrush(brush) {
      set({ brush: { ...get().brush, ...brush } });
    },
    paint(areas) {
      const { selection, brush } = get();
      const painted = new Set(areas);
      get().selectAreas(brush.erase ? selection.filter((area) => !painted.has(area)) : [...selection, ...areas]);
    },
    selectGood(good) {
      set({ selectedGood: good });
      watchFlows();
    },
    setSendShare(share) {
      set({ sendShare: Math.min(1, Math.max(0.01, share)) });
    },
    sendSoldiers() {
      const { mode } = get();
      if (mode.kind !== "moveSoldiers" || mode.targets.length === 0) return;
      get().send({ type: "moveSoldiers", areas: mode.areas, destinations: mode.targets, share: mode.share });
      set({ mode: { kind: "select" } });
    },
    selectResource(good) {
      set({ selectedResource: good });
    },
    openPanel(panel) {
      set({ panel, layer: PANEL_LAYERS[panel], flows: panelFlows({ ...get(), panel }) });
      watchFlows();
    },
    setShowTransport(show) {
      set({ showTransport: show, flows: panelFlows({ ...get(), showTransport: show }) });
      watchFlows();
    },
    setShowMigration(show) {
      set({ showMigration: show, flows: panelFlows({ ...get(), showMigration: show }) });
      watchFlows();
    },
    setFlowsBetweenRealms(show) {
      set({ flowsBetweenRealms: show });
    },
    setLayer(layer) {
      set({ layer });
    },
    setFlows(flows) {
      set({ flows });
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
            selectedResource: message.data.goods.find((good) => good.isPrimary)?.id ?? 0,
            panel: "area",
            layer: "realms",
            flows: "none",
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
          const edges = snapshot.newEdges.length > 0 ? [...state.edges, ...snapshot.newEdges] : state.edges;
          if (history && snapshot.government) for (const detail of snapshot.detail) history.track(detail.area);
          if (history && state.data) recordDemography(history, state.data, snapshot, edges, state.selection);
          set({
            snapshot,
            governments: snapshot.governments,
            edges,
            peakPopulation: Math.max(state.peakPopulation, population),
            realmPeaks: snapshot.governments.map((g) => Math.max(state.realmPeaks[g.id] ?? 0, g.population)),
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

  // Snapshots carry one good's trade flows, the selected good's, only while the transport flows show.
  let watched: number | null = null;
  function watchFlows(): void {
    const { flows, selectedGood } = store.getState();
    const good = flows === "transport" ? selectedGood : null;
    if (good === watched) return;
    watched = good;
    port.postMessage({ type: "setFlowGood", good });
  }
  return store;
}

/** The flows a panel draws: its own, when the player ticked them. */
function panelFlows(state: Pick<GameState, "panel" | "showTransport" | "showMigration">): Flows {
  if (state.panel === "goods" && state.showTransport) return "transport";
  if (state.panel === "population" && state.showMigration) return "migration";
  return "none";
}

/**
 * Samples the demography of the realm (the world for a spectator) and of every tracked selection, the current one
 * included, once per game day: later snapshots of the same day replace the sample.
 */
function recordDemography(
  history: History,
  data: StaticData,
  snapshot: Snapshot,
  edges: readonly StaticEdge[],
  selection: readonly number[],
): void {
  if (selection.length > 0) history.trackDemography(selection);
  const day = Math.floor(snapshot.gameDay);
  const sample = (areas: readonly number[]) => {
    const demography = demographyOf(snapshot, edges, areas);
    return DEMOGRAPHY_KEYS.map((key) => demography[key]);
  };
  const realm = snapshot.government?.ownedAreas ?? data.areas.map((_, area) => area);
  history.realmDemography.push(day, sample(realm));
  for (const { areas, series } of history.demography.values()) series.push(day, sample(areas));
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
  const ranBy = (realm: RealmResult) =>
    realm.id === state.viewer
      ? "you"
      : (state.session.players.find((player) => player.government === realm.id)?.name ??
        (realm.ai ? `AI · ${realm.personality}` : "a player"));
  return {
    days: snapshot?.gameDay ?? 0,
    peakPopulation: state.peakPopulation,
    finalPopulation: snapshot ? realmPopulation(snapshot) : 0,
    areas: snapshot?.government?.ownedAreas.length ?? 0,
    treasury: snapshot?.government?.treasury ?? 0,
    eliminated,
    viewer: state.viewer,
    realms:
      snapshot && state.data
        ? realmResults(state.data, snapshot, state.priceTable, state.realmPeaks).map((realm) => ({
            ...realm,
            ranBy: ranBy(realm),
          }))
        : [],
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
