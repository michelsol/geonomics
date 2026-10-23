// The player's realm: treasury, population, research, realm-wide policies, and ending the session.
import { realmPopulation } from "../../state/selectors";
import { useGame } from "../../state/store";
import { Chart } from "../Chart";
import { count, fmt, Section, Stat, Swatch } from "../components";
import { AreaLink, useView } from "./common";

export function GovernmentPanel() {
  const view = useView();
  const history = useGame((state) => state.history);
  useGame((state) => state.historyVersion);
  const endGame = useGame((state) => state.endGame);
  if (!view) return null;
  const { data, snapshot, government } = view;
  const summary = snapshot.governments[government.id];
  const realm = history?.realm;
  const days = realm?.xs() ?? [];
  const treasuries = realm?.channel(1) ?? [];
  // Treasury change per day over the last recorded stretch (up to 30 samples).
  const span = Math.min(30, days.length - 1);
  const perDay =
    span > 0
      ? ((treasuries.at(-1) as number) - (treasuries.at(-1 - span) as number)) /
        Math.max((days.at(-1) as number) - (days.at(-1 - span) as number), 1e-9)
      : 0;
  const research = data.config.government;

  return (
    <>
      <Section title="Realm">
        <h2>
          {summary && <Swatch color={summary.color} />}
          {summary?.name}
        </h2>
        <div className="stats">
          <Stat label="Treasury" value={`${fmt(government.treasury)} mh`} testId="treasury" />
          <Stat label="Per day" value={`${perDay >= 0 ? "+" : ""}${fmt(perDay)}`} />
          <Stat label="Population" value={count(realmPopulation(snapshot))} />
          <Stat label="Areas" value={government.ownedAreas.length} />
          <Stat
            label="Research"
            value={`L${government.researchLevel} · ${Math.round((100 * government.researchProgress) / research.researchWorkerDaysPerLevel)}%`}
          />
        </div>
        {government.capital !== null && (
          <div>
            Capital: <AreaLink area={government.capital} />
          </div>
        )}
      </Section>

      {realm && realm.length > 1 && (
        <Section title="History">
          <p className="chart-caption">Treasury (mh)</p>
          <Chart x={days} height={140} series={[{ label: "treasury", color: "#3987e5", values: treasuries }]} />
          <p className="chart-caption">Population</p>
          <Chart x={days} height={140} series={[{ label: "population", color: "#3987e5", values: realm.channel(0) }]} />
        </Section>
      )}

      <Section title="Session">
        <button type="button" className="danger" onClick={endGame}>
          End game
        </button>
      </Section>
    </>
  );
}
