// The government's depots in the chosen areas, goods on their way between depots, and sending more.
import { useState } from "react";
import { fmt, NumberField, Section, Select } from "../components";
import { AreaLink, goodOptions, ownedOptions, useSend, useView } from "./common";

/** Depot contents summed over the player's areas among `areas`; nothing when it holds none of them. */
export function Depots({ areas }: { areas: number[] }) {
  const view = useView();
  const send = useSend();
  const [transfer, setTransfer] = useState({ from: -1, to: -1, good: 0, quantity: 10 });
  if (!view) return null;
  const { data, government } = view;
  const own = areas.filter((area) => government.ownedAreas.includes(area));
  if (own.length === 0) return null;
  const held = new Float64Array(data.goods.length);
  for (const state of government.areaStates) {
    if (!own.includes(state.area)) continue;
    for (let g = 0; g < held.length; g++) held[g] = (held[g] as number) + (state.depot[g] as number);
  }
  const goods = data.goods.filter((good) => (held[good.id] as number) > 0.01);
  const owned = ownedOptions(view);
  const from = transfer.from >= 0 ? transfer.from : (own[0] as number);
  const to =
    transfer.to >= 0
      ? transfer.to
      : (government.ownedAreas.find((area) => area !== from) ?? (government.ownedAreas[0] as number));
  const arriving = government.depotTransfers.filter((t) => own.includes(t.destination));
  const goodName = (g: number) => data.goods[g]?.name ?? "?";

  return (
    <Section title={own.length === 1 ? "Depot" : `Depots (${own.length} areas)`}>
      {goods.length === 0 ? (
        <span className="muted">Empty</span>
      ) : (
        <table data-testid="depot">
          <tbody>
            {goods.map((good) => (
              <tr key={good.id}>
                <td>{good.name}</td>
                <td className="num">{fmt(held[good.id] as number)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <span className="hint">
        The government's goods here: bought, produced by government jobs or taken as taxes in kind.
      </span>
      {arriving.map((t) => (
        <div className="list-item" key={`${t.destination}-${t.good}-${t.daysRemaining}`}>
          {fmt(t.quantity)} {goodName(t.good)} arriving in <AreaLink area={t.destination} /> in{" "}
          {fmt(Math.max(0, t.daysRemaining))} days
        </div>
      ))}
      {owned.length > 1 && (
        <>
          <div className="row">
            <Select
              label="From"
              value={from}
              options={owned}
              onChange={(value) => setTransfer({ ...transfer, from: value })}
            />
            <span>→</span>
            <Select
              label="To"
              value={to}
              options={owned}
              onChange={(value) => setTransfer({ ...transfer, to: value })}
            />
          </div>
          <div className="row">
            <Select
              label="Transfer good"
              value={transfer.good}
              options={goodOptions(data, true)}
              onChange={(good) => setTransfer({ ...transfer, good })}
            />
            <NumberField
              label="Transfer quantity"
              value={transfer.quantity}
              min={0}
              onChange={(quantity) => setTransfer({ ...transfer, quantity })}
            />
            <button
              type="button"
              onClick={() =>
                send({ type: "transferGoods", from, to, good: transfer.good, quantity: transfer.quantity })
              }
            >
              Send
            </button>
          </div>
        </>
      )}
    </Section>
  );
}
