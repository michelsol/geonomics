// Taxes and price controls (specification §9, Panels): the settings in force, realm-wide and per area, then every
// policy with its own controls, so none hides behind a menu. A setting applies to the selection's own areas, as an
// override in each, or realm-wide when the selection holds none or all.
import { type PolicyName, type PolicySetting, sameScope, WAGE_BAND_BOUNDARIES, WAGE_BAND_COUNT } from "@geonomics/sim";
import { useEffect, useState } from "react";
import { actionTarget } from "../../state/selectors";
import { useGame } from "../../state/store";
import { fmt, NumberField, Section, Select } from "../components";
import { areaName, goodOptions, NoOwnArea, useSend, useView } from "./common";

const ALL = -1; // "All goods" in a good select

/** Policies shown in percent; the others in man-hours. */
const RATES: readonly PolicyName[] = ["incomeTaxRate", "consumptionTaxRate", "importTariffRate", "exportTariffRate"];
const RATE_SLIDER = { min: -100, max: 100, step: 1 };
const AMOUNT_SLIDER = { min: -10, max: 10, step: 0.05 };

const NAMES: Partial<Record<PolicyName, string>> = {
  incomeTaxRate: "Income tax",
  unemployedTaxPerDay: "Income tax",
  headTaxPerPersonPerDay: "Head tax",
  consumptionTaxRate: "Consumption tax",
  importTariffRate: "Import tariff",
  exportTariffRate: "Export tariff",
  priceCeiling: "Price ceiling",
  priceFloor: "Price floor",
};

/** A wage band in words: "under 0.5 mh/h", "0.5–1 mh/h", "over 2 mh/h"; null for every band. */
export function bandName(band: number | null): string {
  if (band === null) return "all bands";
  const low = WAGE_BAND_BOUNDARIES[band - 1];
  const high = WAGE_BAND_BOUNDARIES[band];
  if (low === undefined) return `under ${high} mh/h`;
  if (high === undefined) return `over ${low} mh/h`;
  return `${low}–${high} mh/h`;
}

const capitalized = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

/** One control: which setting it writes, how it is shown and labelled. */
interface ControlSpec {
  policy: PolicyName;
  name: string; // the setting's full name, for its labels: "Income tax · 1–2 mh/h"
  label: string; // shown on the row: "1–2 mh/h"
  band?: number | null;
  perGood?: boolean; // the row has its own good select
  slider?: { min: number; max: number; step: number };
  unit: string; // what the number means
}

const INCOME_TAX: ControlSpec[] = [
  ...[null, ...Array.from({ length: WAGE_BAND_COUNT }, (_, band) => band)].map((band) => ({
    policy: "incomeTaxRate" as const,
    name: `Income tax · ${bandName(band)}`,
    label: capitalized(bandName(band)),
    band,
    slider: RATE_SLIDER,
    unit: "% of wages (negative: tops them up)",
  })),
  {
    policy: "unemployedTaxPerDay",
    name: "Income tax · unemployed",
    label: "Unemployed",
    slider: AMOUNT_SLIDER,
    unit: "mh per unemployed worker per day (negative: a benefit)",
  },
];
const HEAD_TAX: ControlSpec = {
  policy: "headTaxPerPersonPerDay",
  name: "Head tax",
  label: "Every inhabitant",
  slider: AMOUNT_SLIDER,
  unit: "mh per person per day (negative: paid to each person)",
};
const perGoodRate = (policy: PolicyName): ControlSpec => ({
  policy,
  name: NAMES[policy] as string,
  label: NAMES[policy] as string,
  perGood: true,
  slider: RATE_SLIDER,
  unit: "% (negative: a subsidy)",
});
const perGoodPrice = (policy: PolicyName): ControlSpec => ({
  policy,
  name: NAMES[policy] as string,
  label: NAMES[policy] as string,
  perGood: true,
  unit: "mh per unit",
});

export function PolicyEditor() {
  const view = useView();
  const send = useSend();
  const selection = useGame((state) => state.selection);
  if (!view) return null;
  const { data, government } = view;
  const target = actionTarget(government, selection);
  const goodName = (g: number | null) => (g === null ? "all goods" : (data.goods[g]?.name ?? "?"));
  const show = (s: PolicySetting) =>
    s.value === null ? "none" : RATES.includes(s.policy) ? `${fmt(100 * s.value)}%` : `${fmt(s.value)} mh`;
  const labelOf = (s: PolicySetting) =>
    s.policy === "incomeTaxRate"
      ? `Income tax · ${bandName(s.band ?? null)}`
      : s.policy === "unemployedTaxPerDay"
        ? "Income tax · unemployed"
        : s.policy === "headTaxPerPersonPerDay"
          ? "Head tax"
          : `${NAMES[s.policy] ?? s.policy} · ${goodName(s.good)}`;
  const keyOf = (s: PolicySetting) => `${s.policy}-${s.good}-${s.band ?? null}`;

  // The staff wage is set and shown in the Infrastructure panel.
  const listed = (settings: PolicySetting[]) => settings.filter((s) => s.policy !== "staffWageShare");
  const realmPolicies = listed(government.realmPolicies);
  const overrides = government.areaStates
    .map((state) => ({ area: state.area, policyOverrides: listed(state.policyOverrides) }))
    .filter((s) => s.policyOverrides.length > 0);
  const control = (spec: ControlSpec) => <PolicyControl key={spec.name} spec={spec} />;

  return (
    <>
      <Section title="Taxes and price controls">
        <table data-testid="policies">
          <tbody>
            <tr>
              <th colSpan={3}>Every area</th>
            </tr>
            {realmPolicies.length === 0 && (
              <tr>
                <td colSpan={3} className="muted">
                  No realm-wide tax or price control.
                </td>
              </tr>
            )}
            {realmPolicies.map((s) => (
              <tr key={`realm-${keyOf(s)}`}>
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
                <tr key={`${state.area}-${keyOf(s)}`}>
                  <td>{labelOf(s)}</td>
                  <td className="num">{show(s)}</td>
                  <td className="num">
                    <button
                      type="button"
                      aria-label={`Remove ${labelOf(s)} in ${areaName(data, state.area)}`}
                      onClick={() =>
                        send({
                          type: "clearAreaPolicy",
                          area: state.area,
                          policy: s.policy,
                          good: s.good,
                          band: s.band ?? null,
                        })
                      }
                    >
                      ✕
                    </button>
                  </td>
                </tr>
              )),
            ])}
          </tbody>
        </table>
        {target.areas.length === 0 && <NoOwnArea />}
      </Section>
      {target.areas.length > 0 && (
        <>
          <Section
            title="Income tax"
            hint="A share of wages in each wage band, negative to top them up, and an amount per unemployed worker per day, negative for a benefit"
          >
            {INCOME_TAX.map(control)}
          </Section>
          <Section title="Head tax" hint="An amount per person per day, negative for an allowance paid to each person">
            {control(HEAD_TAX)}
          </Section>
          <Section
            title="Consumption tax"
            hint="A share added to what consumers pay for a good, negative for a subsidy"
          >
            {control(perGoodRate("consumptionTaxRate"))}
          </Section>
          <Section title="Tariffs" hint="A share of the price of goods crossing a border">
            {control(perGoodRate("importTariffRate"))}
            {control(perGoodRate("exportTariffRate"))}
          </Section>
          <Section title="Price controls">
            {control(perGoodPrice("priceCeiling"))}
            {control(perGoodPrice("priceFloor"))}
          </Section>
        </>
      )}
    </>
  );
}

/**
 * One policy's controls: a good select for per-good policies, a slider where it has one, the number and Set. The value
 * starts at the setting in force for the action target (for several areas, the first one's).
 */
function PolicyControl({ spec }: { spec: ControlSpec }) {
  const view = useView();
  const send = useSend();
  const selection = useGame((state) => state.selection);
  const [good, setGood] = useState(ALL);
  const [value, setValue] = useState(0); // as shown: percent for rates, man-hours otherwise
  const target = view ? actionTarget(view.government, selection) : { realm: true, areas: [] };
  const targetAreas = target.realm ? [] : target.areas;
  const targetKey = target.realm ? "realm" : targetAreas.join(",");
  const rate = RATES.includes(spec.policy);
  const scope = { policy: spec.policy, good: spec.perGood && good !== ALL ? good : null, band: spec.band ?? null };
  const settings: PolicySetting[] | undefined = target.realm
    ? view?.government.realmPolicies
    : view?.government.areaStates.find((s) => s.area === targetAreas[0])?.policyOverrides;
  const current = settings?.find((s) => sameScope(s, scope))?.value ?? 0;
  const shown = rate ? Math.round(100 * current * 100) / 100 : current;
  // biome-ignore lint/correctness/useExhaustiveDependencies: refills only when the scope changes, not on every snapshot
  useEffect(() => setValue(shown), [targetKey, scope.good]);
  if (!view) return null;
  const { data } = view;
  const { slider } = spec;

  const apply = () => {
    const setting: PolicySetting = { policy: spec.policy, good: scope.good, value: rate ? value / 100 : value };
    if (scope.band !== null) setting.band = scope.band;
    if (target.realm) send({ type: "setRealmPolicy", setting });
    else for (const area of targetAreas) send({ type: "setAreaPolicy", area, setting });
  };
  const laborValue = spec.perGood && !rate && good !== ALL ? data.goods[good]?.laborValue : undefined;

  return (
    <div className="policy-control">
      <div className="row">
        <span className="policy-label" title={spec.unit}>
          {spec.label}
        </span>
        {spec.perGood && (
          <Select
            label={`${spec.name} good`}
            value={good}
            options={[{ value: ALL, label: "All goods" }, ...goodOptions(data)]}
            onChange={setGood}
          />
        )}
        <NumberField label={`${spec.name} value`} value={value} onChange={setValue} />
        <span className="muted" title={spec.unit}>
          {rate ? "%" : spec.slider ? "mh/day" : "mh"}
          {laborValue === undefined ? "" : ` (labor value ${fmt(laborValue)})`}
        </span>
        <button type="button" className="primary" aria-label={`Set ${spec.name}`} onClick={apply}>
          Set
        </button>
      </div>
      {slider && (
        <input
          type="range"
          className="policy-slider"
          aria-label={`${spec.name} level`}
          min={slider.min}
          max={slider.max}
          step={slider.step}
          value={Math.min(slider.max, Math.max(slider.min, value))}
          onChange={(event) => setValue(Number(event.target.value))}
        />
      )}
    </div>
  );
}
