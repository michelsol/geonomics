// Employment, government jobs and wage offers where the player's actions apply: one area, the selected ones, or the
// whole realm. Totals for several areas are split over them by population (specification §10, Selection).
import type { Command, GovernmentJob } from "@geonomics/sim";
import { useEffect, useState } from "react";
import { actionTarget, employmentOf, splitByPopulation } from "../../state/selectors";
import { useGame } from "../../state/store";
import { count, fmt, NumberField, pct, Section, Select } from "../components";
import { areaName, useSend, useView, type View } from "./common";

// Categorical slots 1 and 2 of the chart palette (dark steps), validated against the panel surface; the unemployed
// are a neutral gray, since they are the absence of a job rather than a third kind of one.
const PRIVATE_COLOR = "#3987e5";
const GOVERNMENT_COLOR = "#d95926";
const UNEMPLOYED_COLOR = "#5b6270";

type JobKind = GovernmentJob["kind"];
const JOB_LABELS: Record<JobKind, string> = {
  produce: "Produce",
  buildInfrastructure: "Build road",
  fortify: "Fortify",
  buildPort: "Build port",
  buildAirport: "Build airport",
};

/** The same job in several areas, as one line: summed workers and targets. */
interface JobGroup {
  job: GovernmentJob;
  areas: number[];
  workers: number;
  target: number;
}

export function JobsPanel() {
  const view = useView();
  const send = useSend();
  const selection = useGame((state) => state.selection);
  const edges = useGame((state) => state.edges);
  const [job, setJob] = useState({ kind: "fortify" as JobKind, good: 0, edge: -1, workers: 100 });
  if (!view) return null;
  const { data, government, snapshot } = view;
  const target = actionTarget(government, selection);
  const areas = target.areas;
  if (areas.length === 0) return <p className="muted">You hold no area.</p>;
  const region = areas.length >= 2;
  const single = region ? null : (areas[0] as number);
  const population = snapshot.areas.population;
  const label = target.realm
    ? "Whole realm"
    : region
      ? `Selection (${areas.length} areas)`
      : areaName(data, areas[0] as number);

  // Roads: from one area, a chosen edge; across a selection, every land edge inside it.
  const inside = new Set(areas);
  const roads = edges
    .map((edge, id) => ({ edge, id }))
    .filter(({ edge }) =>
      edge.mode !== "land"
        ? false
        : region
          ? inside.has(edge.areaA) && inside.has(edge.areaB)
          : edge.areaA === single || edge.areaB === single,
    );
  const coastal = areas.filter((area) => data.areas[area]?.isCoastal);
  const kinds = (Object.keys(JOB_LABELS) as JobKind[])
    .filter((kind) => kind !== "buildPort" || coastal.length > 0)
    .filter((kind) => kind !== "buildInfrastructure" || roads.length > 0)
    .map((kind) => ({
      value: kind,
      label: kind === "buildInfrastructure" && region ? `Build roads (${roads.length} inside)` : JOB_LABELS[kind],
    }));
  const otherEnd = (edge: number, from: number) =>
    edges[edge]?.areaA === from ? (edges[edge]?.areaB ?? from) : (edges[edge]?.areaA ?? from);
  const describeJob = (j: GovernmentJob, area: number) =>
    j.kind === "produce"
      ? `Produce ${data.goods[j.good]?.name}`
      : j.kind === "buildInfrastructure"
        ? `Road ${areaName(data, area)} – ${areaName(data, otherEnd(j.edge, area))}`
        : JOB_LABELS[j.kind];

  // Jobs across the areas, one line per distinct job.
  const groups = new Map<string, JobGroup>();
  for (const area of areas) {
    for (const assignment of government.areaStates.find((s) => s.area === area)?.jobs ?? []) {
      const key = JSON.stringify(assignment.job);
      const group = groups.get(key) ?? { job: assignment.job, areas: [], workers: 0, target: 0 };
      group.areas.push(area);
      group.workers += assignment.workers;
      group.target += assignment.targetWorkers;
      groups.set(key, group);
    }
  }

  /** Commands giving a job `total` workers over `over`, split by population (roads: evenly over the edges). */
  const hire = (kind: GovernmentJob, total: number, over: number[]): Command[] =>
    splitByPopulation(total, over, population).map((targetWorkers, i) => ({
      type: "setJobTarget",
      area: over[i] as number,
      job: kind,
      targetWorkers,
    }));
  const hireNew = (): Command[] => {
    switch (job.kind) {
      case "produce":
        return hire({ kind: "produce", good: job.good }, job.workers, areas);
      case "buildPort":
        return hire({ kind: "buildPort" }, job.workers, coastal);
      case "buildInfrastructure": {
        if (!region) {
          const edge = job.edge >= 0 ? job.edge : (roads[0]?.id ?? 0);
          return [
            {
              type: "setJobTarget",
              area: single as number,
              job: { kind: "buildInfrastructure", edge },
              targetWorkers: job.workers,
            },
          ];
        }
        const evenly = splitByPopulation(
          job.workers,
          roads.map((_, i) => i),
          roads.map(() => 1),
        );
        return roads.map(({ edge, id }, i) => ({
          type: "setJobTarget",
          area: edge.areaA,
          job: { kind: "buildInfrastructure", edge: id },
          targetWorkers: evenly[i] as number,
        }));
      }
      default:
        return hire({ kind: job.kind }, job.workers, areas);
    }
  };
  const sendAll = (commands: Command[]) => {
    for (const command of commands) send(command);
  };

  // Wage offers: the population-weighted mean of the areas'; setting it sets each area.
  let weighted = 0;
  let people = 0;
  for (const area of areas) {
    const offer = government.areaStates.find((s) => s.area === area)?.wageOffer ?? 0;
    weighted += offer * (population[area] as number);
    people += population[area] as number;
  }
  // Wages are stored per worker-hour and shown per worker-day.
  const hoursPerDay = data.config.economy.hoursPerWorkerDay;
  const wageOffer = people > 0 ? weighted / people : 0;
  const averageWage =
    areas.reduce((sum, area) => sum + (snapshot.areas.wageLevel[area] as number) * (population[area] as number), 0) /
    Math.max(people, 1);

  return (
    <>
      <EmploymentSection view={view} areas={areas} label={label} />

      <Section title="Wages">
        <div className="row">
          <span>Wage offer</span>
          <NumberField
            label="Jobs wage offer"
            value={Math.round(wageOffer * hoursPerDay * 100) / 100}
            min={0}
            onChange={(offer) =>
              sendAll(areas.map((area) => ({ type: "setWageOffer", area, wageOffer: offer / hoursPerDay })))
            }
          />
          <span className="muted">
            mh/day · average wage {target.realm ? "in the realm" : region ? "in the selection" : "here"}{" "}
            {fmt(averageWage * hoursPerDay)} mh/day
          </span>
        </div>
        <span className="muted">
          Workers only take government jobs paying at least the average wage where they live.
        </span>
      </Section>

      <Section title="Jobs">
        {groups.size === 0 && <span className="muted">No government jobs here.</span>}
        {[...groups.values()].map((group) => (
          <JobLine
            key={JSON.stringify(group.job)}
            group={group}
            title={describeJob(group.job, group.areas[0] as number)}
            onTarget={(total) => sendAll(hire(group.job, total, group.areas))}
          />
        ))}
      </Section>

      <Section title="New job">
        <div className="row">
          <Select label="Job" value={job.kind} options={kinds} onChange={(kind) => setJob({ ...job, kind })} />
          {job.kind === "produce" && (
            <Select
              label="Job good"
              value={job.good}
              options={data.goods.filter((g) => !g.isService).map((g) => ({ value: g.id, label: g.name }))}
              onChange={(good) => setJob({ ...job, good })}
            />
          )}
          {job.kind === "buildInfrastructure" && !region && (
            <Select
              label="Road"
              value={job.edge >= 0 ? job.edge : (roads[0]?.id ?? 0)}
              options={roads.map(({ id }) => ({
                value: id,
                label: `to ${areaName(data, otherEnd(id, single as number))}`,
              }))}
              onChange={(edge) => setJob({ ...job, edge })}
            />
          )}
        </div>
        <div className="row">
          <NumberField
            label="New job workers"
            value={job.workers}
            min={0}
            onChange={(workers) => setJob({ ...job, workers })}
          />
          <button type="button" className="primary" onClick={() => sendAll(hireNew())}>
            Hire
          </button>
          {region && <span className="muted">in total, split over the areas by population</span>}
        </div>
      </Section>
    </>
  );
}

/** One job across its areas: workers against the target, and a new total target. */
function JobLine({ group, title, onTarget }: { group: JobGroup; title: string; onTarget: (total: number) => void }) {
  const [target, setTarget] = useState(group.target);
  useEffect(() => setTarget(group.target), [group.target]);
  return (
    <div className="list-item" data-testid="job">
      <div className="row" style={{ justifyContent: "space-between" }}>
        <span>
          {title}
          {group.areas.length > 1 ? ` · ${group.areas.length} areas` : ""}
        </span>
        <span className="muted">
          {count(group.workers)} / {count(group.target)} workers
        </span>
      </div>
      <div className="row">
        <NumberField label="Target workers" value={group.target} min={0} onChange={setTarget} />
        <button type="button" onClick={() => onTarget(target)}>
          Set
        </button>
        <button type="button" onClick={() => onTarget(0)}>
          Stop
        </button>
      </div>
    </div>
  );
}

/** Who works at what, as a share bar (private, government, unemployed) and a table of private jobs by good. */
function EmploymentSection({ view, areas, label }: { view: View; areas: number[]; label: string }) {
  const { data, snapshot, government } = view;
  const employment = employmentOf(data, snapshot, government, areas);
  const total = employment.privateTotal + employment.government + employment.unemployed;
  const parts = [
    { label: "Private jobs", value: employment.privateTotal, color: PRIVATE_COLOR },
    { label: "Government jobs", value: employment.government, color: GOVERNMENT_COLOR },
    { label: "Unemployed", value: employment.unemployed, color: UNEMPLOYED_COLOR },
  ];
  const rows = data.goods
    .map((good) => ({
      good,
      workers: employment.privateWorkers[good.id] as number,
      output: employment.producedPerDay[good.id] as number,
    }))
    .filter((row) => row.workers >= 0.5 || row.output > 1e-6)
    .sort((a, b) => b.workers - a.workers);
  const most = Math.max(1, ...rows.map((row) => row.workers));

  return (
    <Section title="Employment" actions={<span className="muted">{label}</span>}>
      <div className="share-bar" data-testid="employment-bar" role="img" aria-label="Workforce by kind of job">
        {parts
          .filter((part) => part.value > 0)
          .map((part) => (
            <span
              key={part.label}
              style={{ flexGrow: part.value, background: part.color }}
              title={`${part.label}: ${count(part.value)} (${pct(part.value / total)})`}
            />
          ))}
      </div>
      <div className="share-legend">
        {parts.map((part) => (
          <span key={part.label}>
            <span className="swatch" style={{ background: part.color }} />
            {part.label} {count(part.value)} · {total > 0 ? pct(part.value / total) : "—"}
          </span>
        ))}
      </div>
      <table>
        <thead>
          <tr>
            <th>Private job</th>
            <th className="num">Workers</th>
            <th aria-label="Share of private workers" />
            <th className="num" title="Units produced per day, government output included">
              Output/day
            </th>
            <th className="num">Per worker</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ good, workers, output }) => (
            <tr key={good.id}>
              <td title={good.unit}>{good.name}</td>
              <td className="num">{count(workers)}</td>
              <td style={{ width: "22%" }}>
                <div className="inline-bar" style={{ width: `${(100 * workers) / most}%` }} />
              </td>
              <td className="num">{fmt(output)}</td>
              <td className="num">{workers >= 0.5 ? fmt(output / workers) : "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <span className="hint">Output per day in each good's unit; per worker is output over private workers.</span>
    </Section>
  );
}
