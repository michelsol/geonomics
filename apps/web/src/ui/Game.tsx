// The game screen: top bar, map and panels, as a sidebar on desktop or a bottom sheet on phones.
import { type ReactNode, useEffect, useState } from "react";
import { cssColor, DIVERGING, PRICE_RANGE, SATISFACTION, TERRAIN_COLORS, WAGE_RANGE } from "../map/colors";
import { MapView } from "../map/MapView";
import type { Layer } from "../state/store";
import { gameStore, useGame } from "../state/store";
import { fmt, Select } from "./components";
import { AreaPanel } from "./panels/AreaPanel";
import { ArmiesPanel } from "./panels/ArmiesPanel";
import type { PanelName, PanelProps } from "./panels/common";
import { DiplomacyPanel } from "./panels/DiplomacyPanel";
import { GoodPanel } from "./panels/GoodPanel";
import { GovernmentPanel } from "./panels/GovernmentPanel";
import { JobsPanel } from "./panels/JobsPanel";
import { OrdersPanel } from "./panels/OrdersPanel";

const PANELS = {
  area: { label: "Area", view: AreaPanel },
  good: { label: "Goods", view: GoodPanel },
  government: { label: "Realm", view: GovernmentPanel },
  orders: { label: "Orders", view: OrdersPanel },
  jobs: { label: "Jobs", view: JobsPanel },
  armies: { label: "Armies", view: ArmiesPanel },
  diplomacy: { label: "Diplomacy", view: DiplomacyPanel },
} as const satisfies Record<PanelName, { label: string; view: (props: PanelProps) => ReactNode }>;

const LAYERS: { value: Layer; label: string }[] = [
  { value: "realms", label: "Realms" },
  { value: "prices", label: "Prices" },
  { value: "satisfaction", label: "Satisfaction" },
  { value: "wage", label: "Wage level" },
  { value: "terrain", label: "Terrain" },
];

type SheetHeight = "peek" | "half" | "full";

export function Game() {
  const [panel, setPanel] = useState<PanelName>("area");
  const [sheet, setSheet] = useState<SheetHeight>("peek");
  const View = PANELS[panel].view as (props: PanelProps) => ReactNode;

  useEffect(() => {
    // Space toggles pause; the game pauses while the tab is hidden.
    const key = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (event.code !== "Space" || target?.closest("input, select, textarea, button")) return;
      event.preventDefault();
      gameStore.getState().togglePause();
    };
    const visibility = () => {
      if (document.hidden) gameStore.getState().setPaused(true);
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
    <div className="game">
      <TopBar />
      <div className="map-wrap">
        <MapView />
        <Legend />
        <ModeBanner />
        <Toasts />
      </div>
      <aside className={`side ${sheet}`} aria-label="Panels">
        <button
          type="button"
          className="sheet-handle"
          aria-label="Resize panel"
          onClick={() => setSheet(sheet === "peek" ? "half" : sheet === "half" ? "full" : "peek")}
        />
        <nav className="tabs">
          {(Object.keys(PANELS) as PanelName[]).map((name) => (
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
  const layer = useGame((state) => state.layer);
  const { setSpeed, togglePause, setLayer } = gameStore.getState();
  return (
    <header className="topbar">
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
      <span className="stat" data-testid="game-day">
        Day {Math.floor(day)}
      </span>
      <span className="stat" title="Treasury, in man-hours">
        💰 {fmt(treasury)}
      </span>
      <span className="stat muted hide-phone" title="Ticks per second and milliseconds per tick">
        {status.ticksPerSecond} t/s · {status.msPerTick.toFixed(1)} ms
      </span>
      <div className="group" style={{ marginLeft: "auto" }}>
        <Select label="Map layer" value={layer} options={LAYERS} onChange={setLayer} />
      </div>
    </header>
  );
}

function Legend() {
  const layer = useGame((state) => state.layer);
  const good = useGame((state) => state.data?.goods[state.selectedGood]?.name);
  const gradient = (stops: readonly number[]) => `linear-gradient(to right, ${stops.map(cssColor).join(", ")})`;
  switch (layer) {
    case "realms":
      return null;
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
          <div>Wage level</div>
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
  const setMode = useGame((state) => state.setMode);
  if (mode.kind === "select") return null;
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
