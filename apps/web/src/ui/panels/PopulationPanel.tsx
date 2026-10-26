// Population of the selection, or of the realm when nothing is selected (specification §9, Panels): people, births,
// deaths, migrants in and out, and their history. The map shows population, with migration flows on request.
import { DEMOGRAPHY_KEYS, demographyOf } from "../../state/selectors";
import { useGame } from "../../state/store";
import { Chart } from "../Chart";
import { Checkbox, count, fmt, Section, Stat } from "../components";
import { shownAreas, usePublicView } from "./common";

const perDay = (value: number) => `${fmt(value)}/day`;
const signedPerDay = (value: number) => `${value > 0 ? "+" : ""}${perDay(value)}`;
const channel = (key: (typeof DEMOGRAPHY_KEYS)[number]) => DEMOGRAPHY_KEYS.indexOf(key);

export function PopulationPanel() {
  const view = usePublicView();
  const selection = useGame((state) => state.selection);
  const edges = useGame((state) => state.edges);
  const history = useGame((state) => state.history);
  useGame((state) => state.historyVersion); // redraw the charts with every new sample
  const showMigration = useGame((state) => state.showMigration);
  const setShowMigration = useGame((state) => state.setShowMigration);
  const betweenRealms = useGame((state) => state.flowsBetweenRealms);
  const setBetweenRealms = useGame((state) => state.setFlowsBetweenRealms);
  if (!view) return <p className="muted">Waiting for the first snapshot…</p>;
  const { data, snapshot, government } = view;
  const { areas, heading } = shownAreas(data, government, selection);
  const now = demographyOf(snapshot, edges, areas);
  const series = history?.demographyOf(selection);
  const net = now.births - now.deaths + now.immigration - now.emigration;

  return (
    <>
      <section className="section">
        <h2 data-testid="population-of">{heading}</h2>
        <div className="stats">
          <Stat label="Population" value={count(now.population)} testId="population-total" />
          <Stat
            label="Change"
            value={signedPerDay(net)}
            title="Births less deaths, plus immigration less emigration."
          />
          <Stat
            label="Births"
            value={perDay(now.births)}
            testId="births"
            title="People born per day, at the same rate whatever the necessities met."
          />
          <Stat
            label="Deaths"
            value={perDay(now.deaths)}
            testId="deaths"
            title="People dying per day for lack of necessities (food and the like), rising with the square of the share not met. A full area settles where deaths match births."
          />
          <Stat
            label="Immigration"
            value={perDay(now.immigration)}
            testId="immigration"
            title={
              areas.length > 1
                ? "People arriving per day from other areas; moves between two of these areas are not counted."
                : "People arriving per day from other areas."
            }
          />
          <Stat
            label="Emigration"
            value={perDay(now.emigration)}
            testId="emigration"
            title="People leaving per day for other areas, drawn by better incomes and satisfaction."
          />
        </div>
        <Checkbox
          label="Show migration flows"
          title="Arrows on the map for the people moving between areas"
          checked={showMigration}
          onChange={setShowMigration}
        />
        <Checkbox
          label="Between realms only"
          title="One arrow per pair of realms, from capital to capital, adding up every edge between them; neutral areas count as one group"
          checked={betweenRealms}
          disabled={!showMigration}
          onChange={setBetweenRealms}
        />
      </section>

      {series && series.length > 1 && (
        <>
          <Section title="Population">
            <Chart
              testId="population-chart"
              x={series.xs()}
              series={[{ label: "population", color: "#9d93ea", values: series.channel(channel("population")) }]}
              height={140}
            />
          </Section>
          <Section title="Births and deaths per day">
            <Chart
              testId="births-deaths-chart"
              x={series.xs()}
              series={[
                { label: "births", color: "#6fbf5a", values: series.channel(channel("births")) },
                { label: "deaths", color: "#ef5d5d", values: series.channel(channel("deaths")) },
              ]}
            />
          </Section>
          <Section title="Migration per day">
            <Chart
              testId="migration-chart"
              x={series.xs()}
              series={[
                { label: "immigration", color: "#5fa8f0", values: series.channel(channel("immigration")) },
                { label: "emigration", color: "#f06fa0", values: series.channel(channel("emigration")) },
              ]}
            />
          </Section>
        </>
      )}
    </>
  );
}
