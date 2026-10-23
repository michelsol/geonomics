// One good across the world, at the bottom of the Area panel: lowest, median and highest price with their areas,
// and their history.
import { meanPrices, priceExtremes } from "../../state/selectors";
import { useGame } from "../../state/store";
import { Chart } from "../Chart";
import { fmt, Section, Select } from "../components";
import { AreaLink, areaName, goodOptions, usePublicView } from "./common";

export function GoodSection() {
  const view = usePublicView();
  const good = useGame((state) => state.selectedGood);
  const table = useGame((state) => state.priceTable);
  const history = useGame((state) => state.history);
  const selection = useGame((state) => state.selection);
  useGame((state) => state.historyVersion); // redraw the chart with every new sample
  const selectGood = useGame((state) => state.selectGood);
  const setLayer = useGame((state) => state.setLayer);
  if (!view) return null;
  const { data } = view;
  const info = data.goods[good];
  if (!info) return null;
  const extremes = table ? priceExtremes(data, table, good) : null;
  const world = history?.goodPrices[good];
  const local = selection.length === 0 ? undefined : history?.pricesOf(selection);
  // The selected area, or the mean over several.
  const selectedLabel =
    selection.length === 1 ? areaName(data, selection[0] as number) : `${selection.length} areas (mean)`;

  return (
    <div className="section" id="good-section">
      <Section title="Good">
        <div className="row">
          <Select label="Good" value={good} options={goodOptions(data)} onChange={selectGood} />
          <button type="button" onClick={() => setLayer("prices")}>
            Show on map
          </button>
        </div>
        <div className="muted">
          {info.isService ? "Service" : info.isPrimary ? "Primary good" : "Crafted good"} · labor value{" "}
          {fmt(info.laborValue)} mh per {info.unit}
        </div>
      </Section>

      {extremes && (
        <Section title="Prices across the world">
          <table>
            <tbody>
              {(["low", "median", "high"] as const).map((key) => (
                <tr key={key}>
                  <td>{key === "low" ? "Lowest" : key === "median" ? "Median" : "Highest"}</td>
                  <td className="num" data-testid={`price-${key}`}>
                    {fmt(extremes[key].price)}
                  </td>
                  <td>
                    <AreaLink area={extremes[key].area} />
                  </td>
                </tr>
              ))}
              {selection.length > 0 && table && (
                <tr>
                  <td>{selectedLabel}</td>
                  <td className="num">{fmt(meanPrices(data, table, selection)[good] as number)}</td>
                  <td className="muted">selected</td>
                </tr>
              )}
            </tbody>
          </table>
        </Section>
      )}

      {world && world.length > 1 && (
        <Section title="History">
          <Chart
            testId="good-chart"
            x={world.xs()}
            series={[
              { label: "lowest", color: "#5fa8f0", values: world.channel(0) },
              { label: "median", color: "#e6ebf2", values: world.channel(1) },
              { label: "highest", color: "#ef5d5d", values: world.channel(2) },
              ...(local && local.length > 1
                ? [
                    {
                      label: selectedLabel,
                      color: "#ffd54a",
                      values: alignTo(world.xs(), local.xs(), local.channel(good)),
                      dash: [4, 4],
                    },
                  ]
                : []),
            ]}
          />
        </Section>
      )}
    </div>
  );
}

/** Values of a series sampled at other x positions, null where it has no sample. */
function alignTo(xs: number[], sourceX: number[], values: number[]): number[] {
  const byX = new Map(sourceX.map((x, i) => [x, values[i] as number]));
  return xs.map((x) => byX.get(x) ?? (null as unknown as number));
}
