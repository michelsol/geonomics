// Taxes and price controls: realm-wide settings and per-area overrides, each for one good or every good.
import type { PolicyName, PolicySetting } from "@geonomics/sim";
import { useEffect, useState } from "react";
import { useGame } from "../../state/store";
import { fmt, NumberField, Select } from "../components";
import { areaName, useSend, useView } from "./common";

const POLICIES: { value: PolicyName; label: string; rate: boolean }[] = [
  { value: "productionTaxRate", label: "Production tax", rate: true },
  { value: "consumptionTaxRate", label: "Consumption tax", rate: true },
  { value: "importTariffRate", label: "Import tariff", rate: true },
  { value: "exportTariffRate", label: "Export tariff", rate: true },
  { value: "headTaxPerPersonPerDay", label: "Head tax", rate: false },
  { value: "priceCeiling", label: "Price ceiling", rate: false },
  { value: "priceFloor", label: "Price floor", rate: false },
];

const ALL = -1; // "All areas" or "All goods" in the selects

/** Slider range of the policies that have one: rates in percent, head tax in man-hours per person per day. */
const SLIDERS: Partial<Record<PolicyName, { min: number; max: number; step: number }>> = {
  productionTaxRate: { min: -100, max: 100, step: 1 },
  consumptionTaxRate: { min: -100, max: 100, step: 1 },
  importTariffRate: { min: -100, max: 100, step: 1 },
  exportTariffRate: { min: -100, max: 100, step: 1 },
  headTaxPerPersonPerDay: { min: 0, max: 2, step: 0.01 },
};

const policyLabel = (policy: PolicyName) => POLICIES.find((p) => p.value === policy)?.label ?? policy;
const isRate = (policy: PolicyName) => POLICIES.find((p) => p.value === policy)?.rate ?? false;

export function PolicyEditor() {
  const view = useView();
  const send = useSend();
  const selected = useGame((state) => state.selectedArea);
  const [policy, setPolicy] = useState<PolicyName>("productionTaxRate");
  const [scope, setScope] = useState<number | null>(null); // null: all areas until one is picked
  const [good, setGood] = useState(ALL);
  const [value, setValue] = useState(0); // as shown: percent for rates, man-hours otherwise
  const owned = view?.government.ownedAreas ?? [];
  const area = scope ?? ALL;
  const target = area !== ALL && owned.includes(area) ? area : ALL;
  const perGood = policy !== "headTaxPerPersonPerDay";
  const settingGood = perGood && good !== ALL ? good : null;
  // The setting in force for exactly this scope, policy and good, so the slider starts at the current level.
  const settings =
    target === ALL
      ? view?.government.realmPolicies
      : view?.government.areaStates.find((s) => s.area === target)?.policyOverrides;
  const current = settings?.find((s) => s.policy === policy && s.good === settingGood)?.value ?? 0;
  const shown = isRate(policy) ? Math.round(100 * current * 100) / 100 : current;
  // biome-ignore lint/correctness/useExhaustiveDependencies: refills only when the scope changes, not on every snapshot
  useEffect(() => setValue(shown), [policy, target, settingGood]);
  if (!view) return null;
  const { data, government } = view;
  const slider = SLIDERS[policy];
  const goodName = (g: number | null) => (g === null ? "all goods" : (data.goods[g]?.name ?? "?"));
  const show = (s: PolicySetting) =>
    s.value === null ? "none" : isRate(s.policy) ? `${fmt(100 * s.value)}%` : `${fmt(s.value)} mh`;
  const labelOf = (s: PolicySetting) =>
    s.policy === "headTaxPerPersonPerDay" ? policyLabel(s.policy) : `${policyLabel(s.policy)} · ${goodName(s.good)}`;

  const realmHeadTax = government.realmPolicies.find((s) => s.policy === "headTaxPerPersonPerDay")?.value ?? 0;
  const headTax =
    target === ALL
      ? realmHeadTax
      : (government.areaStates.find((s) => s.area === target)?.resolved.headTaxPerPersonPerDay ?? 0);
  const overrides = government.areaStates.filter((s) => s.policyOverrides.length > 0);

  const setting = (): PolicySetting => ({ policy, good: settingGood, value: isRate(policy) ? value / 100 : value });
  const apply = () =>
    send(
      target === ALL
        ? { type: "setRealmPolicy", setting: setting() }
        : { type: "setAreaPolicy", area: target, setting: setting() },
    );

  return (
    <div className="section">
      <table data-testid="policies">
        <tbody>
          <tr>
            <th colSpan={3}>Every area</th>
          </tr>
          {government.realmPolicies.length === 0 && (
            <tr>
              <td colSpan={3} className="muted">
                No realm-wide tax or price control.
              </td>
            </tr>
          )}
          {government.realmPolicies.map((s) => (
            <tr key={`realm-${s.policy}-${s.good}`}>
              <td>{labelOf(s)}</td>
              <td className="num">{show(s)}</td>
              <td className="num">
                <button
                  type="button"
                  aria-label={`Remove ${labelOf(s)}`}
                  onClick={() => send({ type: "setRealmPolicy", setting: { ...s, value: null } })}
                >
                  ✕
                </button>
              </td>
            </tr>
          ))}
          {overrides.map((state) => [
            <tr key={`head-${state.area}`}>
              <th colSpan={3}>Only in {areaName(data, state.area)}</th>
            </tr>,
            ...state.policyOverrides.map((s) => (
              <tr key={`${state.area}-${s.policy}-${s.good}`}>
                <td>{labelOf(s)}</td>
                <td className="num">{show(s)}</td>
                <td className="num">
                  <button
                    type="button"
                    aria-label={`Remove ${labelOf(s)} in ${areaName(data, state.area)}`}
                    onClick={() => send({ type: "clearAreaPolicy", area: state.area, policy: s.policy, good: s.good })}
                  >
                    ✕
                  </button>
                </td>
              </tr>
            )),
          ])}
        </tbody>
      </table>

      <div className="row">
        <Select
          label="Policy area"
          value={target}
          options={[
            { value: ALL, label: "All areas" },
            ...owned.map((id) => ({ value: id, label: areaName(data, id) })),
          ]}
          onChange={setScope}
        />
        {selected !== null && owned.includes(selected) && selected !== target && (
          <button type="button" className="link" onClick={() => setScope(selected)}>
            use {areaName(data, selected)}
          </button>
        )}
      </div>
      <div className="row">
        <Select label="Policy" value={policy} options={POLICIES} onChange={setPolicy} />
        {perGood && (
          <Select
            label="Policy good"
            value={good}
            options={[{ value: ALL, label: "All goods" }, ...data.goods.map((g) => ({ value: g.id, label: g.name }))]}
            onChange={setGood}
          />
        )}
      </div>
      {slider && (
        <input
          type="range"
          className="policy-slider"
          aria-label="Policy level"
          min={slider.min}
          max={slider.max}
          step={slider.step}
          value={Math.min(slider.max, Math.max(slider.min, value))}
          onChange={(event) => setValue(Number(event.target.value))}
        />
      )}
      <div className="row">
        <NumberField label="Policy value" value={value} onChange={setValue} />
        <span className="muted">
          {isRate(policy)
            ? "% (negative: a subsidy)"
            : policy === "headTaxPerPersonPerDay"
              ? "mh per person per day"
              : `mh per unit${perGood && good !== ALL ? `, labor value ${fmt(data.goods[good]?.laborValue ?? 0)}` : ""}`}
        </span>
        <button type="button" className="primary" onClick={apply}>
          Set
        </button>
      </div>
      <div className="muted">
        In force for this choice: {isRate(policy) ? `${fmt(100 * current)}%` : `${fmt(current)} mh`}
      </div>
      <div className="row muted" data-testid="head-tax">
        Head tax in force {target === ALL ? "across the realm" : `in ${areaName(data, target)}`}: {fmt(headTax)} mh per
        person per day
      </div>
      <p className="hint">
        A setting for one good beats one for all goods; a setting for one area beats the realm's. Negative production
        taxes are subsidies.
      </p>
    </div>
  );
}
