// Population of the selection, or of the realm when nothing is selected (specification §10, Panels): people, births
// and deaths, migrants in and out, and their history. The map shows population, with migration flows on request.
import { demographyOf } from "../../state/selectors";
import { useGame } from "../../state/store";
import { Chart } from "../Chart";
import { Checkbox, count, fmt, Section, Stat } from "../components";
import { shownAreas, usePublicView } from "./common";

const perDay = (value: number) => `${fmt(value)}/day`;

export function PopulationPanel() {
  const view = usePublicView();
  const selection = useGame((state) => state.selection);
  const edges = useGame((state) => state.edges);
  const history = useGame((state) => state.history);
  useGame((state) => state.historyVersion); // redraw the charts with every new sample
  const showMigration = useGame((state) => state.showMigration);
  const setShowMigration = useGame((state) => state.setShowMigration);
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
            value={`${net >= 0 ? "+" : ""}${perDay(net)}`}
            title="Births less deaths, plus immigration less emigration."
          />
          <Stat
            label="Births"
            value={perDay(now.births)}
            testId="births"
            title="People gained per day where necessities are met. Each area has one net rate: it grows where necessities are met and starves where they run short, never both at once."
          />
          <Stat
            label="Deaths"
            value={perDay(now.deaths)}
            testId="deaths"
            title="People lost per day to starvation, where necessities run short."
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
            title="People leaving per day for other areas, drawn by better wages and satisfaction."
          />
        </div>
        <Checkbox
          label="Show migration flows"
          title="Arrows on the map for the people moving between areas"
          checked={showMigration}
          onChange={setShowMigration}
        />
      </section>

      {series && series.length > 1 && (
        <>
          <Section title="Population">
            <Chart
              testId="population-chart"
              x={series.xs()}
              series={[{ label: "population", color: "#9d93ea", values: series.channel(0) }]}
              height={140}
            />
          </Section>
          <Section title="Per day">
            <Chart
              testId="demography-chart"
              x={series.xs()}
              series={[
                { label: "births", color: "#6fbf5a", values: series.channel(1) },
                { label: "deaths", color: "#ef5d5d", values: series.channel(2) },
                { label: "immigration", color: "#5fa8f0", values: series.channel(3) },
                { label: "emigration", color: "#f06fa0", values: series.channel(4) },
              ]}
            />
          </Section>
        </>
      )}
    </>
  );
}
