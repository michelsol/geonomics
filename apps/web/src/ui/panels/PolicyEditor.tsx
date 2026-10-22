// Lists policy settings and adds new ones; used for realm defaults and area overrides.
import type { PolicyName, PolicySetting } from "@geonomics/sim";
import { useState } from "react";
import { useGame } from "../../state/store";
import { fmt, NumberField, Select } from "../components";
import { goodOptions } from "./common";

const POLICIES: { value: PolicyName; label: string; rate: boolean }[] = [
  { value: "productionTaxRate", label: "Production tax", rate: true },
  { value: "consumptionTaxRate", label: "Consumption tax", rate: true },
  { value: "importTariffRate", label: "Import tariff", rate: true },
  { value: "exportTariffRate", label: "Export tariff", rate: true },
  { value: "headTaxPerPersonPerDay", label: "Head tax", rate: false },
  { value: "priceCeiling", label: "Price ceiling", rate: false },
  { value: "priceFloor", label: "Price floor", rate: false },
];

const policyLabel = (policy: PolicyName) => POLICIES.find((p) => p.value === policy)?.label ?? policy;
const isRate = (policy: PolicyName) => POLICIES.find((p) => p.value === policy)?.rate ?? false;

export function PolicyEditor({
  settings,
  onSet,
  onClear,
  resolvedHeadTax,
}: {
  settings: PolicySetting[];
  onSet: (setting: PolicySetting) => void;
  onClear: (setting: PolicySetting) => void;
  resolvedHeadTax: number;
}) {
  const data = useGame((state) => state.data);
  const [policy, setPolicy] = useState<PolicyName>("headTaxPerPersonPerDay");
  const [good, setGood] = useState(0);
  const [value, setValue] = useState(0.1);
  if (!data) return null;
  const perGood = policy !== "headTaxPerPersonPerDay";
  const show = (s: PolicySetting) =>
    s.value === null ? "none" : isRate(s.policy) ? `${fmt(100 * s.value)}%` : `${fmt(s.value)} mh`;

  return (
    <div className="section">
      {settings.length > 0 && (
        <table>
          <tbody>
            {settings.map((s) => (
              <tr key={`${s.policy}-${s.good}`}>
                <td>
                  {policyLabel(s.policy)}
                  {s.good !== null ? ` · ${data.goods[s.good]?.name}` : ""}
                </td>
                <td className="num">{show(s)}</td>
                <td className="num">
                  <button type="button" onClick={() => onClear(s)} aria-label={`Remove ${policyLabel(s.policy)}`}>
                    ✕
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <div className="row muted" data-testid="head-tax">
        Head tax in force: {fmt(resolvedHeadTax)} mh per person per day
      </div>
      <div className="row">
        <Select label="Policy" value={policy} options={POLICIES} onChange={setPolicy} />
        {perGood && <Select label="Policy good" value={good} options={goodOptions(data)} onChange={setGood} />}
      </div>
      <div className="row">
        <NumberField label="Policy value" value={value} onChange={setValue} />
        <span className="muted">{isRate(policy) ? "share, e.g. 0.1 = 10%" : "man-hours"}</span>
        <button type="button" className="primary" onClick={() => onSet({ policy, good: perGood ? good : null, value })}>
          Set
        </button>
      </div>
    </div>
  );
}
