// Employment in the realm or one area, and government jobs and wage offers per owned area.
import type { GovernmentJob } from "@geonomics/sim";
import { useState } from "react";
import { employmentOf } from "../../state/selectors";
import { useGame } from "../../state/store";
import { fmt, NumberField, pct, Section, Select } from "../components";
import { areaName, ownedOptions, useSend, useView } from "./common";

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
  research: "Research",
};

export function JobsPanel() {
  const view = useView();
  const send = useSend();
  const selected = useGame((state) => state.selectedArea);
  const edges = useGame((state) => state.edges);
  const selectArea = useGame((state) => state.selectArea);
  const [job, setJob] = useState({ kind: "research" as JobKind, good: 0, edge: -1, workers: 100 });
  if (!view) return null;
  const { data, government } = view;
  const area = selected !== null && government.ownedAreas.includes(selected) ? selected : government.capital;
  if (area === null) return <p className="muted">You hold no area.</p>;
  const state = government.areaStates.find((s) => s.area === area);
  if (!state) return null;
  const roads = edges
    .map((edge, id) => ({ edge, id }))
    .filter(({ edge }) => edge.mode === "land" && (edge.areaA === area || edge.areaB === area))
    .map(({ edge, id }) => ({
      value: id,
      label: `to ${areaName(data, edge.areaA === area ? edge.areaB : edge.areaA)}`,
    }));
  const kinds = (Object.keys(JOB_LABELS) as JobKind[])
    .filter((kind) => kind !== "buildPort" || data.areas[area]?.isCoastal)
    .filter((kind) => kind !== "buildInfrastructure" || roads.length > 0)
    .map((kind) => ({ value: kind, label: JOB_LABELS[kind] }));
  const describeJob = (j: GovernmentJob) =>
    j.kind === "produce"
      ? `Produce ${data.goods[j.good]?.name}`
      : j.kind === "buildInfrastructure"
        ? `Road to ${areaName(data, (edges[j.edge]?.areaA === area ? edges[j.edge]?.areaB : edges[j.edge]?.areaA) ?? 0)}`
        : JOB_LABELS[j.kind];
  const buildJob = (): GovernmentJob => {
    switch (job.kind) {
      case "produce":
        return { kind: "produce", good: job.good };
      case "buildInfrastructure":
        return { kind: "buildInfrastructure", edge: job.edge >= 0 ? job.edge : (roads[0]?.value ?? 0) };
      default:
        return { kind: job.kind };
    }
  };

  return (
    <>
      <Section title="Area">
        <Select label="Jobs area" value={area} options={ownedOptions(view)} onChange={selectArea} />
      </Section>

      <EmploymentSection area={area} />

      <Section title="Wages">
        <div className="row">
          <span>Wage offer</span>
          <NumberField
            label="Jobs wage offer"
            value={state.wageOffer}
            min={0}
            onChange={(wageOffer) => send({ type: "setWageOffer", area, wageOffer })}
          />
          <span className="muted">average wage here {fmt(view.snapshot.areas.wageLevel[area] as number)}</span>
        </div>
        <span className="muted">Workers only take government jobs paying at least the average wage here.</span>
      </Section>

      <Section title="Jobs">
        {state.jobs.length === 0 && <span className="muted">No government jobs here.</span>}
        {state.jobs.map((assignment) => (
          <div className="list-item" key={JSON.stringify(assignment.job)}>
            <div className="row" style={{ justifyContent: "space-between" }}>
              <span>{describeJob(assignment.job)}</span>
              <span className="muted">
                {fmt(assignment.workers)} / {fmt(assignment.targetWorkers)} workers
              </span>
            </div>
            <div className="row">
              <NumberField
                label="Target workers"
                value={assignment.targetWorkers}
                min={0}
                onChange={(targetWorkers) => send({ type: "setJobTarget", area, job: assignment.job, targetWorkers })}
              />
              <button
                type="button"
                onClick={() => send({ type: "setJobTarget", area, job: assignment.job, targetWorkers: 0 })}
              >
                Stop
              </button>
            </div>
          </div>
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
          {job.kind === "buildInfrastructure" && (
            <Select
              label="Road"
              value={job.edge >= 0 ? job.edge : (roads[0]?.value ?? 0)}
              options={roads}
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
          <button
            type="button"
            className="primary"
            onClick={() => send({ type: "setJobTarget", area, job: buildJob(), targetWorkers: job.workers })}
          >
            Hire
          </button>
        </div>
      </Section>
    </>
  );
}

/** Who works at what, as a share bar (private, government, unemployed) and a table of private jobs by good. */
function EmploymentSection({ area }: { area: number }) {
  const view = useView();
  const [scope, setScope] = useState<"area" | "realm">("area");
  if (!view) return null;
  const { data, snapshot, government } = view;
  const areas = scope === "realm" ? government.ownedAreas : [area];
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
    <Section
      title="Employment"
      actions={
        <Select
          label="Employment scope"
          value={scope}
          options={[
            { value: "area", label: areaName(data, area) },
            { value: "realm", label: "Whole realm" },
          ]}
          onChange={setScope}
        />
      }
    >
      <div className="share-bar" data-testid="employment-bar" role="img" aria-label="Workforce by kind of job">
        {parts
          .filter((part) => part.value > 0)
          .map((part) => (
            <span
              key={part.label}
              style={{ flexGrow: part.value, background: part.color }}
              title={`${part.label}: ${fmt(part.value)} (${pct(part.value / total)})`}
            />
          ))}
      </div>
      <div className="share-legend">
        {parts.map((part) => (
          <span key={part.label}>
            <span className="swatch" style={{ background: part.color }} />
            {part.label} {fmt(part.value)} · {total > 0 ? pct(part.value / total) : "—"}
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
              <td className="num">{fmt(workers)}</td>
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
