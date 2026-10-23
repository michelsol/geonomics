// Relations with every government, war declarations and peace proposals.
import type { PeaceProposal } from "@geonomics/sim";
import { useState } from "react";
import { useGame } from "../../state/store";
import { fmt, NumberField, Section, Select, Swatch } from "../components";
import { controllerLabel } from "../Players";
import { areaName, useSend, useView } from "./common";

export function DiplomacyPanel() {
  const view = useView();
  const send = useSend();
  const peaceAreas = useGame((state) => state.peaceAreas);
  const setMode = useGame((state) => state.setMode);
  const players = useGame((state) => state.session.players);
  const [target, setTarget] = useState(-1);
  const [payment, setPayment] = useState(0);
  const [days, setDays] = useState(30);
  if (!view) return null;
  const { snapshot, government, data } = view;
  const me = government.id;
  const others = snapshot.governments.filter((g) => g.id !== me && !g.isEliminated);
  const atWar = others.filter((g) => snapshot.relations[me]?.[g.id] === "war");
  const peaceTarget = target >= 0 && atWar.some((g) => g.id === target) ? target : (atWar[0]?.id ?? -1);
  const transfers = peaceAreas
    .map((area) => {
      const owner = snapshot.areas.owner[area] as number;
      return owner === me ? { area, newOwner: peaceTarget } : owner === peaceTarget ? { area, newOwner: me } : null;
    })
    .filter((t): t is { area: number; newOwner: number } => t !== null);
  const name = (id: number) => snapshot.governments[id]?.name ?? `#${id}`;
  const describeProposal = (p: PeaceProposal) => {
    const gives = p.areaTransfers.filter((t) => t.newOwner === p.to).map((t) => areaName(data, t.area));
    const takes = p.areaTransfers.filter((t) => t.newOwner === p.from).map((t) => areaName(data, t.area));
    return [
      gives.length > 0 ? `cedes ${gives.join(", ")}` : null,
      takes.length > 0 ? `takes ${takes.join(", ")}` : null,
      p.payment !== 0 ? (p.payment > 0 ? `pays ${fmt(p.payment)}` : `demands ${fmt(-p.payment)}`) : null,
    ]
      .filter(Boolean)
      .join(", ");
  };

  return (
    <>
      <Section title="Relations">
        {others.map((g) => {
          const relation = snapshot.relations[me]?.[g.id] ?? "peace";
          return (
            <div
              className="row"
              key={g.id}
              style={{ justifyContent: "space-between" }}
              data-testid={`relation-${g.id}`}
            >
              <span>
                <Swatch color={g.color} />
                {g.name}{" "}
                <span className="muted">
                  {controllerLabel(g, players)} · {g.areaCount} areas
                </span>
              </span>
              {relation === "war" ? (
                <strong style={{ color: "var(--danger)" }}>at war</strong>
              ) : (
                <button type="button" className="danger" onClick={() => send({ type: "declareWar", target: g.id })}>
                  Declare war
                </button>
              )}
            </div>
          );
        })}
      </Section>

      <Section title="Proposals">
        {snapshot.peaceProposals.length === 0 && <span className="muted">None.</span>}
        {snapshot.peaceProposals
          .filter((p) => p.to === me || p.from === me)
          .map((p) => (
            <div className="list-item" key={p.id}>
              <span>
                {p.from === me ? `To ${name(p.to)}` : `From ${name(p.from)}`}: peace
                {describeProposal(p) ? `; ${p.from === me ? "you" : name(p.from)} ${describeProposal(p)}` : ""}
              </span>
              <span className="muted">expires on day {Math.floor(p.expiresAtDay)}</span>
              {p.to === me && (
                <div className="row">
                  <button
                    type="button"
                    className="primary"
                    onClick={() => send({ type: "answerPeace", proposalId: p.id, accept: true })}
                  >
                    Accept
                  </button>
                  <button type="button" onClick={() => send({ type: "answerPeace", proposalId: p.id, accept: false })}>
                    Refuse
                  </button>
                </div>
              )}
            </div>
          ))}
      </Section>

      {atWar.length > 0 && (
        <Section title="Propose peace">
          <div className="row">
            <Select
              label="Peace with"
              value={peaceTarget}
              options={atWar.map((g) => ({ value: g.id, label: g.name }))}
              onChange={setTarget}
            />
            <NumberField label="Payment" value={payment} onChange={setPayment} />
            <NumberField label="Expires in days" value={days} min={1} onChange={setDays} />
          </div>
          <span className="muted">Payment you make (negative to demand one) · days to answer</span>
          <div className="row">
            <button type="button" onClick={() => setMode({ kind: "pickPeaceAreas" })}>
              Pick areas on the map
            </button>
            <span className="muted">
              {transfers.length === 0
                ? "No areas"
                : transfers.map((t) => `${areaName(data, t.area)} → ${name(t.newOwner)}`).join(", ")}
            </span>
          </div>
          <button
            type="button"
            className="primary"
            onClick={() =>
              send({
                type: "proposePeace",
                proposal: {
                  from: me,
                  to: peaceTarget,
                  areaTransfers: transfers,
                  payment,
                  expiresAtDay: snapshot.gameDay + days,
                },
              })
            }
          >
            Propose
          </button>
        </Section>
      )}
    </>
  );
}
