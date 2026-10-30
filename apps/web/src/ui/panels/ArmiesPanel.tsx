// The player's soldiers: pay and recruiting for the realm; weapons in the depots; the soldiers in the selection, moved
// or sent home by share; other realms' armies in the selection.
import type { Army, GovernmentView } from "@geonomics/sim";
import { type CSSProperties, useState } from "react";
import { actionTarget, armiesIn, armyArea, realmAverageWage, splitByPopulation } from "../../state/selectors";
import { useGame } from "../../state/store";
import { count, fmt, NumberField, pct, Section, Stat, Swatch } from "../components";
import { AreaLink, NoOwnArea, scaledAmount, useSend, useView } from "./common";

/** Armies listed one per line, the largest first, before the rest are counted. */
const LISTED_ARMIES = 8;

/**
 * Where recruits go: the selection's own areas, split by population, or the capital when the action is realm-wide,
 * since an army spread over the whole realm would be dozens of small ones.
 */
function placesFor(government: GovernmentView, selection: readonly number[]): number[] {
  const target = actionTarget(government, selection);
  if (!target.realm) return target.areas; // none when the selection holds none of the player's areas
  const capital = government.capital ?? government.ownedAreas[0];
  return capital === undefined ? [] : [capital];
}

/** Text saying where `placesFor` puts recruits. */
function placesText(data: { areas: readonly { name: string }[] }, places: number[]): string {
  return places.length === 1
    ? `in ${data.areas[places[0] as number]?.name ?? "?"}`
    : `split over the ${places.length} selected areas by population, joining the army standing in each`;
}

const equipmentOf = (army: Army) => Math.min(1, army.weapons / Math.max(army.soldiers, 1e-9));

export function ArmiesPanel() {
  const view = useView();
  const send = useSend();
  const selection = useGame((state) => state.selection);
  const staticData = useGame((state) => state.data);
  const [recruits, setRecruits] = useState(() => scaledAmount(staticData, 500));
  if (!view) return null;
  const { snapshot, government, data } = view;
  const own = snapshot.armies.filter((army) => army.owner === government.id);
  const places = placesFor(government, selection);
  // Recruits for several areas are split over them by population.
  const recruitIn = (soldiers: number) => {
    splitByPopulation(soldiers, places, snapshot.areas.population).forEach((part, i) => {
      if (part >= 1) send({ type: "recruitArmy", area: places[i] as number, soldiers: part });
    });
  };
  const soldiers = own.reduce((sum, army) => sum + army.soldiers, 0);
  // Wages are stored per soldier-hour and shown per day.
  const hoursPerDay = data.config.economy.hoursPerWorkerDay;
  const averageWage = realmAverageWage(snapshot) * hoursPerDay;
  const wage = government.soldierWage * hoursPerDay;

  return (
    <>
      <Section title="Soldiers">
        <div className="row">
          {places.length > 0 && <NumberField label="Recruits" value={recruits} min={1} onChange={setRecruits} />}
          <span className="muted">{places.length > 0 ? "soldiers at" : "Soldiers are paid"}</span>
          <span
            className="row"
            title="Paid to every soldier of the realm. Soldiers desert when paid less than the realm's average private wage, or when the treasury cannot pay them."
          >
            <NumberField
              label="Soldier wage"
              value={Math.round(wage * 100) / 100}
              min={0}
              onChange={(perDay) => send({ type: "setSoldierWage", wage: perDay / hoursPerDay })}
            />
            <span className="muted">mh/day</span>
          </span>
          {places.length > 0 && (
            <button
              type="button"
              className="primary"
              title={`Recruits join the army ${placesText(data, places)}, and leave the workforce there.`}
              onClick={() => recruitIn(recruits)}
            >
              Recruit
            </button>
          )}
        </div>
        {places.length === 0 && <NoOwnArea />}
        <div className="stats">
          <Stat label="Soldiers of the realm" value={count(soldiers)} />
          <Stat label="Pay per day" value={`${fmt(soldiers * wage)} mh`} testId="army-bill" />
          <Stat
            label="Realm average private wage"
            value={`${fmt(averageWage)} mh/day`}
            title="Weighted by population. Soldiers paid less than this desert."
          />
        </div>
      </Section>

      <YourSoldiers armies={armiesIn(own, selection)} wage={wage} />

      <Weapons />

      <OtherArmies armies={armiesIn(snapshot.armies, selection).filter((army) => army.owner !== government.id)} />
    </>
  );
}

/** The player's soldiers in the selection: their figures, one line per army, and moving or disbanding a share. */
function YourSoldiers({ armies, wage }: { armies: Army[]; wage: number }) {
  const view = useView();
  const send = useSend();
  const selection = useGame((state) => state.selection);
  const share = useGame((state) => state.sendShare);
  const setShare = useGame((state) => state.setSendShare);
  const setMode = useGame((state) => state.setMode);
  if (!view) return null;
  const { snapshot, government } = view;
  const title = selection.length === 0 ? "Your soldiers" : "Your soldiers in the selection";
  if (armies.length === 0)
    return (
      <Section title={title}>
        <span className="muted" data-testid="no-soldiers">
          {selection.length === 0 ? "No soldiers." : "No soldiers of yours in the selection."}
        </span>
      </Section>
    );

  const total = armies.reduce((sum, army) => sum + army.soldiers, 0);
  const sum = (keep: (army: Army) => boolean) =>
    armies.reduce((value, army) => value + (keep(army) ? army.soldiers : 0), 0);
  const power = armies.reduce((value, army) => value + army.soldiers * (1 + equipmentOf(army)), 0);
  const marching = sum((army) => army.location.kind === "edge" || army.path.length > 0);
  const abroad = sum((army) => snapshot.areas.owner[armyArea(army)] !== government.id);
  const areas = [...new Set(armies.map(armyArea))];
  const listed = [...armies].sort((a, b) => b.soldiers - a.soldiers).slice(0, LISTED_ARMIES);
  const sent = Math.max(1, Math.round(total * share));
  const percent = Math.round(share * 100);

  return (
    <Section title={title}>
      <div className="stats">
        <Stat label="Soldiers" value={count(total)} testId="selection-soldiers" />
        <Stat
          label="Equipped"
          value={pct((power - total) / total)}
          title="Soldiers with a weapon fight twice as hard"
        />
        <Stat label="Power" value={count(power)} />
        <Stat label="Marching" value={count(marching)} />
        <Stat label="Abroad" value={count(abroad)} title="Standing in, or marching from, other realms' areas" />
        <Stat label="Pay per day" value={`${fmt(total * wage)} mh`} />
      </div>
      <div className="list">
        {listed.map((army) => (
          <div className="list-item" key={army.id} data-testid="army">
            <span>
              {count(army.soldiers)}{" "}
              {army.path.length > 0 || army.location.kind === "edge" ? (
                <>
                  marching from <AreaLink area={armyArea(army)} /> to{" "}
                  <AreaLink area={army.path.at(-1) ?? armyArea(army)} />
                </>
              ) : (
                <>
                  in <AreaLink area={armyArea(army)} />
                </>
              )}
              <span className="muted"> · equipped {pct(equipmentOf(army))}</span>
            </span>
          </div>
        ))}
        {armies.length > listed.length && <span className="muted">and {armies.length - listed.length} more</span>}
      </div>
      <div className="policy-control">
        <span className="policy-label">Share</span>
        <div className="policy-track" style={{ "--p": (percent - 5) / 95 } as CSSProperties}>
          <input
            type="range"
            aria-label="Share of soldiers"
            min={5}
            max={100}
            step={5}
            value={percent}
            onChange={(event) => setShare(Number(event.target.value) / 100)}
          />
          <span className="policy-bubble" aria-hidden="true">
            {percent}%
          </span>
        </div>
      </div>
      <div className="row">
        <button
          type="button"
          className="primary"
          title="Then click one area or more on the map, and Send. Soldiers attack the enemy areas they reach."
          onClick={() => setMode({ kind: "moveSoldiers", areas, share, soldiers: total, targets: [] })}
        >
          Move {count(sent)}
        </button>
        <button
          type="button"
          className="danger"
          title="They go back to work where they stand"
          onClick={() => send({ type: "disbandSoldiers", areas, share })}
        >
          Disband {count(sent)}
        </button>
      </div>
      <span className="hint">
        Move, then click one area or more: the soldiers spread evenly over them. A realm's armies standing in the same
        area join into one. Soldiers attack every area they stand in that belongs to a realm at war with yours, until it
        falls.
      </span>
    </Section>
  );
}

/** Weapons held in the depots, which armies standing in the player's areas take. */
function Weapons() {
  const view = useView();
  if (!view) return null;
  const { data, government } = view;
  const weapons = data.config.military.weaponsGood;
  const good = data.goods[weapons];
  if (!good) return null;
  const held = government.areaStates
    .map((state) => ({ area: state.area, quantity: state.depot[weapons] as number }))
    .filter((entry) => entry.quantity >= 0.5);
  const total = held.reduce((sum, entry) => sum + entry.quantity, 0);
  const buying = government.marketOrders.filter((order) => order.good === weapons && order.side === "buy");

  return (
    <Section title={good.name}>
      <div className="stats">
        <Stat label="In depots" value={fmt(total)} testId="weapons-held" />
        <Stat label="Being bought" value={fmt(buying.reduce((sum, order) => sum + order.remainingQuantity, 0))} />
      </div>
      {held.length > 0 && (
        <div className="muted">
          {held.map((entry, i) => (
            <span key={entry.area}>
              {i > 0 ? " · " : ""}
              <AreaLink area={entry.area} /> {fmt(entry.quantity)}
            </span>
          ))}
        </div>
      )}
      <span className="hint">
        Armies standing in your areas take {good.name.toLowerCase()} from the local depot, one per soldier; an equipped
        soldier fights twice as hard. Keep the depots stocked with a standing order (Policies tab). Nobody else uses
        them, so producers start making them once you buy (labor value {fmt(good.laborValue)} mh).
      </span>
    </Section>
  );
}

/** Other realms' armies in the selection, one line per realm. */
function OtherArmies({ armies }: { armies: Army[] }) {
  const view = useView();
  const selection = useGame((state) => state.selection);
  if (!view || armies.length === 0) return null;
  const { snapshot } = view;
  const byRealm = new Map<number, { soldiers: number; areas: Set<number> }>();
  for (const army of armies) {
    const entry = byRealm.get(army.owner) ?? { soldiers: 0, areas: new Set<number>() };
    entry.soldiers += army.soldiers;
    entry.areas.add(armyArea(army));
    byRealm.set(army.owner, entry);
  }
  return (
    <Section title={selection.length === 0 ? "Other armies" : "Other armies in the selection"}>
      {[...byRealm]
        .sort((a, b) => b[1].soldiers - a[1].soldiers)
        .map(([owner, entry]) => (
          <div className="list-item" key={owner} data-testid="other-army">
            <span>
              <Swatch color={snapshot.governments[owner]?.color ?? "#fff"} />
              {snapshot.governments[owner]?.name}: {count(entry.soldiers)} soldiers in {entry.areas.size}{" "}
              {entry.areas.size === 1 ? "area" : "areas"}
            </span>
          </div>
        ))}
    </Section>
  );
}
