// Market orders, standing orders and depot transfers.
import type { StandingRule } from "@geonomics/sim";
import { useState } from "react";
import { useGame } from "../../state/store";
import { fmt, NumberField, Section, Select } from "../components";
import { AreaLink, goodOptions, ownedOptions, useSend, useView } from "./common";

type RuleKind = StandingRule["kind"];

const RULES: { value: RuleKind; label: string }[] = [
  { value: "keepDepotStock", label: "Keep depot stocked" },
  { value: "sellAbovePrice", label: "Sell above price" },
  { value: "buyBelowPrice", label: "Buy below price" },
  { value: "supplyArmies", label: "Supply armies" },
];

export function OrdersPanel() {
  const view = useView();
  const send = useSend();
  const selected = useGame((state) => state.selectedArea);
  const [rule, setRule] = useState({
    kind: "keepDepotStock" as RuleKind,
    good: 0,
    a: 10,
    b: 5,
    scope: "all" as "all" | "area",
  });
  const [transfer, setTransfer] = useState({ from: -1, to: -1, good: 0, quantity: 10 });
  if (!view) return null;
  const { data, government } = view;
  const goodName = (g: number) => data.goods[g]?.name ?? "?";
  const owned = ownedOptions(view);
  const from = transfer.from >= 0 ? transfer.from : (government.ownedAreas[0] ?? 0);
  const to = transfer.to >= 0 ? transfer.to : (government.ownedAreas[1] ?? government.ownedAreas[0] ?? 0);
  const scopeArea = selected !== null && government.ownedAreas.includes(selected) ? selected : government.capital;

  const buildRule = (): StandingRule => {
    switch (rule.kind) {
      case "keepDepotStock":
        return { kind: "keepDepotStock", good: rule.good, targetDaysOfDemand: rule.a, maximumBuyPrice: rule.b };
      case "sellAbovePrice":
        return { kind: "sellAbovePrice", good: rule.good, minimumPrice: rule.b, keepDaysOfDemand: rule.a };
      case "buyBelowPrice":
        return { kind: "buyBelowPrice", good: rule.good, maximumPrice: rule.b, maximumDepotQuantity: rule.a };
      case "supplyArmies":
        return { kind: "supplyArmies", good: rule.good, daysOfSupply: rule.a };
    }
  };
  const ruleLabels: Record<RuleKind, [string, string | null]> = {
    keepDepotStock: ["days of demand", "max price"],
    sellAbovePrice: ["days kept", "min price"],
    buyBelowPrice: ["max quantity", "max price"],
    supplyArmies: ["days of food", null],
  };
  const describeRule = (r: StandingRule) => {
    switch (r.kind) {
      case "keepDepotStock":
        return `Keep ${fmt(r.targetDaysOfDemand)} days of ${goodName(r.good)}, up to ${fmt(r.maximumBuyPrice)}`;
      case "sellAbovePrice":
        return `Sell ${goodName(r.good)} above ${fmt(r.minimumPrice)}, keep ${fmt(r.keepDaysOfDemand)} days`;
      case "buyBelowPrice":
        return `Buy ${goodName(r.good)} below ${fmt(r.maximumPrice)}, up to ${fmt(r.maximumDepotQuantity)}`;
      case "supplyArmies":
        return `Supply armies with ${fmt(r.daysOfSupply)} days of ${goodName(r.good)}`;
    }
  };

  return (
    <>
      <Section title="Market orders">
        {government.marketOrders.length === 0 && (
          <span className="muted">None. Place orders from an area you own.</span>
        )}
        {government.marketOrders.map((order) => (
          <div className="list-item" key={order.id}>
            <div className="row" style={{ justifyContent: "space-between" }}>
              <span>
                {order.side === "buy" ? "Buy" : "Sell"} {fmt(order.remainingQuantity)} {goodName(order.good)} in{" "}
                <AreaLink area={order.area} />
              </span>
              <button type="button" onClick={() => send({ type: "cancelMarketOrder", orderId: order.id })}>
                Cancel
              </button>
            </div>
            <span className="muted">
              limit {fmt(order.limitPrice)} · {fmt(order.maximumQuantityPerDay)} per day
            </span>
          </div>
        ))}
      </Section>

      <Section title="Standing orders">
        {government.standingOrders.map((order) => (
          <div className="list-item" key={order.id}>
            <div className="row" style={{ justifyContent: "space-between" }}>
              <span>{describeRule(order.rule)}</span>
              <button type="button" onClick={() => send({ type: "removeStandingOrder", orderId: order.id })}>
                Remove
              </button>
            </div>
            <span className="muted">
              {order.areas === "all" ? "in every area" : order.areas.map((a) => data.areas[a]?.name).join(", ")}
            </span>
          </div>
        ))}
        <div className="row">
          <Select label="Rule" value={rule.kind} options={RULES} onChange={(kind) => setRule({ ...rule, kind })} />
          <Select
            label="Rule good"
            value={rule.good}
            options={goodOptions(data, true)}
            onChange={(good) => setRule({ ...rule, good })}
          />
        </div>
        <div className="row">
          <NumberField
            label={ruleLabels[rule.kind][0]}
            value={rule.a}
            min={0}
            onChange={(a) => setRule({ ...rule, a })}
          />
          {ruleLabels[rule.kind][1] && (
            <NumberField
              label={ruleLabels[rule.kind][1] as string}
              value={rule.b}
              min={0}
              onChange={(b) => setRule({ ...rule, b })}
            />
          )}
          <Select
            label="Rule scope"
            value={rule.scope}
            options={[
              { value: "all", label: "All areas" },
              { value: "area", label: scopeArea === null ? "This area" : `${data.areas[scopeArea]?.name} only` },
            ]}
            onChange={(scope) => setRule({ ...rule, scope })}
          />
          <button
            type="button"
            onClick={() =>
              send({
                type: "addStandingOrder",
                order: { areas: rule.scope === "all" || scopeArea === null ? "all" : [scopeArea], rule: buildRule() },
              })
            }
          >
            Add
          </button>
        </div>
        <span className="muted">
          {ruleLabels[rule.kind][0]}
          {ruleLabels[rule.kind][1] ? ` · ${ruleLabels[rule.kind][1]}` : ""}
        </span>
      </Section>

      <Section title="Depot transfers">
        {government.depotTransfers.map((t) => (
          <div className="list-item" key={`${t.destination}-${t.good}-${t.daysRemaining}`}>
            {fmt(t.quantity)} {goodName(t.good)} to <AreaLink area={t.destination} /> in{" "}
            {fmt(Math.max(0, t.daysRemaining))} days
          </div>
        ))}
        {owned.length > 1 ? (
          <>
            <div className="row">
              <Select
                label="From"
                value={from}
                options={owned}
                onChange={(value) => setTransfer({ ...transfer, from: value })}
              />
              <span>→</span>
              <Select
                label="To"
                value={to}
                options={owned}
                onChange={(value) => setTransfer({ ...transfer, to: value })}
              />
            </div>
            <div className="row">
              <Select
                label="Transfer good"
                value={transfer.good}
                options={goodOptions(data, true)}
                onChange={(good) => setTransfer({ ...transfer, good })}
              />
              <NumberField
                label="Transfer quantity"
                value={transfer.quantity}
                min={0}
                onChange={(quantity) => setTransfer({ ...transfer, quantity })}
              />
              <button
                type="button"
                onClick={() =>
                  send({ type: "transferGoods", from, to, good: transfer.good, quantity: transfer.quantity })
                }
              >
                Send
              </button>
            </div>
          </>
        ) : (
          <span className="muted">Transfers need two areas.</span>
        )}
      </Section>
    </>
  );
}
