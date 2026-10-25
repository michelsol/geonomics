// Ports, airports, roads and forts where the player's actions apply (specification §10, Panels; §6, Infrastructure):
// their levels, construction and staff, the staff wage, and buttons that build a level up or take one down.
import {
  canBuild,
  INFRASTRUCTURE_KINDS,
  type InfrastructureKind,
  levelCost,
  type PolicySetting,
  snapshotLevel,
} from "@geonomics/sim";
import { useEffect, useState } from "react";
import { actionTarget, policiesInForce, portLevelGain, reachOf, waterCapacityMaximum } from "../../state/selectors";
import { useGame } from "../../state/store";
import { count, fmt, NumberField, pct, Section, Stat } from "../components";
import { AreaLink, areaName, NoOwnArea, useSend, useView, type View } from "./common";

const LABELS: Record<InfrastructureKind, string> = { port: "Port", airport: "Airport", roads: "Roads", fort: "Fort" };
const SHORT: Record<InfrastructureKind, string> = { port: "P", airport: "A", roads: "R", fort: "F" };
const EFFECTS: Record<InfrastructureKind, string> = {
  port: "Each level adds capacity to the area's sea routes and reaches one more ring of water cells; armies sail only from a running port.",
  airport: "Each level adds capacity to the area's air routes; airports at the top level link to each other.",
  roads: "Lower the transport cost of the area's land borders, with the roads of the area across.",
  fort: "Each level adds 100% to the area's defense. A capture takes one level down.",
};

/** One area's state of one kind, as the panel reads it from the snapshot. */
interface KindState {
  area: number;
  level: number;
  target: number; // the level to build up to, never below the built level
  progress: number; // share of the next level built
  staff: number;
  quota: number;
  running: number; // staffed share
}

export function InfrastructurePanel() {
  const view = useView();
  const send = useSend();
  const selection = useGame((state) => state.selection);
  if (!view) return null;
  const { data, government } = view;
  const target = actionTarget(government, selection);
  const areas = target.areas;
  if (areas.length === 0) return <NoOwnArea />;
  const single = areas.length === 1 ? (areas[0] as number) : null;
  const label = target.realm
    ? "Whole realm"
    : single !== null
      ? areaName(data, single)
      : `Selection (${areas.length} areas)`;
  const set = (area: number, kind: InfrastructureKind, level: number) =>
    send({ type: "setInfrastructureTarget", area, kind, level });

  return (
    <>
      <StaffWage view={view} areas={areas} realm={target.realm} />
      <Section title="Infrastructure" actions={<span className="muted">{label}</span>}>
        <table data-testid="infrastructure">
          <thead>
            <tr>
              <th>Kind</th>
              <th>{single !== null ? "Level" : "Areas by level"}</th>
              <th className="num" title="Staff employed over the staff the built levels need">
                Staff
              </th>
              <th className="num" title="Share of the built levels that runs: staffed share">
                Runs
              </th>
              <th aria-label="Build up or take down" />
            </tr>
          </thead>
          <tbody>
            {INFRASTRUCTURE_KINDS.map((kind) => {
              const states = areas
                .filter((area) => canBuild(data.areas[area] ?? { isCoastal: false }, kind))
                .map((area) => kindState(view, area, kind));
              if (states.length === 0) return null; // no coast: no port
              return <KindRow key={kind} view={view} kind={kind} states={states} single={single !== null} set={set} />;
            })}
          </tbody>
        </table>
        <span className="hint">
          Levels are built one at a time with money paid into the area's savings; taking one down is immediate and free.
          Each built level needs staff to run.
        </span>
      </Section>
      <Sea view={view} areas={areas} />
      {single === null && <AreaTable view={view} areas={areas} />}
    </>
  );
}

function kindState(view: View, area: number, kind: InfrastructureKind): KindState {
  const { data, snapshot, government } = view;
  const k = INFRASTRUCTURE_KINDS.indexOf(kind);
  const state = government.areaStates.find((s) => s.area === area);
  const level = snapshotLevel(snapshot.areas, area, kind);
  const target = Math.max(level, Math.min(state?.targetLevel[k] ?? level, data.config.infrastructure.maximumLevel));
  return {
    area,
    level,
    target,
    progress: target > level ? (state?.buildDays[k] ?? 0) / data.config.infrastructure.buildDaysPerLevel[kind] : 0,
    staff: state?.staff[k] ?? 0,
    quota: level * data.config.infrastructure.staffPerLevel[kind],
    running: snapshot.areas.staffing[4 * area + k] ?? 0,
  };
}

/** One kind over the areas: levels and construction, staff, and buttons applying to every area. */
function KindRow({
  view,
  kind,
  states,
  single,
  set,
}: {
  view: View;
  kind: InfrastructureKind;
  states: KindState[];
  single: boolean;
  set: (area: number, kind: InfrastructureKind, level: number) => void;
}) {
  const { infrastructure } = view.data.config;
  const maximum = infrastructure.maximumLevel;
  const staff = states.reduce((sum, s) => sum + s.staff, 0);
  const quota = states.reduce((sum, s) => sum + s.quota, 0);
  const built = states.reduce((sum, s) => sum + s.level, 0);
  const running = built > 0 ? states.reduce((sum, s) => sum + s.level * s.running, 0) / built : 0;
  const first = states[0] as KindState;

  let levels: string;
  if (single)
    levels =
      first.target > first.level
        ? `${first.level} → ${first.level + 1} · ${pct(first.progress)}${first.target > first.level + 1 ? ` (to ${first.target})` : ""}`
        : `${first.level}`;
  else {
    const byLevel = Array.from({ length: maximum + 1 }, (_, level) => states.filter((s) => s.level === level).length);
    const building = states.filter((s) => s.target > s.level).length;
    levels = `${byLevel
      .map((n, level) => (n > 0 ? `${level}: ${n}` : null))
      .filter(Boolean)
      .join(" · ")}${building > 0 ? ` · ${building} building` : ""}`;
  }

  // Up: one more level wanted in each area; down: construction stops first, then a built level goes.
  const raisable = states.filter((s) => s.target < maximum);
  const lowerable = states.filter((s) => s.target > 0);
  const up = () => {
    for (const s of raisable) set(s.area, kind, s.target + 1);
  };
  const down = () => {
    for (const s of lowerable) set(s.area, kind, s.target > s.level ? s.level : s.level - 1);
  };
  const next = (s: KindState) => s.target + 1;
  const upCost = raisable.reduce((sum, s) => sum + levelCost(view.data.config, kind, next(s)), 0);
  const upTitle =
    raisable.length === 0
      ? "Already at the top level"
      : single
        ? `Level ${next(first)}: ${count(upCost)} mh over ${infrastructure.buildDaysPerLevel[kind]} days, then ${count(infrastructure.staffPerLevel[kind])} more staff to run it`
        : `One more level in ${raisable.length} areas: ${count(upCost)} mh in all, ${infrastructure.buildDaysPerLevel[kind]} days each, then ${count(infrastructure.staffPerLevel[kind] * raisable.length)} more staff`;

  return (
    <tr data-testid={`infrastructure-${kind}`}>
      <td title={EFFECTS[kind]}>{LABELS[kind]}</td>
      <td data-testid={`level-${kind}`}>{levels}</td>
      <td className="num">{quota > 0 ? `${count(staff)} / ${count(quota)}` : "—"}</td>
      <td className="num">{built > 0 ? pct(running) : "—"}</td>
      <td className="num nowrap">
        <button
          type="button"
          aria-label={`Take ${LABELS[kind]} down`}
          title={single && first.target > first.level ? "Stop construction" : "Take one level down, at once and free"}
          disabled={lowerable.length === 0}
          onClick={down}
        >
          −
        </button>{" "}
        <button
          type="button"
          aria-label={`Build ${LABELS[kind]} up`}
          title={upTitle}
          disabled={raisable.length === 0}
          onClick={up}
        >
          +
        </button>
      </td>
    </tr>
  );
}

/**
 * What the ports of the areas reach at sea: the water cells and the resources in them, the areas' shares at full
 * capacity, and what one more port level in each area would add.
 */
function Sea({ view, areas }: { view: View; areas: readonly number[] }) {
  const { data, snapshot } = view;
  const coasts = areas.filter((area) => data.areas[area]?.isCoastal);
  if (data.waters.length === 0 || coasts.length === 0) return null;
  const goods = data.goods.length;
  const reach = reachOf(data, snapshot) ?? [];
  const cells = new Set<number>();
  const now = new Float64Array(goods);
  const next = new Float64Array(goods);
  let added = 0;
  for (const area of coasts) {
    for (const { water, share } of reach[area] ?? []) {
      cells.add(water);
      for (let g = 0; g < goods; g++) now[g] = (now[g] as number) + share * waterCapacityMaximum(data, water, g);
    }
    if ((snapshot.areas.portLevel[area] as number) >= data.config.infrastructure.maximumLevel) continue;
    const gain = portLevelGain(data, snapshot, area);
    added += gain.cells;
    for (let g = 0; g < goods; g++) next[g] = (next[g] as number) + (gain.capacity[g] as number);
  }
  const rows = data.goods.filter(
    (good) => good.isPrimary && ((now[good.id] as number) > 0 || (next[good.id] as number) > 0),
  );
  return (
    <Section
      title="Sea"
      actions={
        <span className="muted">
          {count(cells.size)} water {cells.size === 1 ? "cell" : "cells"} in reach
        </span>
      }
    >
      {rows.length === 0 ? (
        <span className="muted">No resources in reach{added > 0 ? " or one level away" : ""}.</span>
      ) : (
        <table data-testid="sea-resources">
          <thead>
            <tr>
              <th>Resource</th>
              <th
                className="num"
                title="The areas' shares of the water cells their ports reach, at full capacity and staff"
              >
                In reach
              </th>
              <th className="num" title={`What one more port level would add (${count(added)} more water cells)`}>
                Next level
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((good) => (
              <tr key={good.id}>
                <td>{good.name}</td>
                <td className="num">{fmt(now[good.id] as number)}</td>
                <td className="num">{(next[good.id] as number) > 0 ? `+${fmt(next[good.id] as number)}` : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <span className="hint">
        A port of level L works the water cells within L hops of its coast; a cell several ports reach is shared equally
        between them. Capacities are per day, and the catch runs at the port's staffed share.
      </span>
    </Section>
  );
}

/**
 * The staff wage, as a share of the local average private wage: staff come while it is at least 100% and leave
 * below. Set realm-wide, or for the selected areas as an override.
 */
function StaffWage({ view, areas, realm }: { view: View; areas: readonly number[]; realm: boolean }) {
  const send = useSend();
  const { data, snapshot, government } = view;
  const { infrastructure, economy } = data.config;
  const shareOf = (area: number) =>
    policiesInForce(government, area, data.goods.length)?.staffWageShare ?? infrastructure.defaultStaffWageShare;
  const realmShare =
    government.realmPolicies.find((s) => s.policy === "staffWageShare")?.value ?? infrastructure.defaultStaffWageShare;
  const current = realm ? realmShare : shareOf(areas[0] as number);
  const shown = Math.round(100 * current);
  const [value, setValue] = useState(shown);
  const key = realm ? "realm" : areas.join(",");
  // biome-ignore lint/correctness/useExhaustiveDependencies: refills only when the scope changes, not on every snapshot
  useEffect(() => setValue(shown), [key, shown]);

  let staff = 0;
  let quota = 0;
  let wages = 0;
  let construction = 0;
  for (const area of areas) {
    const state = government.areaStates.find((s) => s.area === area);
    if (!state) continue;
    const hourly = shareOf(area) * Math.max(snapshot.areas.wageLevel[area] as number, 0) * economy.hoursPerWorkerDay;
    for (const [k, kind] of INFRASTRUCTURE_KINDS.entries()) {
      const level = snapshotLevel(snapshot.areas, area, kind);
      staff += state.staff[k] ?? 0;
      quota += level * infrastructure.staffPerLevel[kind];
      wages += (state.staff[k] ?? 0) * hourly;
      const target = Math.min(state.targetLevel[k] ?? 0, infrastructure.maximumLevel);
      if (target > level && canBuild(data.areas[area] ?? { isCoastal: false }, kind))
        construction += levelCost(data.config, kind, level + 1) / infrastructure.buildDaysPerLevel[kind];
    }
  }
  const setting = (): PolicySetting => ({ policy: "staffWageShare", good: null, value: value / 100 });
  const apply = () => {
    if (realm) send({ type: "setRealmPolicy", setting: setting() });
    else for (const area of areas) send({ type: "setAreaPolicy", area, setting: setting() });
  };

  return (
    <Section title="Staff and spending">
      <div className="stats">
        <Stat label="Staff" value={`${count(staff)} / ${count(quota)}`} testId="infrastructure-staff" />
        <Stat
          label="Staff wages"
          value={`${fmt(wages)} mh/day`}
          title="Paid from the treasury into the areas' savings."
        />
        <Stat
          label="Construction"
          value={`${fmt(construction)} mh/day`}
          testId="construction-spending"
          title="Payments for the levels being built, from the treasury into the areas' savings."
        />
      </div>
      <input
        type="range"
        className="policy-slider"
        aria-label="Staff wage level"
        min={50}
        max={200}
        step={5}
        value={Math.min(200, Math.max(50, value))}
        onChange={(event) => setValue(Number(event.target.value))}
      />
      <div className="row">
        <span>Staff wage</span>
        <NumberField label="Staff wage" value={value} min={0} onChange={setValue} />
        <span className="muted">% of the local private wage</span>
        <button type="button" className="primary" onClick={apply}>
          Set
        </button>
      </div>
      <span className="hint">
        Staff take these jobs at 100% or more, and leave below it or when the treasury cannot pay them.
      </span>
    </Section>
  );
}

/** The areas of the target with any infrastructure or construction: built levels, and → while one is being built. */
function AreaTable({ view, areas }: { view: View; areas: readonly number[] }) {
  const { data, snapshot } = view;
  const rows = areas
    .map((area) => ({ area, kinds: INFRASTRUCTURE_KINDS.map((kind) => kindState(view, area, kind)) }))
    .filter((row) => row.kinds.some((s) => s.level > 0 || s.target > s.level))
    .sort((a, b) => (snapshot.areas.population[b.area] as number) - (snapshot.areas.population[a.area] as number));
  return (
    <Section title="Areas" hint={`Built levels, 0 to ${data.config.infrastructure.maximumLevel}`}>
      {rows.length === 0 ? (
        <span className="muted">No infrastructure in these areas.</span>
      ) : (
        <table data-testid="infrastructure-areas">
          <thead>
            <tr>
              <th>Area</th>
              {INFRASTRUCTURE_KINDS.map((kind) => (
                <th key={kind} className="num" title={LABELS[kind]}>
                  {SHORT[kind]}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.area}>
                <td>
                  <AreaLink area={row.area} />
                </td>
                {row.kinds.map((s, k) => (
                  <td key={INFRASTRUCTURE_KINDS[k]} className="num">
                    {s.target > s.level ? `${s.level}→${s.target}` : s.level || "·"}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Section>
  );
}
