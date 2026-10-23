// Standing orders: automation rules that buy and sell on the realm's markets every tick (specification §6).
import type { StandingRule } from "@geonomics/sim";
import { useState } from "react";
import { useGame } from "../../state/store";
import { fmt, NumberField, Section, Select } from "../components";
import { goodOptions, useSend, useView } from "./common";

type RuleKind = StandingRule["kind"];

const RULES: { value: RuleKind; label: string }[] = [
  { value: "keepDepotStock", label: "Keep depot stocked" },
  { value: "sellAbovePrice", label: "Sell above price" },
  { value: "buyBelowPrice", label: "Buy below price" },
];

const RULE_LABELS: Record<RuleKind, [string, string | null]> = {
  keepDepotStock: ["days of demand", "max price"],
  sellAbovePrice: ["days kept", "min price"],
  buyBelowPrice: ["max quantity", "max price"],
};

export function StandingOrders() {
  const view = useView();
  const send = useSend();
  const selected = useGame((state) => state.selectedArea);
  const selection = useGame((state) => state.selection);
  const [rule, setRule] = useState({
    kind: "keepDepotStock" as RuleKind,
    good: 0,
    a: 10,
    b: 5,
    scope: "all" as "all" | "area" | "selection",
  });
  if (!view) return null;
  const { data, government } = view;
  const goodName = (g: number) => data.goods[g]?.name ?? "?";
  const scopeArea = selected !== null && government.ownedAreas.includes(selected) ? selected : government.capital;
  const ownSelected = selection.filter((a) => government.ownedAreas.includes(a));
  const scope = rule.scope === "selection" && ownSelected.length < 2 ? "area" : rule.scope;
  const ruleAreas = (): number[] | "all" =>
    scope === "all" || scopeArea === null ? "all" : scope === "selection" ? ownSelected : [scopeArea];

  const buildRule = (): StandingRule => {
    switch (rule.kind) {
      case "keepDepotStock":
        return { kind: "keepDepotStock", good: rule.good, targetDaysOfDemand: rule.a, maximumBuyPrice: rule.b };
      case "sellAbovePrice":
        return { kind: "sellAbovePrice", good: rule.good, minimumPrice: rule.b, keepDaysOfDemand: rule.a };
      case "buyBelowPrice":
        return { kind: "buyBelowPrice", good: rule.good, maximumPrice: rule.b, maximumDepotQuantity: rule.a };
    }
  };
  const describeRule = (r: StandingRule) => {
    switch (r.kind) {
      case "keepDepotStock":
        return `Keep ${fmt(r.targetDaysOfDemand)} days of ${goodName(r.good)}, up to ${fmt(r.maximumBuyPrice)}`;
      case "sellAbovePrice":
        return `Sell ${goodName(r.good)} above ${fmt(r.minimumPrice)}, keep ${fmt(r.keepDaysOfDemand)} days`;
      case "buyBelowPrice":
        return `Buy ${goodName(r.good)} below ${fmt(r.maximumPrice)}, up to ${fmt(r.maximumDepotQuantity)}`;
    }
  };

  return (
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
          label={RULE_LABELS[rule.kind][0]}
          value={rule.a}
          min={0}
          onChange={(a) => setRule({ ...rule, a })}
        />
        {RULE_LABELS[rule.kind][1] && (
          <NumberField
            label={RULE_LABELS[rule.kind][1] as string}
            value={rule.b}
            min={0}
            onChange={(b) => setRule({ ...rule, b })}
          />
        )}
        <Select
          label="Rule scope"
          value={scope}
          options={[
            { value: "all", label: "All areas" },
            ...(ownSelected.length >= 2
              ? [{ value: "selection" as const, label: `Selection (${ownSelected.length} areas)` }]
              : []),
            { value: "area", label: scopeArea === null ? "This area" : `${data.areas[scopeArea]?.name} only` },
          ]}
          onChange={(scope) => setRule({ ...rule, scope })}
        />
        <button
          type="button"
          onClick={() =>
            send({
              type: "addStandingOrder",
              order: { areas: ruleAreas(), rule: buildRule() },
            })
          }
        >
          Add
        </button>
      </div>
      <span className="muted">
        {RULE_LABELS[rule.kind][0]}
        {RULE_LABELS[rule.kind][1] ? ` · ${RULE_LABELS[rule.kind][1]}` : ""}
      </span>
    </Section>
  );
}
