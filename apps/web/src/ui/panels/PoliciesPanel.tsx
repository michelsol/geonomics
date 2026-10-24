// Taxes, tariffs and price controls, realm-wide or per area, and standing orders (specification §6), under the
// income, cost of living and savings of the areas they apply to. The map shows real income.
import { actionTarget, selectionSummary } from "../../state/selectors";
import { useGame } from "../../state/store";
import { fmt, Section, Stat } from "../components";
import { areaName, IncomeStats, useView } from "./common";
import { PolicyEditor } from "./PolicyEditor";
import { StandingOrders } from "./StandingOrders";

export function PoliciesPanel() {
  return (
    <>
      <TargetFigures />
      <Section title="Taxes and price controls">
        <PolicyEditor />
      </Section>
      <StandingOrders />
    </>
  );
}

/** What the people of the action target earn, what it buys, and what they hold. */
function TargetFigures() {
  const view = useView();
  const selection = useGame((state) => state.selection);
  const table = useGame((state) => state.priceTable);
  if (!view) return null;
  const { data, snapshot, government } = view;
  const target = actionTarget(government, selection);
  const summary = selectionSummary(data, snapshot, table, target.areas);
  const heading = target.realm
    ? "Your realm"
    : target.areas.length === 1
      ? areaName(data, target.areas[0] as number)
      : `${target.areas.length} areas`;
  return (
    <section className="section">
      <h2 data-testid="policy-target">{heading}</h2>
      <div className="stats">
        <IncomeStats
          summary={summary}
          hoursPerDay={data.config.economy.hoursPerWorkerDay}
          several={target.areas.length > 1}
          testIds="policy-"
        />
        <Stat
          label="Savings per person"
          value={`${fmt(summary.savings / Math.max(summary.detailPopulation, 1))} mh`}
          testId="policy-savings"
          title="Average private savings per inhabitant, in man-hours. Taxes are paid from them, and in kind when they run out."
        />
      </div>
    </section>
  );
}
