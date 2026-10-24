// The game screen: top bar, map and panels, as a sidebar on desktop or a bottom sheet on phones.
import { type CSSProperties, type ReactNode, useEffect, useRef, useState } from "react";
import { arrowWidth } from "../map/arrows";
import {
  cssColor,
  DIVERGING,
  EMPLOYMENT,
  MIGRATION_ARROW,
  POPULATION,
  POPULATION_DECADES,
  SATISFACTION,
  STRIPE_COLOR,
  STRIPE_TILE,
  STRIPE_WIDTHS,
  TERRAIN_COLORS,
  TRANSPORT_ARROW,
} from "../map/colors";
import { MapView } from "../map/MapView";
import {
  flowMaximum,
  largestPopulation,
  priceSpread,
  realIncomes,
  realmPopulation,
  spreadOf,
  transportFlows,
} from "../state/selectors";
import { gameStore, type PanelName, useGame } from "../state/store";
import { count, fmt } from "./components";
import { AreaPanel } from "./panels/AreaPanel";
import { ArmiesPanel } from "./panels/ArmiesPanel";
import type { PanelProps } from "./panels/common";
import { DiplomacyPanel } from "./panels/DiplomacyPanel";
import { GamePanel } from "./panels/GamePanel";
import { GoodsPanel } from "./panels/GoodsPanel";
import { JobsPanel } from "./panels/JobsPanel";
import { NeedsPanel } from "./panels/NeedsPanel";
import { PoliciesPanel } from "./panels/PoliciesPanel";
import { PopulationPanel } from "./panels/PopulationPanel";
import { ResourcesPanel } from "./panels/ResourcesPanel";
import { SelectionBar } from "./SelectionBar";

// Each panel sets the map layer it needs (PANEL_LAYERS in the store).
const PANELS = {
  area: { label: "Area", view: AreaPanel },
  goods: { label: "Goods", view: GoodsPanel },
  population: { label: "Population", view: PopulationPanel },
  needs: { label: "Needs", view: NeedsPanel },
  resources: { label: "Resources", view: ResourcesPanel },
  policies: { label: "Policies", view: PoliciesPanel },
  jobs: { label: "Jobs", view: JobsPanel },
  armies: { label: "Armies", view: ArmiesPanel },
  diplomacy: { label: "Diplomacy", view: DiplomacyPanel },
  game: { label: "Game", view: GamePanel },
} as const satisfies Record<PanelName, { label: string; view: (props: PanelProps) => ReactNode }>;

type SheetHeight = "peek" | "half" | "full";

const SPECTATOR_PANELS: readonly PanelName[] = ["area", "goods", "population", "needs", "resources", "game"];

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
  const chosenPanel = useGame((state) => state.panel);
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
        // Escape leaves the brush or another mode, then a selection of several areas.
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
    gameStore.getState().openPanel(name);
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
            <button
              type="button"
              key={name}
              className={name === panel ? "active" : ""}
              onClick={(event) => {
                openPanel(name);
                // On a phone the tabs scroll sideways: bring the chosen one fully into view.
                event.currentTarget.scrollIntoView({ block: "nearest", inline: "nearest" });
              }}
            >
              {PANELS[name].label}
            </button>
          ))}
        </nav>
        <SelectionBar />
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
  const { setSpeed, togglePause } = gameStore.getState();
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
            👥 {count(population)}
          </span>
        )}
      </div>
      <span className="stat muted hide-phone" title="Ticks per second and milliseconds per tick">
        {status.ticksPerSecond} t/s · {status.msPerTick.toFixed(1)} ms
      </span>
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
  const selectedGood = useGame((state) => state.selectedGood);
  // Derived here, not in the selector: a selector returning a fresh object would re-render forever.
  const transport = transportFlows({ snapshot, selectedGood });
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
      const info = data?.goods[transport.good];
      return (
        <div className="legend" data-testid="flow-legend">
          <div>{info?.name} carried per day, each direction</div>
          {info?.isService ? (
            <div className="muted">Services are not carried between areas</div>
          ) : transport.flows ? (
            <FlowScale
              color={TRANSPORT_ARROW}
              maximum={flowMaximum(transport.flows)}
              unit={`× ${info?.unit} per day`}
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
  const resource = useGame((state) => state.data?.goods[state.selectedResource]?.name);
  const snapshot = useGame((state) => state.snapshot);
  const data = useGame((state) => state.data);
  const table = useGame((state) => state.priceTable);
  const selectedGood = useGame((state) => state.selectedGood);
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
    case "prices": {
      const scale = data && table ? priceSpread(data, table, selectedGood) : null;
      return (
        <div className="legend" data-testid="legend">
          <div>Price of {good}, in mh</div>
          <div className="bar" style={{ background: gradient(DIVERGING) }} />
          {scale && <SpreadEnds scale={scale} />}
        </div>
      );
    }
    case "resources":
      return (
        <div className="legend" data-testid="legend">
          <div>Natural capacity of {resource}</div>
          <div className="stripes">
            {STRIPE_WIDTHS.map((width) => (
              <span key={width} className="stripe-swatch" style={{ background: stripes(width) }} />
            ))}
          </div>
          <div className="ends">
            <span>little</span>
            <span>most on the map</span>
          </div>
          <div className="terrains">
            {Object.entries(TERRAIN_COLORS).map(([name, color]) => (
              <span key={name}>
                <span className="swatch" style={{ background: cssColor(color) }} />
                {name}
              </span>
            ))}
          </div>
        </div>
      );
    case "satisfaction":
      return (
        <div className="legend" data-testid="legend">
          <div>Necessities met</div>
          <div className="bar" style={{ background: gradient(SATISFACTION) }} />
          <div className="ends">
            <span>0%</span>
            <span>100%</span>
          </div>
        </div>
      );
    case "income": {
      const hours = data?.config.economy.hoursPerWorkerDay ?? 1;
      const scale = data && snapshot ? spreadOf(realIncomes(data, snapshot, table)) : null;
      return (
        <div className="legend" data-testid="legend">
          <div title="Income per worker and day, over the local cost of living">Real income, mh/day</div>
          <div className="bar" style={{ background: gradient(DIVERGING) }} />
          {scale && (
            <SpreadEnds scale={{ low: hours * scale.low, median: hours * scale.median, high: hours * scale.high }} />
          )}
        </div>
      );
    }
    case "employment":
      return (
        <div className="legend" data-testid="legend">
          <div>Employment rate: workers with a job</div>
          <div className="bar" style={{ background: gradient(EMPLOYMENT) }} />
          <div className="ends">
            <span>0%</span>
            <span>100%</span>
          </div>
        </div>
      );
  }
}

/** The ends of a scale drawn against the map's own values: its lowest, median and highest. */
function SpreadEnds({ scale }: { scale: { low: number; median: number; high: number } }) {
  return (
    <div className="ends">
      <span title="Lowest on the map">{fmt(scale.low)}</span>
      <span title="Median">{fmt(scale.median)}</span>
      <span title="Highest on the map">{fmt(scale.high)}</span>
    </div>
  );
}

/** A legend sample of the resources layer's stripes, at half their size on the map tile. */
function stripes(width: number): string {
  const scale = 0.5;
  const period = (STRIPE_TILE / Math.SQRT2) * scale;
  const line = width * scale;
  return `repeating-linear-gradient(-45deg, ${STRIPE_COLOR} 0 ${line}px, transparent ${line}px ${period}px), ${cssColor(TERRAIN_COLORS.plains)}`;
}

function ModeBanner() {
  const mode = useGame((state) => state.mode);
  const picked = useGame((state) => state.peaceAreas.length);
  const brush = useGame((state) => state.brush);
  const setMode = useGame((state) => state.setMode);
  const setBrush = useGame((state) => state.setBrush);
  if (mode.kind === "select") return null;
  if (mode.kind === "brush")
    return (
      <div className="mode-banner" role="status" data-testid="brush-banner">
        <span className="hide-phone" title="Two fingers, or a right-button drag, move the map while the brush is on">
          Paint over areas
        </span>
        <span className="group">
          {[false, true].map((erase) => (
            <button
              type="button"
              key={String(erase)}
              className={brush.erase === erase ? "active" : ""}
              aria-pressed={brush.erase === erase}
              onClick={() => setBrush({ erase })}
            >
              {erase ? "Erase" : "Add"}
            </button>
          ))}
        </span>
        <span className="group">
          {(["S", "M", "L"] as const).map((size) => (
            <button
              type="button"
              key={size}
              className={brush.size === size ? "active" : ""}
              aria-pressed={brush.size === size}
              aria-label={`Brush size ${size}`}
              onClick={() => setBrush({ size })}
            >
              {size}
            </button>
          ))}
        </span>
        <button type="button" onClick={() => setMode({ kind: "select" })}>
          Done
        </button>
      </div>
    );
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
