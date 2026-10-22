// New game, realm choice and end-of-session screens (specification §10, Screens).
import { useState } from "react";
import type { CatalogName } from "../host/protocol";
import { useGame } from "../state/store";
import { count, fmt, Select, Swatch } from "./components";

const SIZES = [
  { value: 300, label: "Small — 300 areas" },
  { value: 1000, label: "Medium — 1,000 areas" },
  { value: 3000, label: "Large — 3,000 areas" },
] as const;
const CATALOGS: { value: CatalogName; label: string }[] = [
  { value: "small", label: "Small — 5 goods" },
  { value: "medium", label: "Medium — 14 goods" },
  { value: "large", label: "Large — 54 goods" },
];

/** Debug only: ?warmup=N shortens the warm-up, so end-to-end tests start quickly. */
function warmupOverride(): number | undefined {
  const value = new URLSearchParams(location.search).get("warmup");
  return value === null ? undefined : Number(value);
}

export function NewGame() {
  const progress = useGame((state) => state.progress);
  const newGame = useGame((state) => state.newGame);
  const [catalog, setCatalog] = useState<CatalogName>("medium");
  const [areas, setAreas] = useState<number>(1000);
  const [seed, setSeed] = useState(() => Math.floor(Math.random() * 1e6));

  return (
    <main className="screen">
      <div className="card">
        <h1>Geonomics</h1>
        <p className="muted">
          Run a realm on a living map. Every area produces, trades and sets its own prices; you tax, trade, build and
          fight on top of it.
        </p>
        {progress ? (
          <div className="section" role="status">
            <div>{progress.stage}…</div>
            <div className="progress">
              <div style={{ width: `${Math.round(progress.done * 100)}%` }} />
            </div>
          </div>
        ) : (
          <form
            className="section"
            onSubmit={(event) => {
              event.preventDefault();
              newGame({ catalog, areas, seed, warmupDays: warmupOverride() });
            }}
          >
            <div className="form-grid">
              <label htmlFor="catalog">Goods</label>
              <Select label="Goods catalog" value={catalog} options={CATALOGS} onChange={setCatalog} />
              <label htmlFor="size">Map</label>
              <Select label="Map size" value={areas} options={SIZES} onChange={setAreas} />
              <label htmlFor="seed">Seed</label>
              <div className="row">
                <input
                  id="seed"
                  aria-label="Seed"
                  type="number"
                  value={seed}
                  onChange={(event) => setSeed(Number(event.target.value) || 0)}
                />
                <button type="button" onClick={() => setSeed(Math.floor(Math.random() * 1e6))}>
                  Random
                </button>
              </div>
            </div>
            <button type="submit" className="primary">
              New game
            </button>
          </form>
        )}
      </div>
    </main>
  );
}

export function ChooseRealm() {
  const governments = useGame((state) => state.governments);
  const data = useGame((state) => state.data);
  const chooseRealm = useGame((state) => state.chooseRealm);
  return (
    <main className="screen">
      <div className="card">
        <h2>Choose your realm</h2>
        <div className="realm-list">
          {governments.map((government) => (
            <button type="button" key={government.id} onClick={() => chooseRealm(government.id)}>
              <span>
                <Swatch color={government.color} />
                {government.capital === null ? government.name : data?.areas[government.capital]?.name}
              </span>
              <span className="muted">
                {government.areaCount} areas · {count(government.population)} people
              </span>
            </button>
          ))}
        </div>
        <button type="button" onClick={() => chooseRealm(Math.floor(Math.random() * governments.length))}>
          Random realm
        </button>
      </div>
    </main>
  );
}

export function EndOfSession() {
  const summary = useGame((state) => state.summary);
  const backToMenu = useGame((state) => state.backToMenu);
  if (!summary) return null;
  return (
    <main className="screen">
      <div className="card">
        <h2>{summary.eliminated ? "Your realm has fallen" : "Session over"}</h2>
        <table>
          <tbody>
            <tr>
              <td>Days played</td>
              <td className="num">{count(summary.days)}</td>
            </tr>
            <tr>
              <td>Peak population</td>
              <td className="num">{count(summary.peakPopulation)}</td>
            </tr>
            <tr>
              <td>Final population</td>
              <td className="num">{count(summary.finalPopulation)}</td>
            </tr>
            <tr>
              <td>Areas held</td>
              <td className="num">{summary.areas}</td>
            </tr>
            <tr>
              <td>Treasury</td>
              <td className="num">{fmt(summary.treasury)} mh</td>
            </tr>
          </tbody>
        </table>
        <button type="button" className="primary" onClick={backToMenu}>
          New game
        </button>
      </div>
    </main>
  );
}
