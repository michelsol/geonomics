// The game screen: top bar, map and panels, as a sidebar on desktop or a bottom sheet on phones.
import { type CSSProperties, type ReactNode, useEffect, useRef, useState } from "react";
import { arrowWidth } from "../map/arrows";
import {
  cssColor,
  DIVERGING,
  MIGRATION_ARROW,
  POPULATION,
  POPULATION_DECADES,
  PRICE_RANGE,
  RESOURCE,
  SATISFACTION,
  TERRAIN_COLORS,
  TRANSPORT_ARROW,
  WAGE_RANGE,
} from "../map/colors";
import { MapView } from "../map/MapView";
import { flowMaximum, largestPopulation, realmPopulation, transportFlows } from "../state/selectors";
import type { Flows, Layer } from "../state/store";
import { gameStore, useGame } from "../state/store";
import { count, fmt, Select } from "./components";
import { AreaPanel } from "./panels/AreaPanel";
import { ArmiesPanel } from "./panels/ArmiesPanel";
import type { PanelName, PanelProps } from "./panels/common";
import { DiplomacyPanel } from "./panels/DiplomacyPanel";
import { GamePanel } from "./panels/GamePanel";
import { JobsPanel } from "./panels/JobsPanel";
import { PoliciesPanel } from "./panels/PoliciesPanel";

const PANELS = {
  area: { label: "Area", view: AreaPanel },
  policies: { label: "Policies", view: PoliciesPanel },
  jobs: { label: "Jobs", view: JobsPanel },
  armies: { label: "Armies", view: ArmiesPanel },
  diplomacy: { label: "Diplomacy", view: DiplomacyPanel },
  game: { label: "Game", view: GamePanel },
} as const satisfies Record<PanelName, { label: string; view: (props: PanelProps) => ReactNode }>;

const LAYERS: { value: Layer; label: string }[] = [
  { value: "realms", label: "Realms" },
  { value: "population", label: "Population" },
  { value: "prices", label: "Prices" },
  { value: "resources", label: "Resources" },
  { value: "satisfaction", label: "Satisfaction" },
  { value: "wage", label: "Average wage" },
  { value: "terrain", label: "Terrain" },
];

const FLOWS: { value: Flows; label: string }[] = [
  { value: "none", label: "No flows" },
  { value: "migration", label: "Migration" },
  { value: "transport", label: "Transport" },
];

type SheetHeight = "peek" | "half" | "full";

const SPECTATOR_PANELS: readonly PanelName[] = ["area", "game"];

/** Keeps the host's screen on while its game runs and the tab is visible (specification §9, Hosting on mobile). */
function useWakeLock(): void {
  const running = useGame((state) => !state.status.paused && state.session.role !== "client");
  useEffect(() => {
    if (!running || !("wakeLock" in navigator)) return;
    let lock: WakeLockSentinel | null = null;
    let released = false;
    navigator.wakeLock.request("screen").then(
      (sentinel) => {
        if (released) void sentinel.release();
        else lock = sentinel;
      },
      () => {}, // refused (battery saver, no user gesture): the game runs anyway
    );
    return () => {
      released = true;
      void lock?.release();
    };
  }, [running]);
}

/** A joined player's connection and the host's state, when either keeps the game from running for them. */
function StatusBanner() {
  const session = useGame((state) => state.session);
  const paused = useGame((state) => state.status.paused);
  if (session.role !== "client") return null;
  const text =
    session.connection === "reconnecting" || session.connection === "connecting"
      ? "Connection lost — reconnecting…"
      : session.connection === "lost"
        ? "The host is unreachable."
        : paused
          ? "Host paused"
          : session.hostHidden
            ? "The host's tab is in the background, which may slow the game"
            : null;
  if (!text) return null;
  return (
    <div className="status-banner" role="status" data-testid="status-banner">
      {text}
    </div>
  );
}

const SIDE_WIDTH_DEFAULT = 380;
const SIDE_WIDTH_MIN = 280;
const SIDE_WIDTH_KEY = "geonomics.sideWidth";
const clampSide = (width: number) =>
  Math.round(Math.min(Math.max(width, SIDE_WIDTH_MIN), Math.max(SIDE_WIDTH_MIN, Math.min(900, 0.7 * innerWidth))));

function storedSideWidth(): number {
  try {
    const stored = Number(localStorage.getItem(SIDE_WIDTH_KEY));
    return stored > 0 ? clampSide(stored) : SIDE_WIDTH_DEFAULT;
  } catch {
    return SIDE_WIDTH_DEFAULT;
  }
}

function saveSideWidth(width: number): void {
  try {
    localStorage.setItem(SIDE_WIDTH_KEY, String(width));
  } catch {
    // Private windows may refuse storage; the width then lasts for this session only.
  }
}

export function Game() {
  const [chosenPanel, setPanel] = useState<PanelName>("area");
  const [sheet, setSheet] = useState<SheetHeight>("peek");
  const [sideWidth, setSideWidth] = useState(storedSideWidth);
  // Spectators hold no realm: they see the map, areas and goods.
  const spectator = useGame((state) => state.viewer === null);
  const tabs = (Object.keys(PANELS) as PanelName[]).filter((name) => !spectator || SPECTATOR_PANELS.includes(name));
  const panel = tabs.includes(chosenPanel) ? chosenPanel : "area";
  const View = PANELS[panel].view as (props: PanelProps) => ReactNode;
  useWakeLock();

  useEffect(() => {
    // Space toggles pause. A solo game pauses while its tab is hidden; a hosted one runs on for its players. Both save.
    const key = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (event.code === "Escape") {
        // Escape leaves a lasso, then a selection of several areas.
        const state = gameStore.getState();
        if (state.mode.kind !== "select") state.setMode({ kind: "select" });
        else if (state.selection.length > 1) state.selectArea(null);
        return;
      }
      if (event.code !== "Space" || target?.closest("input, select, textarea, button")) return;
      event.preventDefault();
      gameStore.getState().togglePause();
    };
    const visibility = () => {
      const state = gameStore.getState();
      if (!document.hidden || state.session.role === "client") return;
      if (state.session.role === "solo") state.setPaused(true);
      state.autosave(); // phones may discard a hidden tab: keep the game as it is now
    };
    window.addEventListener("keydown", key);
    document.addEventListener("visibilitychange", visibility);
    return () => {
      window.removeEventListener("keydown", key);
      document.removeEventListener("visibilitychange", visibility);
    };
  }, []);

  const openPanel = (name: PanelName) => {
    setPanel(name);
    if (sheet === "peek") setSheet("half");
  };

  return (
    <div className="game" style={{ "--side-width": `${sideWidth}px` } as CSSProperties}>
      <TopBar />
      <div className="map-wrap">
        <MapView />
        <Legends />
        <ModeBanner />
        <StatusBanner />
        <Toasts />
      </div>
      <Divider
        width={sideWidth}
        onChange={(width) => {
          setSideWidth(width);
          saveSideWidth(width);
        }}
      />
      <aside className={`side ${sheet}`} aria-label="Panels">
        <button
          type="button"
          className="sheet-handle"
          aria-label="Resize panel"
          onClick={() => setSheet(sheet === "peek" ? "half" : sheet === "half" ? "full" : "peek")}
        />
        <nav className="tabs">
          {tabs.map((name) => (
            <button type="button" key={name} className={name === panel ? "active" : ""} onClick={() => openPanel(name)}>
              {PANELS[name].label}
            </button>
          ))}
        </nav>
        <div className="panel">
          <View onOpen={openPanel} />
        </div>
      </aside>
    </div>
  );
}

/** The line between the map and the panels; dragging it resizes the panels (desktop only). */
function Divider({ width, onChange }: { width: number; onChange: (width: number) => void }) {
  const drag = useRef<{ x: number; width: number } | null>(null);
  return (
    // biome-ignore lint/a11y/useSemanticElements: a focusable separator is the ARIA pattern for a splitter
    <div
      className="divider"
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize panels"
      aria-valuenow={width}
      aria-valuemin={SIDE_WIDTH_MIN}
      tabIndex={0}
      data-testid="divider"
      onPointerDown={(event) => {
        event.currentTarget.setPointerCapture(event.pointerId);
        drag.current = { x: event.clientX, width };
      }}
      onPointerMove={(event) => {
        if (drag.current) onChange(clampSide(drag.current.width + drag.current.x - event.clientX));
      }}
      onPointerUp={() => {
        drag.current = null;
      }}
      onDoubleClick={() => onChange(SIDE_WIDTH_DEFAULT)}
      onKeyDown={(event) => {
        const step = event.shiftKey ? 80 : 20;
        if (event.key === "ArrowLeft") onChange(clampSide(width + step));
        else if (event.key === "ArrowRight") onChange(clampSide(width - step));
        else return;
        event.preventDefault();
      }}
    />
  );
}

const SPEEDS = [
  { speed: 2, label: "1×" },
  { speed: 5, label: "2×" },
  { speed: 10, label: "5×" },
  { speed: "max", label: "Max" },
] as const;

function TopBar() {
  const status = useGame((state) => state.status);
  const day = useGame((state) => state.snapshot?.gameDay ?? 0);
  const treasury = useGame((state) => state.snapshot?.government?.treasury ?? 0);
  const population = useGame((state) => (state.snapshot?.government ? realmPopulation(state.snapshot) : null));
  const layer = useGame((state) => state.layer);
  const flows = useGame((state) => state.flows);
  const { setSpeed, togglePause, setLayer, setFlows } = gameStore.getState();
  const client = useGame((state) => state.session.role === "client");
  const speedLabel = SPEEDS.find((s) => s.speed === status.speed)?.label ?? String(status.speed);
  return (
    <header className="topbar">
      {client ? (
        <span className="stat" data-testid="host-status" title="Only the host controls time">
          {status.paused ? "Paused" : `Running ${speedLabel}`}
        </span>
      ) : (
        <div className="group">
          <button type="button" onClick={togglePause} aria-label={status.paused ? "Resume" : "Pause"}>
            {status.paused ? "▶" : "❚❚"}
          </button>
          {SPEEDS.map(({ speed, label }) => (
            <button
              type="button"
              key={label}
              className={!status.paused && status.speed === speed ? "active" : ""}
              onClick={() => setSpeed(speed)}
            >
              {label}
            </button>
          ))}
        </div>
      )}
      {/* The day, treasury and population wrap as one: on a narrow screen they take a row of their own together. */}
      <div className="group figures">
        <span className="stat" data-testid="game-day">
          Day {Math.floor(day)}
        </span>
        <span className="stat" title="Treasury, in man-hours">
          💰 {fmt(treasury)}
        </span>
        {population !== null && (
          <span className="stat" title="Population of your realm" data-testid="realm-population">
            👥 {fmt(population)}
          </span>
        )}
      </div>
      <span className="stat muted hide-phone" title="Ticks per second and milliseconds per tick">
        {status.ticksPerSecond} t/s · {status.msPerTick.toFixed(1)} ms
      </span>
      <div className="group" style={{ marginLeft: "auto" }}>
        <Select label="Map layer" value={layer} options={LAYERS} onChange={setLayer} />
        <Select label="Map flows" value={flows} options={FLOWS} onChange={setFlows} />
      </div>
    </header>
  );
}

/** A legend arrow drawn at the width the map uses for `share` of the largest flow. */
function SampleArrow({ color, share }: { color: number; share: number }) {
  const width = arrowWidth(share, 1);
  const head = Math.max(2 * width, 7);
  return (
    <svg width="44" height="16" viewBox="0 0 44 16" aria-hidden="true">
      <polygon
        points={`2,${8 - width / 2} ${42 - head},${8 - width / 2} ${42 - head},${8 - head / 2} 42,8 ${42 - head},${8 + head / 2} ${42 - head},${8 + width / 2} 2,${8 + width / 2}`}
        fill={cssColor(color)}
        stroke="#0b111a"
        strokeWidth="1"
      />
    </svg>
  );
}

function FlowScale({ color, maximum, unit }: { color: number; maximum: number; unit: string }) {
  if (!(maximum > 0)) return <div className="muted">No flow right now</div>;
  return (
    <div className="flow-scale">
      <span>
        <SampleArrow color={color} share={0.05} /> {fmt(0.05 * maximum)}
      </span>
      <span>
        <SampleArrow color={color} share={1} /> {fmt(maximum)} {unit}
      </span>
    </div>
  );
}

/** The legends of the area layer and of the flows overlay, stacked bottom left. */
function Legends() {
  return (
    <div className="legends">
      <FlowLegend />
      <AreaLegend />
    </div>
  );
}

function FlowLegend() {
  const flows = useGame((state) => state.flows);
  const snapshot = useGame((state) => state.snapshot);
  const data = useGame((state) => state.data);
  const allGoods = useGame((state) => state.transportAllGoods);
  const selectedGood = useGame((state) => state.selectedGood);
  // Derived here, not in the selector: a selector returning a fresh object would re-render forever.
  const transport = transportFlows({ snapshot, transportAllGoods: allGoods, selectedGood });
  const setTransportGood = useGame((state) => state.setTransportGood);
  switch (flows) {
    case "none":
      return null;
    case "migration":
      return (
        <div className="legend" data-testid="flow-legend">
          <div>People moving per day, net per edge</div>
          <FlowScale
            color={MIGRATION_ARROW}
            maximum={snapshot ? flowMaximum(snapshot.edges.migration) : 0}
            unit="people per day"
          />
        </div>
      );
    case "transport": {
      const info = transport.good === null ? undefined : data?.goods[transport.good];
      const options = [
        { value: -1, label: "All goods (tonnes)" },
        ...(data?.goods ?? []).filter((g) => !g.isService).map((g) => ({ value: g.id, label: g.name })),
      ];
      const service = !allGoods && data?.goods[selectedGood]?.isService;
      return (
        <div className="legend interactive" data-testid="flow-legend">
          <div>Goods carried per day, each direction</div>
          <Select
            label="Transported good"
            value={allGoods || service ? -1 : selectedGood}
            options={options}
            onChange={(value) => setTransportGood(value < 0 ? "all" : value)}
          />
          {transport.flows ? (
            <FlowScale
              color={TRANSPORT_ARROW}
              maximum={flowMaximum(transport.flows)}
              unit={info ? `× ${info.unit} per day` : "t/day"}
            />
          ) : (
            <div className="muted">Waiting for the next snapshot…</div>
          )}
        </div>
      );
    }
  }
}

function AreaLegend() {
  const layer = useGame((state) => state.layer);
  const good = useGame((state) => state.data?.goods[state.selectedGood]?.name);
  const snapshot = useGame((state) => state.snapshot);
  const gradient = (stops: readonly number[]) => `linear-gradient(to right, ${stops.map(cssColor).join(", ")})`;
  switch (layer) {
    case "realms":
      return null;
    case "population": {
      const largest = snapshot ? largestPopulation(snapshot) : 0;
      return (
        <div className="legend" data-testid="legend">
          <div>Population per area</div>
          <div className="bar" style={{ background: gradient(POPULATION) }} />
          <div className="ends">
            <span>≤ {count(largest / 10 ** POPULATION_DECADES)}</span>
            <span>{count(largest)}</span>
          </div>
        </div>
      );
    }
    case "terrain":
      return (
        <div className="legend">
          {Object.entries(TERRAIN_COLORS).map(([name, color]) => (
            <div key={name}>
              <span className="swatch" style={{ background: cssColor(color) }} />
              {name}
            </div>
          ))}
        </div>
      );
    case "prices":
      return (
        <div className="legend">
          <div>Price of {good} vs labor value</div>
          <div className="bar" style={{ background: gradient(DIVERGING) }} />
          <div className="ends">
            <span>÷{PRICE_RANGE}</span>
            <span>1×</span>
            <span>×{PRICE_RANGE}</span>
          </div>
        </div>
      );
    case "resources":
      return (
        <div className="legend">
          <div>Natural capacity of {good}</div>
          <div className="bar" style={{ background: gradient(RESOURCE) }} />
          <div className="ends">
            <span>little</span>
            <span>most on the map</span>
          </div>
        </div>
      );
    case "satisfaction":
      return (
        <div className="legend">
          <div>Necessities met</div>
          <div className="bar" style={{ background: gradient(SATISFACTION) }} />
          <div className="ends">
            <span>0%</span>
            <span>100%</span>
          </div>
        </div>
      );
    case "wage":
      return (
        <div className="legend">
          <div>Average wage</div>
          <div className="bar" style={{ background: gradient(DIVERGING) }} />
          <div className="ends">
            <span>{1 / WAGE_RANGE}</span>
            <span>1</span>
            <span>{WAGE_RANGE}</span>
          </div>
        </div>
      );
  }
}

function ModeBanner() {
  const mode = useGame((state) => state.mode);
  const picked = useGame((state) => state.peaceAreas.length);
  const selected = useGame((state) => state.selection.length);
  const setMode = useGame((state) => state.setMode);
  const { closeLasso, setLassoOperation, selectArea } = gameStore.getState();
  if (mode.kind === "lasso")
    return (
      <div className="mode-banner" role="status" data-testid="lasso-banner">
        Tap corners, then the first one to close ({mode.points.length})
        {selected > 1 && (
          <span className="group">
            {(["add", "remove"] as const).map((operation) => (
              <button
                type="button"
                key={operation}
                className={mode.operation === operation ? "active" : ""}
                aria-pressed={mode.operation === operation}
                onClick={() => setLassoOperation(operation)}
              >
                {operation === "add" ? "Add" : "Remove"}
              </button>
            ))}
          </span>
        )}
        <button type="button" onClick={closeLasso} disabled={mode.points.length < 3}>
          Done
        </button>
        <button type="button" onClick={() => setMode({ kind: "select" })}>
          Cancel
        </button>
      </div>
    );
  if (mode.kind === "select") {
    if (selected <= 1) return null;
    return (
      <div className="mode-banner" role="status">
        <span data-testid="selection-count">{selected} areas selected</span>
        <button type="button" onClick={() => selectArea(null)}>
          Clear
        </button>
      </div>
    );
  }
  return (
    <div className="mode-banner" role="status">
      {mode.kind === "moveArmy" ? "Click the destination" : `Click areas to exchange (${picked})`}
      <button type="button" onClick={() => setMode({ kind: "select" })}>
        {mode.kind === "moveArmy" ? "Cancel" : "Done"}
      </button>
    </div>
  );
}

function Toasts() {
  const toasts = useGame((state) => state.toasts);
  const dismiss = useGame((state) => state.dismissToast);
  useEffect(() => {
    if (toasts.length === 0) return;
    const timer = setTimeout(() => dismiss((toasts[0] as (typeof toasts)[number]).id), 5000);
    return () => clearTimeout(timer);
  }, [toasts, dismiss]);
  return (
    <div className="toasts" aria-live="polite">
      {toasts.map((toast) => (
        <button type="button" className="toast" key={toast.id} onClick={() => dismiss(toast.id)}>
          {toast.text}
        </button>
      ))}
    </div>
  );
}
