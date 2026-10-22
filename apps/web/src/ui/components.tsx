// Small shared building blocks for the panels.
import { type ReactNode, useEffect, useState } from "react";

/** Compact number: 1,234 → 1.23k, 5,600,000 → 5.6M; small values keep two significant decimals. */
export function fmt(value: number, digits = 3): string {
  if (!Number.isFinite(value)) return value > 0 ? "∞" : "—";
  const abs = Math.abs(value);
  if (abs >= 1e9) return `${(value / 1e9).toPrecision(digits)}B`;
  if (abs >= 1e6) return `${(value / 1e6).toPrecision(digits)}M`;
  if (abs >= 1e4) return `${(value / 1e3).toPrecision(digits)}k`;
  if (abs >= 100) return value.toFixed(0);
  if (abs === 0) return "0";
  return value.toPrecision(digits).replace(/\.?0+$/, "");
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

export function Stat({ label, value, testId }: { label: string; value: ReactNode; testId?: string }) {
  return (
    <div className="stat-box">
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
