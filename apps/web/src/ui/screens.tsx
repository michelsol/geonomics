// New game, realm choice and end-of-session screens (specification §10, Screens).

import type { AiMix } from "@geonomics/sim";
import { useState } from "react";
import type { CatalogName } from "../host/protocol";
import { hostEntered, stopHosting } from "../net/host";
import { joinTarget, savedName } from "../net/options";
import { useGame } from "../state/store";
import { count, fmt, Select, Swatch } from "./components";
import { controllerLabel, Invite, Players } from "./Players";

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

const AI_MIXES: { value: AiMix; label: string }[] = [
  { value: "balanced", label: "Balanced — traders, builders, conquerors" },
  { value: "peaceful", label: "Peaceful — traders and builders" },
  { value: "aggressive", label: "Aggressive — half conquerors" },
];

const REALM_COUNTS = [4, 6, 8, 12, 16, 24, 32];
/** Realms keep at least this many areas each on average. */
const AREAS_PER_REALM = 8;

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
  const [chosenRealms, setRealms] = useState(8);
  const [aiMix, setAiMix] = useState<AiMix>("balanced");
  const realmOptions = REALM_COUNTS.filter((n) => n * AREAS_PER_REALM <= areas).map((n) => ({
    value: n,
    label: `${n} realms`,
  }));
  const realms = Math.min(chosenRealms, (realmOptions.at(-1) as { value: number }).value);

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
              stopHosting();
              newGame({ catalog, areas, seed, realms, aiMix, warmupDays: warmupOverride() });
            }}
          >
            <div className="form-grid">
              <label htmlFor="catalog">Goods</label>
              <Select label="Goods catalog" value={catalog} options={CATALOGS} onChange={setCatalog} />
              <label htmlFor="size">Map</label>
              <Select label="Map size" value={areas} options={SIZES} onChange={setAreas} />
              <label htmlFor="realms">Realms</label>
              <Select label="Realms" value={realms} options={realmOptions} onChange={setRealms} />
              <label htmlFor="ai-mix">AI</label>
              <Select label="AI personalities" value={aiMix} options={AI_MIXES} onChange={setAiMix} />
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

/** The lobby: every realm and who holds it; the host invites, and everyone picks a free realm or watches. */
export function ChooseRealm() {
  const governments = useGame((state) => state.governments);
  const data = useGame((state) => state.data);
  const session = useGame((state) => state.session);
  const chooseRealm = useGame((state) => state.chooseRealm);
  // Someone else holding the realm: for the host, every joined player; for a joined player, the host too.
  const me = session.me?.id ?? "local";
  const holder = (government: number) => session.players.find((p) => p.government === government && p.id !== me);
  const free = governments.filter((g) => !g.isEliminated && !holder(g.id));
  const client = session.role === "client";
  const pick = (government: number | null) => {
    chooseRealm(government);
    if (!client) hostEntered(government);
  };
  return (
    <main className="screen">
      <div className="card">
        <h2>Choose your realm</h2>
        {client && (
          <p className="muted">
            {session.started ? "The game is running." : "The host has not started yet."} Pick a free realm or watch.
          </p>
        )}
        <div className="realm-list">
          {governments.map((government) => {
            const held = holder(government.id);
            return (
              <button
                type="button"
                key={government.id}
                disabled={held !== undefined || government.isEliminated}
                onClick={() => pick(government.id)}
              >
                <span>
                  <Swatch color={government.color} />
                  {government.capital === null ? government.name : data?.areas[government.capital]?.name}
                </span>
                <span className="muted">
                  {held ? held.name : controllerLabel(government, session.players)} · {government.areaCount} areas ·{" "}
                  {count(government.population)} people
                </span>
              </button>
            );
          })}
        </div>
        <div className="row">
          <button
            type="button"
            disabled={free.length === 0}
            onClick={() => pick((free[Math.floor(Math.random() * free.length)] as (typeof free)[number]).id)}
          >
            Random realm
          </button>
          <button type="button" onClick={() => pick(null)}>
            Watch
          </button>
        </div>
        {!client && (
          <div className="section">
            <h3>Players</h3>
            <Invite />
          </div>
        )}
        <Players />
      </div>
    </main>
  );
}

/** Joining from a link: a name, then the connection's progress. */
export function Join() {
  const session = useGame((state) => state.session);
  const [name, setName] = useState(savedName);
  const host = joinTarget();
  const connecting = session.connection === "connecting" || session.connection === "reconnecting";
  return (
    <main className="screen">
      <div className="card">
        <h1>Join a game</h1>
        <form
          className="section"
          onSubmit={(event) => {
            event.preventDefault();
            if (host && name.trim()) void import("../net/client").then((client) => client.join(host, name.trim()));
          }}
        >
          <div className="form-grid">
            <label htmlFor="player-name">Your name</label>
            <input
              id="player-name"
              aria-label="Your name"
              value={name}
              maxLength={32}
              onChange={(event) => setName(event.target.value)}
            />
          </div>
          <button type="submit" className="primary" disabled={connecting || !name.trim()}>
            {connecting ? "Connecting…" : "Join"}
          </button>
        </form>
        {session.refused && <p data-testid="join-status">The host refused: {session.refused}</p>}
        {connecting && session.problem && (
          <p className="muted" data-testid="join-problem">
            Still trying: {session.problem}.
          </p>
        )}
        {session.connection === "lost" && <p data-testid="join-status">Could not reach the host. Is its tab open?</p>}
      </div>
    </main>
  );
}

export function EndOfSession() {
  const summary = useGame((state) => state.summary);
  const backToMenu = useGame((state) => state.backToMenu);
  const role = useGame((state) => state.session.role);
  // A joined player leaves the host's page behind: the menu is a solo game of its own.
  const leave = () => {
    if (role === "client") location.assign(location.pathname + location.search);
    else {
      stopHosting();
      backToMenu();
    }
  };
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
        <button type="button" className="primary" onClick={leave}>
          New game
        </button>
      </div>
    </main>
  );
}
