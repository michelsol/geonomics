// Taxes and price controls: realm-wide settings and per-area overrides, each for one good or every good. A setting
// applies to the selection's own areas, as an override in each, or realm-wide when the selection holds none or all.
import type { PolicyName, PolicySetting } from "@geonomics/sim";
import { useEffect, useState } from "react";
import { actionTarget } from "../../state/selectors";
import { useGame } from "../../state/store";
import { fmt, NumberField, Select } from "../components";
import { areaName, goodOptions, NoOwnArea, useSend, useView } from "./common";

const POLICIES: { value: PolicyName; label: string; rate: boolean }[] = [
  { value: "productionTaxRate", label: "Production tax", rate: true },
  { value: "consumptionTaxRate", label: "Consumption tax", rate: true },
  { value: "importTariffRate", label: "Import tariff", rate: true },
  { value: "exportTariffRate", label: "Export tariff", rate: true },
  { value: "headTaxPerPersonPerDay", label: "Head tax", rate: false },
  { value: "priceCeiling", label: "Price ceiling", rate: false },
  { value: "priceFloor", label: "Price floor", rate: false },
];

const ALL = -1; // "All goods" in the good select

/** Slider range of the policies that have one: rates in percent, head tax in man-hours per person per day. */
const SLIDERS: Partial<Record<PolicyName, { min: number; max: number; step: number }>> = {
  productionTaxRate: { min: -100, max: 100, step: 1 },
  consumptionTaxRate: { min: -100, max: 100, step: 1 },
  importTariffRate: { min: -100, max: 100, step: 1 },
  exportTariffRate: { min: -100, max: 100, step: 1 },
  headTaxPerPersonPerDay: { min: -10, max: 10, step: 0.05 }, // negative: an allowance paid to each person
};

const policyLabel = (policy: PolicyName) => POLICIES.find((p) => p.value === policy)?.label ?? policy;
const isRate = (policy: PolicyName) => POLICIES.find((p) => p.value === policy)?.rate ?? false;

export function PolicyEditor() {
  const view = useView();
  const send = useSend();
  const selection = useGame((state) => state.selection);
  const [policy, setPolicy] = useState<PolicyName>("productionTaxRate");
  const [good, setGood] = useState(ALL);
  const [value, setValue] = useState(0); // as shown: percent for rates, man-hours otherwise
  const target = view ? actionTarget(view.government, selection) : { realm: true, areas: [] };
  const targetAreas = target.realm ? [] : target.areas;
  const targetKey = target.realm ? "realm" : targetAreas.join(",");
  const perGood = policy !== "headTaxPerPersonPerDay";
  const settingGood = perGood && good !== ALL ? good : null;
  // The setting for exactly this scope (for several areas, the first one's), policy and good, so the slider starts at
  // the current level.
  const settings: PolicySetting[] | undefined = target.realm
    ? view?.government.realmPolicies
    : view?.government.areaStates.find((s) => s.area === targetAreas[0])?.policyOverrides;
  const current = settings?.find((s) => s.policy === policy && s.good === settingGood)?.value ?? 0;
  const shown = isRate(policy) ? Math.round(100 * current * 100) / 100 : current;
  // biome-ignore lint/correctness/useExhaustiveDependencies: refills only when the scope changes, not on every snapshot
  useEffect(() => setValue(shown), [policy, targetKey, settingGood]);
  if (!view) return null;
  const { data, government } = view;
  const slider = SLIDERS[policy];
  const goodName = (g: number | null) => (g === null ? "all goods" : (data.goods[g]?.name ?? "?"));
  const show = (s: PolicySetting) =>
    s.value === null ? "none" : isRate(s.policy) ? `${fmt(100 * s.value)}%` : `${fmt(s.value)} mh`;
  const labelOf = (s: PolicySetting) =>
    s.policy === "headTaxPerPersonPerDay" ? policyLabel(s.policy) : `${policyLabel(s.policy)} · ${goodName(s.good)}`;

  const overrides = government.areaStates.filter((s) => s.policyOverrides.length > 0);

  const setting = (): PolicySetting => ({ policy, good: settingGood, value: isRate(policy) ? value / 100 : value });
  const apply = () => {
    if (target.realm) send({ type: "setRealmPolicy", setting: setting() });
    else for (const a of targetAreas) send({ type: "setAreaPolicy", area: a, setting: setting() });
  };

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

      {target.areas.length === 0 ? (
        <NoOwnArea />
      ) : (
        <>
          <div className="row">
            <Select label="Policy" value={policy} options={POLICIES} onChange={setPolicy} />
            {perGood && (
              <Select
                label="Policy good"
                value={good}
                options={[{ value: ALL, label: "All goods" }, ...goodOptions(data)]}
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
                  ? "mh per person per day (negative: paid to each person)"
                  : `mh per unit${perGood && good !== ALL ? `, labor value ${fmt(data.goods[good]?.laborValue ?? 0)}` : ""}`}
            </span>
            <button type="button" className="primary" onClick={apply}>
              Set
            </button>
          </div>
        </>
      )}
    </div>
  );
}
