// The selected area: public figures, stocks and flows where visible, and the player's tools in own areas.
import { useState } from "react";
import { mapControls } from "../../map/MapView";
import { detailOf, priceOf } from "../../state/selectors";
import { useGame } from "../../state/store";
import { fmt, NumberField, pct, Section, Select, Stat, Swatch } from "../components";
import { areaName, goodOptions, type PanelProps, useSend, useView } from "./common";
import { PolicyEditor } from "./PolicyEditor";

export function AreaPanel({ onOpen }: PanelProps) {
  const view = useView();
  const area = useGame((state) => state.selectedArea);
  const table = useGame((state) => state.priceTable);
  const selectGood = useGame((state) => state.selectGood);
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
          <Stat label="Wage level" value={fmt(snapshot.areas.wageLevel[area] as number)} />
          <Stat label="Necessities met" value={pct(snapshot.areas.necessitySatisfaction[area] as number)} />
          <Stat label="Satisfaction" value={pct(snapshot.areas.satisfaction[area] as number)} />
          <Stat
            label="Port · airport · fort"
            value={`${snapshot.areas.portLevel[area]} · ${snapshot.areas.airportLevel[area]} · ${snapshot.areas.fortificationLevel[area]}`}
          />
          {detail && <Stat label="Savings" value={fmt(detail.savings)} />}
          {siege > 0 && <Stat label="Siege" value={pct(siege)} />}
        </div>
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

      {own && <OwnArea area={area} />}
    </>
  );
}

function OwnArea({ area }: { area: number }) {
  const view = useView();
  const send = useSend();
  const [soldiers, setSoldiers] = useState(100);
  const [order, setOrder] = useState({ good: 0, side: "buy" as "buy" | "sell", quantity: 100, limit: 1, perDay: 10 });
  if (!view) return null;
  const state = view.government.areaStates.find((s) => s.area === area);
  if (!state) return null;
  const { data } = view;
  const held = data.goods.filter((good) => (state.depot[good.id] as number) > 0.01);

  return (
    <>
      <Section title="Your area">
        <div className="row">
          <span>Wage offer</span>
          <NumberField
            label="Wage offer"
            value={state.wageOffer}
            min={0}
            onChange={(wageOffer) => send({ type: "setWageOffer", area, wageOffer })}
          />
          <span className="muted">mh per hour</span>
        </div>
        <div className="row">
          <NumberField label="Soldiers" value={soldiers} min={1} onChange={setSoldiers} />
          <button type="button" onClick={() => send({ type: "recruitArmy", area, soldiers })}>
            Recruit army
          </button>
        </div>
      </Section>

      <Section title="Depot">
        {held.length === 0 ? (
          <span className="muted">Empty</span>
        ) : (
          <table>
            <tbody>
              {held.map((good) => (
                <tr key={good.id}>
                  <td>{good.name}</td>
                  <td className="num">{fmt(state.depot[good.id] as number)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Section>

      <Section title="Market order">
        <div className="row">
          <Select
            label="Order side"
            value={order.side}
            options={[
              { value: "buy", label: "Buy" },
              { value: "sell", label: "Sell" },
            ]}
            onChange={(side) => setOrder({ ...order, side })}
          />
          <Select
            label="Order good"
            value={order.good}
            options={goodOptions(data, true)}
            onChange={(good) => setOrder({ ...order, good })}
          />
        </div>
        <div className="row">
          <NumberField
            label="Quantity"
            value={order.quantity}
            min={0}
            onChange={(quantity) => setOrder({ ...order, quantity })}
          />
          <NumberField
            label="Limit price"
            value={order.limit}
            min={0}
            onChange={(limit) => setOrder({ ...order, limit })}
          />
          <NumberField
            label="Per day"
            value={order.perDay}
            min={0}
            onChange={(perDay) => setOrder({ ...order, perDay })}
          />
          <button
            type="button"
            onClick={() =>
              send({
                type: "placeMarketOrder",
                order: {
                  area,
                  good: order.good,
                  side: order.side,
                  remainingQuantity: order.quantity,
                  limitPrice: order.limit,
                  maximumQuantityPerDay: order.perDay,
                },
              })
            }
          >
            Place
          </button>
        </div>
        <span className="muted">Quantity · limit price · units per day</span>
      </Section>

      <Section title={`Policies in ${areaName(data, area)}`}>
        <PolicyEditor
          settings={state.policyOverrides}
          onSet={(setting) => send({ type: "setAreaPolicy", area, setting })}
          onClear={(setting) => send({ type: "clearAreaPolicy", area, policy: setting.policy, good: setting.good })}
          resolvedHeadTax={state.resolved.headTaxPerPersonPerDay}
        />
      </Section>
    </>
  );
}
