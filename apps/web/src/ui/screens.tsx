// New game, realm choice and end-of-session screens (specification §9, Screens).

import { readCode } from "@geonomics/net/code"; // the code helpers alone: PeerJS loads when joining
import {
  type AiMix,
  cellCount,
  DEFAULT_CONFIG,
  EARTH,
  LAND_DISTANCE_PER_TRAVEL_DAY,
  NEW_GAME_PACE,
  type Planet,
  type SaveInfo,
} from "@geonomics/sim";
import { useCallback, useEffect, useRef, useState } from "react";
import type { CatalogName, NewGamePace } from "../host/protocol";
import { deleteSave, listSaves } from "../host/saves";
import { hostEntered, stopHosting } from "../net/host";
import { joinTarget, savedName } from "../net/options";
import { applyUpdate } from "../pwa";
import { useGame } from "../state/store";
import { count, fmt, pct, RangeField, Select, Swatch } from "./components";
import { controllerLabel, Invite, Players } from "./Players";

const MAP_SIZE = { min: 50, max: 3000, step: 50 };
const REALMS = { min: 1, max: 32, step: 1 };
const CATALOGS: { value: CatalogName; label: string }[] = [
  { value: "small", label: "Small — 5 goods" },
  { value: "medium", label: "Medium — 14 goods" },
  { value: "large", label: "Large — 54 goods" },
];

const CIRCUMFERENCE = { min: 5_000, max: 80_000, step: 1_000 };
const POPULATIONS = [1e7, 3e7, 1e8, 3e8, 1e9, 3e9, 8e9, 2e10];
const DAYS_PER_TICK = [0.25, 0.5, 1, 2, 3, 5, 7];
const MULTIPLIERS = [0.1, 0.25, 0.5, 1, 2, 4];

/** People in words: "8 billion", "300 million". */
function people(value: number): string {
  return value >= 1e9 ? `${value / 1e9} billion` : `${value / 1e6} million`;
}

/** A slider over a list of preset values, showing `shown` for the one chosen. */
function PresetField({
  id,
  label,
  presets,
  value,
  onChange,
  shown,
}: {
  id: string;
  label: string;
  presets: readonly number[];
  value: number;
  onChange: (value: number) => void;
  shown: string;
}) {
  const index = Math.max(0, presets.indexOf(value));
  return (
    <RangeField
      id={id}
      label={label}
      min={0}
      max={presets.length - 1}
      step={1}
      value={index}
      onChange={(i) => onChange(presets[i] as number)}
      shown={shown}
    />
  );
}

/**
 * The planet and the pace of a new game: Earth's size and people, and real-world speeds, by default (specification §3,
 * New games).
 */
function PlanetAndPace({
  areas,
  planet,
  setPlanet,
  pace,
  setPace,
}: {
  areas: number;
  planet: Planet;
  setPlanet: (planet: Planet) => void;
  pace: NewGamePace;
  setPace: (pace: NewGamePace) => void;
}) {
  const { economy, population } = DEFAULT_CONFIG;
  const radius = planet.circumference / (2 * Math.PI);
  const spacing =
    radius * Math.sqrt((4 * Math.PI) / cellCount({ landAreaCount: areas, landShare: DEFAULT_CONFIG.map.landShare }));
  const isDefault =
    planet.circumference === EARTH.circumference &&
    planet.population === EARTH.population &&
    (Object.keys(NEW_GAME_PACE) as (keyof NewGamePace)[]).every((key) => pace[key] === NEW_GAME_PACE[key]);
  const multiplier = (value: number) => `×${value}`;
  return (
    <>
      <label htmlFor="circumference">Planet</label>
      <RangeField
        id="circumference"
        label="Circumference"
        {...CIRCUMFERENCE}
        value={planet.circumference}
        onChange={(circumference) => setPlanet({ ...planet, circumference })}
        shown={`${count(planet.circumference)} km around${planet.circumference === EARTH.circumference ? " (Earth)" : ""}`}
      />
      <label htmlFor="people">People</label>
      <PresetField
        id="people"
        label="World population"
        presets={POPULATIONS}
        value={planet.population}
        onChange={(value) => setPlanet({ ...planet, population: value })}
        shown={people(planet.population)}
      />
      <span />
      <span className="muted" data-testid="planet-scale">
        About {count(spacing)} km between neighboring areas · {count(planet.population / areas)} people per area
      </span>
      <label htmlFor="days-per-tick">Pace</label>
      <PresetField
        id="days-per-tick"
        label="Days per tick"
        presets={DAYS_PER_TICK}
        value={pace.gameDaysPerTick}
        onChange={(gameDaysPerTick) => setPace({ ...pace, gameDaysPerTick })}
        shown={`${pace.gameDaysPerTick} ${pace.gameDaysPerTick === 1 ? "day" : "days"} per tick`}
      />
      <label htmlFor="economy">Economy</label>
      <PresetField
        id="economy"
        label="Economy responsiveness"
        presets={MULTIPLIERS}
        value={pace.economyResponsiveness}
        onChange={(economyResponsiveness) => setPace({ ...pace, economyResponsiveness })}
        shown={`${multiplier(pace.economyResponsiveness)} · prices settle in ${fmt(
          Math.round((10 * Math.LN2) / (economy.priceAdjustmentRatePerDay * pace.economyResponsiveness)) / 10,
        )} days`}
      />
      <label htmlFor="demography">Demography</label>
      <PresetField
        id="demography"
        label="Demography responsiveness"
        presets={MULTIPLIERS}
        value={pace.demographyResponsiveness}
        onChange={(demographyResponsiveness) => setPace({ ...pace, demographyResponsiveness })}
        shown={`${multiplier(pace.demographyResponsiveness)} · births ${pct(
          population.birthRatePerDay * pace.demographyResponsiveness * 365,
        )}/year`}
      />
      <label htmlFor="military">Military</label>
      <PresetField
        id="military"
        label="Military responsiveness"
        presets={MULTIPLIERS}
        value={pace.militaryResponsiveness}
        onChange={(militaryResponsiveness) => setPace({ ...pace, militaryResponsiveness })}
        shown={`${multiplier(pace.militaryResponsiveness)} · marching ${fmt(LAND_DISTANCE_PER_TRAVEL_DAY * pace.militaryResponsiveness)} km/day`}
      />
      <span />
      <div className="row">
        <button
          type="button"
          disabled={isDefault}
          onClick={() => {
            setPlanet(EARTH);
            setPace(NEW_GAME_PACE);
          }}
        >
          Reset to Earth
        </button>
      </div>
    </>
  );
}

const AI_MIXES: { value: AiMix; label: string }[] = [
  { value: "balanced", label: "Balanced — traders, builders, conquerors" },
  { value: "peaceful", label: "Peaceful — traders and builders" },
  { value: "aggressive", label: "Aggressive — half conquerors" },
];

/** Debug only: ?warmup=N shortens the warm-up, so end-to-end tests start quickly. */
function warmupOverride(): number | undefined {
  const value = new URLSearchParams(location.search).get("warmup");
  return value === null ? undefined : Number(value);
}

export function NewGame() {
  const progress = useGame((state) => state.progress);
  const newGame = useGame((state) => state.newGame);
  const menuError = useGame((state) => state.menuError);
  const updateReady = useGame((state) => state.updateReady);
  const openGuide = useGame((state) => state.openGuide);
  const [catalog, setCatalog] = useState<CatalogName>("large");
  const [areas, setAreas] = useState<number>(300);
  const [seed, setSeed] = useState(() => Math.floor(Math.random() * 1e6));
  const [chosenRealms, setRealms] = useState(8);
  const [aiMix, setAiMix] = useState<AiMix>("balanced");
  const [planet, setPlanet] = useState<Planet>(EARTH);
  const [pace, setPace] = useState<NewGamePace>(NEW_GAME_PACE);
  const realms = Math.min(chosenRealms, areas); // at most one realm per area

  return (
    <main className="screen">
      <div className="card">
        <h1>Geonomics</h1>
        {updateReady && (
          <div className="row update" role="status">
            A new version is ready.
            <button type="button" onClick={applyUpdate}>
              Reload
            </button>
          </div>
        )}
        <p className="muted">
          Run a realm on a living map. Every area produces, trades and sets its own prices; you tax, trade, build and
          fight on top of it.{" "}
          <button type="button" className="link" onClick={openGuide}>
            How to play
          </button>
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
              newGame({ catalog, areas, seed, realms, aiMix, planet, pace, warmupDays: warmupOverride() });
            }}
          >
            <div className="form-grid">
              <label htmlFor="catalog">Goods</label>
              <Select label="Goods catalog" value={catalog} options={CATALOGS} onChange={setCatalog} />
              <label htmlFor="size">Map</label>
              <RangeField
                id="size"
                label="Map size"
                {...MAP_SIZE}
                value={areas}
                onChange={setAreas}
                shown={`${count(areas)} areas`}
              />
              <label htmlFor="realms">Realms</label>
              <RangeField
                id="realms"
                label="Realms"
                {...REALMS}
                value={realms}
                onChange={setRealms}
                shown={realms === 1 ? "1 realm" : `${realms} realms`}
              />
              <label htmlFor="ai-mix">AI</label>
              <Select label="AI personalities" value={aiMix} options={AI_MIXES} onChange={setAiMix} />
              <PlanetAndPace areas={areas} planet={planet} setPlanet={setPlanet} pace={pace} setPace={setPace} />
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
        {menuError && (
          <p className="error" role="alert">
            {menuError}
          </p>
        )}
        {!progress && <SavedGames />}
        {!progress && <JoinWithCode />}
      </div>
    </main>
  );
}

/** Joining a friend's game by typing its code, or pasting its link. */
function JoinWithCode() {
  const [text, setText] = useState("");
  const code = readCode(text);
  return (
    <form
      className="section"
      onSubmit={(event) => {
        event.preventDefault();
        if (!code) return;
        // The page decides at load whether it hosts or joins: reload it on the join link.
        location.hash = `join=${code}`;
        location.reload();
      }}
    >
      <h3>Join with a code</h3>
      <div className="row">
        <input
          aria-label="Game code"
          placeholder="k7m3qx"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          value={text}
          onChange={(event) => setText(event.target.value)}
          style={{ flex: 1 }}
        />
        <button type="submit" disabled={!code}>
          Join
        </button>
      </div>
    </form>
  );
}

/** Games saved in this browser, and loading a save file (specification §8, Save and load). */
function SavedGames() {
  const loadGame = useGame((state) => state.loadGame);
  const [saves, setSaves] = useState<SaveInfo[]>([]);
  const fileInput = useRef<HTMLInputElement>(null);
  const refresh = useCallback(() => {
    listSaves().then(setSaves, () => setSaves([])); // no storage, as in some private windows: no saved games
  }, []);
  useEffect(refresh, [refresh]);
  const load = (source: Parameters<typeof loadGame>[0]) => {
    stopHosting();
    loadGame(source);
  };
  return (
    <div className="section">
      <h3>Saved games</h3>
      {saves.length === 0 ? (
        <p className="muted">None yet: games save themselves as you play.</p>
      ) : (
        <div className="save-list">
          {saves.map((save) => (
            <div className="save" key={save.gameId} data-testid="saved-game">
              <div>
                <div>
                  {save.title} · day {count(save.gameDay)}
                </div>
                <div className="muted">
                  {count(save.areas)} areas, {save.catalog} catalog · {new Date(save.savedAt).toLocaleString()}
                </div>
              </div>
              <div className="row">
                <button type="button" className="primary" onClick={() => load({ gameId: save.gameId })}>
                  Continue
                </button>
                <button
                  type="button"
                  aria-label={`Delete ${save.title}, day ${Math.floor(save.gameDay)}`}
                  onClick={() => {
                    if (confirm(`Delete the save of ${save.title}?`)) deleteSave(save.gameId).then(refresh, refresh);
                  }}
                >
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
      <button type="button" onClick={() => fileInput.current?.click()}>
        Load from file…
      </button>
      <input
        ref={fileInput}
        type="file"
        hidden
        aria-label="Save file"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file) void file.arrayBuffer().then((bytes) => load({ file: new Uint8Array(bytes) }));
        }}
      />
    </div>
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
      <div className="card wide">
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
        {summary.realms.length > 0 && (
          <section className="section">
            <h3>Every realm</h3>
            <div className="table-scroll">
              <table data-testid="realm-results">
                <thead>
                  <tr>
                    <th>Realm</th>
                    <th className="num">Areas</th>
                    <th className="num">Population</th>
                    <th className="num" title="The largest population the realm reached this session">
                      Peak
                    </th>
                    <th
                      className="num"
                      title="Net income per member of the workforce and day, the unemployed included, over the local cost of living, in man-hours"
                    >
                      Real net income, mh/day
                    </th>
                    <th className="num" title="Share of the need for necessities people could buy">
                      Necessities
                    </th>
                    <th className="num">Soldiers</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.realms.map((realm) => (
                    <tr key={realm.id} className={realm.id === summary.viewer ? "chosen-row" : undefined}>
                      <td>
                        <Swatch color={realm.color} />
                        {realm.name}
                        <div className="muted">
                          {realm.ranBy}
                          {realm.eliminated ? " · fallen" : ""}
                        </div>
                      </td>
                      <td className="num">{count(realm.areas)}</td>
                      <td className="num">{count(realm.population)}</td>
                      <td className="num">{count(realm.peakPopulation)}</td>
                      <td className="num">{realm.eliminated ? "—" : fmt(realm.realNetIncome)}</td>
                      <td className="num">{realm.eliminated ? "—" : pct(realm.necessitySatisfaction)}</td>
                      <td className="num">{count(realm.soldiers)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <span className="hint">Treasuries and depots stay private, as during the game.</span>
          </section>
        )}
        <button type="button" className="primary" onClick={leave}>
          New game
        </button>
      </div>
    </main>
  );
}
