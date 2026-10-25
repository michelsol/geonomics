// Natural resources (specification §9, Panels): what the selected areas can extract, and where one resource is
// found. The map shows that resource's capacity.
import { capacityMaximum, selectionSummary } from "../../state/selectors";
import { useGame } from "../../state/store";
import { fmt, pct, Section, Select } from "../components";
import { AreaLink, goodOptions, usePublicView } from "./common";

const RICHEST = 5;

export function ResourcesPanel() {
  const view = usePublicView();
  const selection = useGame((state) => state.selection);
  const resource = useGame((state) => state.selectedResource);
  const selectResource = useGame((state) => state.selectResource);
  if (!view) return <p className="muted">Waiting for the first snapshot…</p>;
  const { data, snapshot } = view;
  const info = data.goods[resource];
  const richest = data.areas
    .map((_, area) => ({ area, capacity: capacityMaximum(data, snapshot, area, resource) }))
    .filter((row) => row.capacity > 0)
    .sort((a, b) => b.capacity - a.capacity || a.area - b.area)
    .slice(0, RICHEST);

  return (
    <>
      <Section title="Resource">
        <Select
          label="Resource"
          value={resource}
          options={goodOptions(data, (good) => good.isPrimary)}
          onChange={selectResource}
        />
        {info && (
          <div className="muted">
            Capacity in {info.unit} per day
            {info.depletionPerUnitExtracted > 0 ? "; extraction depletes it, and it recovers slowly" : "; renewable"}
            {info.terrains.some((t) => t === "sea" || t === "offshore") &&
              `. Found at sea${info.terrains.includes("offshore") && !info.terrains.includes("sea") ? " beyond the waters along the coast" : ""}: an area works the water cells its port reaches, shared with the other ports reaching them`}
          </div>
        )}
        {richest.length === 0 ? (
          <span className="muted">Found nowhere on this map.</span>
        ) : (
          <table data-testid="richest">
            <thead>
              <tr>
                <th>Most on the map</th>
                <th className="num">Capacity</th>
              </tr>
            </thead>
            <tbody>
              {richest.map((row) => (
                <tr key={row.area}>
                  <td>
                    <AreaLink area={row.area} />
                  </td>
                  <td className="num">{fmt(row.capacity)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Section>
      {selection.length === 0 ? (
        <p className="muted">Select areas to see what they can extract.</p>
      ) : (
        <SelectionResources areas={selection} />
      )}
    </>
  );
}

/** What the selected areas can extract; clicking a resource shows it on the map. */
function SelectionResources({ areas }: { areas: readonly number[] }) {
  const view = usePublicView();
  const table = useGame((state) => state.priceTable);
  const resource = useGame((state) => state.selectedResource);
  const selectResource = useGame((state) => state.selectResource);
  if (!view) return null;
  const { data, snapshot } = view;
  const primary = data.goods.filter((good) => good.isPrimary);
  const summary = selectionSummary(data, snapshot, table, areas);
  const coverage =
    summary.withDetail < areas.length ? ` Over the ${summary.withDetail} of ${areas.length} areas seen in detail.` : "";
  const resources = primary.filter((good) => (summary.capacity[good.id] as number) > 0);
  return (
    <Section title={areas.length === 1 ? "Natural resources" : `Natural resources (${areas.length} areas)`}>
      {resources.length === 0 ? (
        <span className="muted">None: every primary good must be brought in.</span>
      ) : (
        <table data-testid="resources">
          <thead>
            <tr>
              <th>Good</th>
              <th className="num" title="Largest extraction per day, before depletion">
                Capacity
              </th>
              {summary.withDetail > 0 && (
                <>
                  <th className="num" title={`Capacity left after depletion.${coverage}`}>
                    Now
                  </th>
                  <th className="num" title={`Units extracted per day.${coverage}`}>
                    Extracted
                  </th>
                  <th className="num" title="Extracted over the capacity left">
                    Use
                  </th>
                </>
              )}
            </tr>
          </thead>
          <tbody>
            {resources.map((good) => {
              const now = summary.capacityNow[good.id] as number;
              const extracted = summary.extracted[good.id] as number;
              return (
                <tr key={good.id} className={good.id === resource ? "chosen" : undefined}>
                  <td title={good.unit}>
                    <button type="button" className="link" onClick={() => selectResource(good.id)}>
                      {good.name}
                    </button>
                  </td>
                  <td className="num">{fmt(summary.capacity[good.id] as number)}</td>
                  {summary.withDetail > 0 && (
                    <>
                      <td className="num">{fmt(now)}</td>
                      <td className="num">{fmt(extracted)}</td>
                      <td className="num">{now > 0 ? pct(extracted / now) : "—"}</td>
                    </>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </Section>
  );
}
