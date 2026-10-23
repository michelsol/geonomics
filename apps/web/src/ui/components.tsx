// Small shared building blocks for the panels.
import { type ReactNode, useEffect, useState } from "react";

/** Up to `decimals` decimals, without trailing zeros: 3.10 → "3.1", 3.00 → "3". */
const trim = (value: number, decimals: number) => {
  const fixed = value.toFixed(decimals);
  return decimals > 0 ? fixed.replace(/\.?0+$/, "") : fixed; // only zeros after the point go
};

/** Compact form of a large number, three significant digits at most: 24,312 → 24.3k, 5,600,000 → 5.6M. */
function compact(value: number): string {
  const abs = Math.abs(value);
  const [scale, suffix] = abs >= 999.5e6 ? [1e9, "B"] : abs >= 999.5e3 ? [1e6, "M"] : [1e3, "k"];
  const scaled = value / scale;
  const decimals = Math.abs(scaled) >= 100 ? 0 : Math.abs(scaled) >= 10 ? 1 : 2;
  return `${trim(scaled, decimals)}${suffix}`;
}

/**
 * A decimal quantity (price, wage, stock, flow, money), with at most two decimals: 0.137 → 0.14, 4383.2 → 4383,
 * 24,312 → 24.3k. A nonzero value that would round to zero shows as "<0.01".
 */
export function fmt(value: number): string {
  if (!Number.isFinite(value)) return value > 0 ? "∞" : "—";
  const abs = Math.abs(value);
  if (abs >= 1e4) return compact(value);
  if (abs >= 100) return value.toFixed(0);
  if (abs === 0) return "0";
  if (abs < 0.005) return value > 0 ? "<0.01" : ">-0.01";
  return trim(value, 2);
}

/** A quantity that is a whole number by nature (people, workers, soldiers, days): 24,312 → "24,312", 2.3M above. */
export function count(value: number): string {
  if (!Number.isFinite(value)) return value > 0 ? "∞" : "—";
  if (Math.abs(value) >= 1e6) return compact(value);
  return Math.round(value).toLocaleString("en-US");
}

export const pct = (value: number) => `${(100 * value).toFixed(value < 0.1 && value > -0.1 ? 1 : 0)}%`;

export function Section({ title, children, actions }: { title: string; children: ReactNode; actions?: ReactNode }) {
  return (
    <section className="section">
      <div className="row" style={{ justifyContent: "space-between" }}>
        <h3>{title}</h3>
        {actions}
      </div>
      {children}
    </section>
  );
}

export function Stat({
  label,
  value,
  testId,
  title,
}: {
  label: string;
  value: ReactNode;
  testId?: string;
  title?: string;
}) {
  return (
    <div className="stat-box" title={title}>
      <div className="label">{label}</div>
      <div className="value" data-testid={testId}>
        {value}
      </div>
    </div>
  );
}

/** A number field that only reports a value once it parses. */
export function NumberField({
  value,
  onChange,
  label,
  step = "any",
  min,
}: {
  value: number;
  onChange: (value: number) => void;
  label: string;
  step?: string;
  min?: number;
}) {
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(value)), [value]);
  return (
    <input
      type="number"
      aria-label={label}
      title={label}
      value={text}
      step={step}
      min={min}
      onChange={(event) => {
        setText(event.target.value);
        const parsed = Number(event.target.value);
        if (event.target.value !== "" && Number.isFinite(parsed)) onChange(parsed);
      }}
    />
  );
}

export function Select<T extends string | number>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: readonly { value: T; label: string }[];
  onChange: (value: T) => void;
  label: string;
}) {
  return (
    <select
      aria-label={label}
      value={String(value)}
      onChange={(event) => {
        const option = options.find((o) => String(o.value) === event.target.value);
        if (option) onChange(option.value);
      }}
    >
      {options.map((option) => (
        <option key={String(option.value)} value={String(option.value)}>
          {option.label}
        </option>
      ))}
    </select>
  );
}

export function Swatch({ color }: { color: string }) {
  return <span className="swatch" style={{ background: color }} />;
}
