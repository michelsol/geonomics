// Population of the selection, or of the realm when nothing is selected (specification §10, Panels): people, births
// & deaths, migrants in and out, and their history. The map shows population, with migration flows on request.
import { demographyOf } from "../../state/selectors";
import { useGame } from "../../state/store";
import { Chart } from "../Chart";
import { Checkbox, count, fmt, Section, Stat } from "../components";
import { shownAreas, usePublicView } from "./common";

const perDay = (value: number) => `${fmt(value)}/day`;
const signedPerDay = (value: number) => `${value > 0 ? "+" : ""}${perDay(value)}`;

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
  const net = now.naturalChange + now.immigration - now.emigration;

  return (
    <>
      <section className="section">
        <h2 data-testid="population-of">{heading}</h2>
        <div className="stats">
          <Stat label="Population" value={count(now.population)} testId="population-total" />
          <Stat label="Change" value={signedPerDay(net)} title="Births & deaths, plus immigration less emigration." />
          <Stat
            label="Births & deaths"
            value={signedPerDay(now.naturalChange)}
            testId="births-deaths"
            title="People gained per day where necessities are met, less those lost to starvation where they run short. The model keeps one net rate per area, not births and deaths apart."
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
                { label: "births & deaths", color: "#6fbf5a", values: series.channel(1) },
                { label: "immigration", color: "#5fa8f0", values: series.channel(2) },
                { label: "emigration", color: "#f06fa0", values: series.channel(3) },
              ]}
            />
          </Section>
        </>
      )}
    </>
  );
}
