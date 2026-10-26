// What people of the selection, or of the realm when nothing is selected, could buy of what they need
// (specification §9, Panels): necessities met and satisfaction with their history, each need, and each consumer
// group. The map shows necessities met.
import { consumerGroupsOf, DEMOGRAPHY_KEYS, demographyOf, needsOf } from "../../state/selectors";
import { useGame } from "../../state/store";
import { Chart } from "../Chart";
import { fmt, pct, Section, Stat } from "../components";
import { groupName, shownAreas, usePublicView } from "./common";

const TIERS = { necessity: "Necessity", comfort: "Comfort", luxury: "Luxury" } as const;
const capitalized = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

export function NeedsPanel() {
  const view = usePublicView();
  const selection = useGame((state) => state.selection);
  const edges = useGame((state) => state.edges);
  const history = useGame((state) => state.history);
  useGame((state) => state.historyVersion); // redraw the chart with every new sample
  if (!view) return <p className="muted">Waiting for the first snapshot…</p>;
  const { data, snapshot, government } = view;
  const { areas, heading } = shownAreas(data, government, selection);
  const now = demographyOf(snapshot, edges, areas);
  const needs = needsOf(data, snapshot, areas);
  const series = history?.demographyOf(selection);
  const percent = (values: number[]) => values.map((value) => 100 * value);
  const people = Math.max(needs.detailPopulation, 1);
  const groups = consumerGroupsOf(snapshot, areas);
  const groupPeople = Math.max(
    groups.reduce((sum, group) => sum + group.people, 0),
    1,
  );

  return (
    <>
      <section className="section">
        <h2 data-testid="needs-of">{heading}</h2>
        <div className="stats">
          <Stat
            label="Necessities met"
            value={pct(now.necessitySatisfaction)}
            testId="necessities-met"
            title="Share of the need for necessities (food and the like) that people could buy. People lacking necessities die, so a full area settles where deaths match births."
          />
          <Stat
            label="Satisfaction"
            value={pct(now.satisfaction)}
            title="Share of every need, comforts and luxuries included, that people could buy. Together with incomes, it draws migrants."
          />
        </div>
      </section>

      <Section title="Needs">
        {needs.withDetail === 0 ? (
          <span className="muted">
            Only your areas and their neighbors are seen in detail: select some to see their needs one by one.
          </span>
        ) : (
          <>
            <table data-testid="needs">
              <thead>
                <tr>
                  <th>Need</th>
                  <th>Tier</th>
                  <th className="num" title="Need units one person wanted per day, at the prices of the day">
                    Wanted
                  </th>
                  <th className="num" title="Share of what people wanted that they could buy">
                    Met
                  </th>
                </tr>
              </thead>
              <tbody>
                {data.needs.map((need) => {
                  const row = needs.rows[need.id];
                  if (!row) return null;
                  return (
                    <tr key={need.id}>
                      <td>{need.name}</td>
                      <td className="muted">{TIERS[need.tier]}</td>
                      <td className="num" title={`${need.unit} per person and day`}>
                        {fmt(row.demanded / people)}
                      </td>
                      <td className="num">{row.demanded > 0 ? pct(row.consumed / row.demanded) : "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {needs.withDetail < areas.length && (
              <span className="muted">
                Over the {needs.withDetail} of {areas.length} areas seen in detail.
              </span>
            )}
          </>
        )}
      </Section>

      <Section
        title="Consumer groups"
        hint="Workers by the wage band of their job, and the unemployed, each with their dependents. Each group buys with its own income, and dies of its own shortfall."
      >
        <table data-testid="consumer-groups">
          <thead>
            <tr>
              <th>Group</th>
              <th className="num" title="Share of the people: the group's workers and their dependents">
                People
              </th>
              <th className="num" title="Share of the group's need for necessities that it could buy">
                Necessities met
              </th>
            </tr>
          </thead>
          <tbody>
            {groups.map((group, index) => (
              <tr key={groupName(index)}>
                <td>{capitalized(groupName(index))}</td>
                <td className="num">{pct(group.people / groupPeople)}</td>
                <td className="num">{Number.isNaN(group.necessitiesMet) ? "—" : pct(group.necessitiesMet)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>

      {series && series.length > 1 && (
        <Section title="History">
          <Chart
            testId="needs-chart"
            x={series.xs()}
            series={[
              {
                label: "necessities met (%)",
                color: "#6fbf5a",
                values: percent(series.channel(DEMOGRAPHY_KEYS.indexOf("necessitySatisfaction"))),
              },
              {
                label: "satisfaction (%)",
                color: "#e8d85a",
                values: percent(series.channel(DEMOGRAPHY_KEYS.indexOf("satisfaction"))),
              },
            ]}
          />
        </Section>
      )}
    </>
  );
}
