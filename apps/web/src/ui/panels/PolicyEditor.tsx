// Taxes and price controls (specification §9, Panels): the settings in force, realm-wide and per area, then every
// policy on one line, so none hides behind a menu. A setting applies to the selection's own areas, as an override in
// each, or realm-wide when the selection holds none or all.
import { type PolicyName, type PolicySetting, sameScope, WAGE_BAND_BOUNDARIES, WAGE_BAND_COUNT } from "@geonomics/sim";
import { type CSSProperties, useEffect, useRef, useState } from "react";
import { actionTarget } from "../../state/selectors";
import { useGame } from "../../state/store";
import { fmt, Section, Select } from "../components";
import { areaName, goodOptions, NoOwnArea, useSend, useView } from "./common";

const ALL = -1; // "All goods" in the good select

/** Policies shown in percent; the others in man-hours, or in multiples of labor value for price controls. */
const RATES: readonly PolicyName[] = ["incomeTaxRate", "consumptionTaxRate", "importTariffRate", "exportTariffRate"];
const PRICES: readonly PolicyName[] = ["priceCeiling", "priceFloor"];

/** How a kind of policy is shown and stepped, in the units shown: percent, man-hours or multiples of labor value. */
interface Kind {
  min: number; // slider range
  max: number;
  step: number; // slider step
  fine: number; // one arrow click
  lowest: number; // what the arrows can reach
  highest: number;
}
const RATE: Kind = { min: -100, max: 100, step: 1, fine: 0.5, lowest: -100, highest: 500 };
const AMOUNT: Kind = { min: -10, max: 10, step: 0.05, fine: 0.05, lowest: -1e6, highest: 1e6 };
const NO_CEILING = 10.1; // the ceiling slider's top position: no ceiling
const CEILING: Kind = { min: 0, max: NO_CEILING, step: 0.1, fine: 0.1, lowest: 0, highest: NO_CEILING };
const FLOOR: Kind = { min: 0, max: 10, step: 0.1, fine: 0.1, lowest: 0, highest: 10 }; // 0: no floor

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
  label: string; // shown on the line: "1–2 mh/h"
  band?: number | null;
  perGood?: boolean; // applies to the good picked for the goods block
  kind: Kind;
  unit: string; // what the number means
}

const INCOME_TAX: ControlSpec[] = [
  ...[null, ...Array.from({ length: WAGE_BAND_COUNT }, (_, band) => band)].map((band) => ({
    policy: "incomeTaxRate" as const,
    name: `Income tax · ${bandName(band)}`,
    label: capitalized(bandName(band)),
    band,
    kind: RATE,
    unit: "% of wages (negative: tops them up)",
  })),
  {
    policy: "unemployedTaxPerDay",
    name: "Income tax · unemployed",
    label: "Unemployed",
    kind: AMOUNT,
    unit: "mh per unemployed worker per day (negative: a benefit)",
  },
];
const HEAD_TAX: ControlSpec = {
  policy: "headTaxPerPersonPerDay",
  name: "Head tax",
  label: "Every inhabitant",
  kind: AMOUNT,
  unit: "mh per person per day (negative: paid to each person)",
};
const perGood = (policy: PolicyName, kind: Kind, unit: string): ControlSpec => ({
  policy,
  name: NAMES[policy] as string,
  label: NAMES[policy] as string,
  perGood: true,
  kind,
  unit,
});
const GOOD_RATES = (["consumptionTaxRate", "importTariffRate", "exportTariffRate"] as const).map((policy) =>
  perGood(policy, RATE, "% of the price (negative: a subsidy)"),
);
const PRICE_CONTROLS = [
  perGood("priceCeiling", CEILING, "times the good's labor value; at the top, no ceiling"),
  perGood("priceFloor", FLOOR, "times the good's labor value; at 0, no floor"),
];

export function PolicyEditor() {
  const view = useView();
  const send = useSend();
  const selection = useGame((state) => state.selection);
  const [good, setGood] = useState(ALL);
  if (!view) return null;
  const { data, government } = view;
  const target = actionTarget(government, selection);
  const goodName = (g: number | null) => (g === null ? "all goods" : (data.goods[g]?.name ?? "?"));
  const show = (s: PolicySetting) =>
    s.value === null
      ? "none"
      : RATES.includes(s.policy)
        ? `${fmt(100 * s.value)}%`
        : PRICES.includes(s.policy)
          ? `${fmt(s.value)}× labor value`
          : `${fmt(s.value)} mh`;
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
  const control = (spec: ControlSpec) => <PolicyControl key={spec.name} spec={spec} good={good} />;

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
            hint="A share of wages in each wage band, negative to top them up, and an amount per unemployed worker per day, negative for a benefit. A slider applies when released; the arrows step finely."
          >
            {INCOME_TAX.map(control)}
          </Section>
          <Section title="Head tax" hint="An amount per person per day, negative for an allowance paid to each person">
            {control(HEAD_TAX)}
          </Section>
          <Section title="Goods" hint="The consumption tax, the tariffs and the price controls of the good picked here">
            <div className="row">
              <Select
                label="Policy good"
                value={good}
                options={[{ value: ALL, label: "All goods" }, ...goodOptions(data)]}
                onChange={setGood}
              />
            </div>
            <h3 className="policy-heading">Consumption tax and tariffs</h3>
            {GOOD_RATES.map(control)}
            <h3 className="policy-heading">Price controls, in multiples of labor value</h3>
            {PRICE_CONTROLS.map(control)}
          </Section>
        </>
      )}
    </>
  );
}

/** The value of a setting in the units shown, from its stored value; null is no ceiling or no floor. */
function toShown(spec: ControlSpec, value: number | null | undefined): number {
  if (spec.kind === RATE) return Math.round(100 * (value ?? 0) * 100) / 100;
  if (spec.kind === CEILING) return value === null || value === undefined ? NO_CEILING : value;
  return value ?? 0;
}

/** The value to store from the value shown: a share for rates; null at a price control's "none" end. */
function toStored(spec: ControlSpec, shown: number): number | null {
  if (spec.kind === RATE) return shown / 100;
  if (spec.kind === CEILING && shown >= NO_CEILING) return null;
  if (spec.kind === FLOOR && shown <= 0) return null;
  return shown;
}

/**
 * One policy on one line: its label, a slider with the level on its thumb, applied when released, and arrows for
 * fine steps, applied at once. The value starts at the setting in force for the action target (for several areas,
 * the first one's).
 */
function PolicyControl({ spec, good }: { spec: ControlSpec; good: number }) {
  const view = useView();
  const send = useSend();
  const selection = useGame((state) => state.selection);
  const slider = useRef<HTMLInputElement>(null);
  const hasView = view !== null; // the slider exists once there is a view
  const target = view ? actionTarget(view.government, selection) : { realm: true, areas: [] };
  const targetAreas = target.realm ? [] : target.areas;
  const targetKey = target.realm ? "realm" : targetAreas.join(",");
  const scope = { policy: spec.policy, good: spec.perGood && good !== ALL ? good : null, band: spec.band ?? null };
  const settings: PolicySetting[] | undefined = target.realm
    ? view?.government.realmPolicies
    : view?.government.areaStates.find((s) => s.area === targetAreas[0])?.policyOverrides;
  const current = toShown(spec, settings?.find((s) => sameScope(s, scope))?.value);
  const [value, setValue] = useState(current);
  // biome-ignore lint/correctness/useExhaustiveDependencies: refills when the scope or the setting changes, not while dragging
  useEffect(() => setValue(current), [targetKey, scope.good, current]);

  const apply = (shown: number) => {
    const setting: PolicySetting = { policy: spec.policy, good: scope.good, value: toStored(spec, shown) };
    if (scope.band !== null) setting.band = scope.band;
    if (target.realm) send({ type: "setRealmPolicy", setting });
    else for (const area of targetAreas) send({ type: "setAreaPolicy", area, setting });
  };
  // React's onChange fires on every move; the native change event comes once the slider is released.
  const latestApply = useRef(apply);
  latestApply.current = apply;
  // biome-ignore lint/correctness/useExhaustiveDependencies: the slider is rendered, and listened to, once there is a view
  useEffect(() => {
    const input = slider.current;
    if (!input) return;
    const onRelease = () => latestApply.current(Number(input.value));
    input.addEventListener("change", onRelease);
    return () => input.removeEventListener("change", onRelease);
  }, [hasView]);
  if (!view) return null;

  const { kind } = spec;
  const step = (direction: 1 | -1) => {
    const next = Math.round((value + direction * kind.fine) * 1000) / 1000;
    const bounded = Math.min(kind.highest, Math.max(kind.lowest, next));
    setValue(bounded);
    apply(bounded);
  };
  const laborValue = spec.perGood && good !== ALL ? view.data.goods[good]?.laborValue : undefined;
  const stored = toStored(spec, value);
  const bubble =
    stored === null
      ? "none"
      : kind === RATE
        ? `${fmt(value)}%`
        : kind === AMOUNT
          ? `${fmt(value)} mh`
          : `${fmt(value)}×`;
  const title =
    stored !== null && laborValue !== undefined ? `${bubble}: ${fmt(value * laborValue)} mh per unit` : spec.unit;
  const position = (Math.min(kind.max, Math.max(kind.min, value)) - kind.min) / (kind.max - kind.min);

  return (
    <div className="policy-control">
      <span className="policy-label" title={spec.unit}>
        {spec.label}
      </span>
      <div className="policy-track" style={{ "--p": position } as CSSProperties} title={title}>
        <input
          ref={slider}
          type="range"
          aria-label={`${spec.name} level`}
          min={kind.min}
          max={kind.max}
          step={kind.step}
          value={Math.min(kind.max, Math.max(kind.min, value))}
          onChange={(event) => setValue(Number(event.target.value))}
        />
        <span className="policy-bubble" aria-hidden="true">
          {bubble}
        </span>
      </div>
      <div className="policy-arrows">
        <button type="button" aria-label={`Raise ${spec.name}`} onClick={() => step(1)}>
          ▲
        </button>
        <button type="button" aria-label={`Lower ${spec.name}`} onClick={() => step(-1)}>
          ▼
        </button>
      </div>
    </div>
  );
}
