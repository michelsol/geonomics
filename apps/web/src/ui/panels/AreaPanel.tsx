// The selected area: public figures, history, resources, defense, and stocks and flows where visible.
import { mapControls } from "../../map/MapView";
import { capacityMaximum, conquestEstimate, detailOf, priceOf } from "../../state/selectors";
import { useGame } from "../../state/store";
import { Chart } from "../Chart";
import { fmt, pct, Section, Stat, Swatch } from "../components";
import { type PanelProps, useView } from "./common";

const WAGE_HINT = "Mean value added per private worker-hour, weighted by workers, in man-hours (not a median).";

export function AreaPanel({ onOpen }: PanelProps) {
  const view = useView();
  const area = useGame((state) => state.selectedArea);
  const table = useGame((state) => state.priceTable);
  const selectGood = useGame((state) => state.selectGood);
  const history = useGame((state) => state.history);
  useGame((state) => state.historyVersion); // redraw the charts with every new sample
  if (!view) return <p className="muted">Waiting for the first snapshot…</p>;
  if (area === null) return <p className="muted">Click an area on the map.</p>;
  const { data, snapshot, government } = view;
  const static_ = data.areas[area];
  if (!static_) return null;
  const owner = snapshot.areas.owner[area] as number;
  const ownerSummary = owner >= 0 ? snapshot.governments[owner] : undefined;
  const own = owner === government.id;
  const detail = detailOf(snapshot, area);
  const siege = snapshot.areas.siegeProgress[area] as number;
  const stats = history?.areaStats.get(area);
  const days = data.config.pace.gameDaysPerTick;
  const resources = data.goods.filter((good) => good.isPrimary && capacityMaximum(data, area, good.id) > 0);
  const headTax = government.areaStates.find((s) => s.area === area)?.resolved.headTaxPerPersonPerDay;

  return (
    <>
      <Section
        title="Area"
        actions={
          <button type="button" onClick={() => mapControls.renderer?.centerOn(area)}>
            Center
          </button>
        }
      >
        <h2 data-testid="area-name">{static_.name}</h2>
        <div className="muted">
          {ownerSummary ? (
            <>
              <Swatch color={ownerSummary.color} />
              {ownerSummary.name}
              {own ? " (you)" : ""}
            </>
          ) : (
            "Neutral"
          )}{" "}
          · {static_.terrain}
          {static_.isCoastal ? " · coast" : ""}
        </div>
        <div className="stats">
          <Stat label="Population" value={fmt(snapshot.areas.population[area] as number)} />
          <Stat label="Average wage" value={fmt(snapshot.areas.wageLevel[area] as number)} />
          <Stat label="Necessities met" value={pct(snapshot.areas.necessitySatisfaction[area] as number)} />
          <Stat label="Satisfaction" value={pct(snapshot.areas.satisfaction[area] as number)} />
          <Stat
            label="Port · airport · fort"
            value={`${snapshot.areas.portLevel[area]} · ${snapshot.areas.airportLevel[area]} · ${snapshot.areas.fortificationLevel[area]}`}
          />
          {detail && <Stat label="Savings" value={fmt(detail.savings)} />}
          {detail && <Stat label="Unemployed" value={fmt(detail.unemployedWorkers)} />}
          {siege > 0 && <Stat label="Siege" value={pct(siege)} />}
        </div>
        <p className="hint">Average wage: {WAGE_HINT}</p>
        {own && headTax !== undefined && (
          <div className="row hint">
            Head tax here: {fmt(headTax)} mh per person per day.
            <button type="button" className="link" onClick={() => onOpen("government")}>
              Taxes are set in Realm
            </button>
          </div>
        )}
      </Section>

      {stats && stats.length > 1 && (
        <Section title="History">
          <p className="chart-caption">Population</p>
          <Chart
            x={stats.xs()}
            height={140}
            testId="area-population-chart"
            series={[{ label: "population", color: "#3987e5", values: stats.channel(0) }]}
          />
          <p className="chart-caption">Average wage (mh per hour)</p>
          <Chart
            x={stats.xs()}
            height={140}
            series={[{ label: "average wage", color: "#3987e5", values: stats.channel(1) }]}
          />
        </Section>
      )}

      {!own && <Defense area={area} />}

      <Section title="Natural resources">
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
                {detail && (
                  <>
                    <th className="num" title="Capacity left after depletion">
                      Now
                    </th>
                    <th className="num">Extracted</th>
                    <th className="num">Use</th>
                  </>
                )}
              </tr>
            </thead>
            <tbody>
              {resources.map((good) => {
                const maximum = capacityMaximum(data, area, good.id);
                const now = detail ? (detail.naturalCapacity[good.id] as number) : maximum;
                const extracted = detail ? (detail.produced[good.id] as number) / days : 0;
                return (
                  <tr key={good.id}>
                    <td title={good.unit}>{good.name}</td>
                    <td className="num">{fmt(maximum)}</td>
                    {detail && (
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
        <span className="hint">Units per day. See a good across the map with the Resources layer.</span>
      </Section>

      <Section title={detail ? "Market" : "Prices"}>
        <table>
          <thead>
            <tr>
              <th>Good</th>
              <th className="num">Price</th>
              {detail && (
                <>
                  <th className="num">Stock</th>
                  <th className="num">Made</th>
                  <th className="num">Used</th>
                  <th className="num">Trade</th>
                </>
              )}
            </tr>
          </thead>
          <tbody>
            {data.goods.map((good) => {
              const price = detail
                ? (detail.price[good.id] as number)
                : table
                  ? priceOf(data, table, area, good.id)
                  : 0;
              return (
                <tr key={good.id}>
                  <td>
                    <button
                      type="button"
                      className="link"
                      onClick={() => {
                        selectGood(good.id);
                        onOpen("good");
                      }}
                    >
                      {good.name}
                    </button>
                  </td>
                  <td className="num" title={`labor value ${fmt(good.laborValue)}`}>
                    {fmt(price)}
                  </td>
                  {detail && (
                    <>
                      <td className="num">{good.isService ? "—" : fmt(detail.stock[good.id] as number)}</td>
                      <td className="num">{fmt(detail.produced[good.id] as number)}</td>
                      <td className="num">{fmt(detail.consumed[good.id] as number)}</td>
                      <td className="num">
                        {fmt((detail.imported[good.id] as number) - (detail.exported[good.id] as number))}
                      </td>
                    </>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </Section>
    </>
  );
}

/** Defenders of an area that is not the player's, and the force it takes to win. */
function Defense({ area }: { area: number }) {
  const view = useView();
  if (!view) return null;
  const estimate = conquestEstimate(view.data, view.snapshot, area);
  const neutral = (view.snapshot.areas.owner[area] as number) < 0;
  return (
    <Section title="Defense">
      <div className="stats">
        {neutral && <Stat label="Militia" value={fmt(estimate.militia)} testId="militia" />}
        {!neutral && <Stat label="Army power here" value={fmt(estimate.armyPower)} />}
        <Stat label="Fortification" value={`×${1 + estimate.fortification}`} />
        <Stat label="Defense power" value={fmt(estimate.defensePower)} />
      </div>
      {estimate.defensePower > 0 ? (
        <p data-testid="soldiers-needed">
          Win with more than <strong>{fmt(Math.ceil(estimate.equippedNeeded))}</strong> equipped soldiers, or{" "}
          {fmt(Math.ceil(estimate.unequippedNeeded))} without weapons. Bring a margin: the battle costs soldiers.
        </p>
      ) : (
        <p>No defenders: an attacking army besieges it at once.</p>
      )}
      <p className="hint">
        Then the siege takes about {fmt(estimate.siegeDaysPer1000Equipped)} days with 1,000 equipped soldiers (twice as
        long with half as many).
        {neutral
          ? ` The militia is ${pct(view.data.config.military.militiaShare)} of the population, unequipped; it refills while no attacker is present.`
          : ""}
      </p>
    </Section>
  );
}
