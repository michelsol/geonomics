// The player's armies: pay, recruiting, weapons, stance, moves and disbanding; foreign armies for awareness.
import type { Army, GovernmentView } from "@geonomics/sim";
import { useState } from "react";
import { actionTarget, realmWageLevel, splitByPopulation } from "../../state/selectors";
import { useGame } from "../../state/store";
import { count, fmt, NumberField, pct, Section, Stat, Swatch } from "../components";
import { AreaLink, areaName, NoOwnArea, useSend, useView } from "./common";

/**
 * Where recruits and weapon purchases go: the selection's own areas, split by population, or the capital when the
 * actions are realm-wide, since an army spread over the whole realm would be dozens of small ones.
 */
function placesFor(government: GovernmentView, selection: readonly number[]): number[] {
  const target = actionTarget(government, selection);
  if (!target.realm) return target.areas; // none when the selection holds none of the player's areas
  const capital = government.capital ?? government.ownedAreas[0];
  return capital === undefined ? [] : [capital];
}

/** Text saying where `placesFor` puts things. */
function placesText(data: { areas: readonly { name: string }[] }, places: number[]): string {
  return places.length === 1
    ? `in ${data.areas[places[0] as number]?.name ?? "?"}`
    : `split over the ${places.length} selected areas by population, one per area`;
}

export function ArmiesPanel() {
  const view = useView();
  const send = useSend();
  const selection = useGame((state) => state.selection);
  const selectedArmy = useGame((state) => state.selectedArmy);
  const selectArmy = useGame((state) => state.selectArmy);
  const setMode = useGame((state) => state.setMode);
  const [recruits, setRecruits] = useState(500);
  if (!view) return null;
  const { snapshot, government, data } = view;
  const own = snapshot.armies.filter((army) => army.owner === government.id);
  const foreign = snapshot.armies.filter((army) => army.owner !== government.id);
  const places = placesFor(government, selection);
  // Recruits for several areas are split over them by population: one army per area that gets any.
  const recruitIn = (soldiers: number) => {
    splitByPopulation(soldiers, places, snapshot.areas.population).forEach((part, i) => {
      if (part >= 1) send({ type: "recruitArmy", area: places[i] as number, soldiers: part });
    });
  };
  const soldiers = own.reduce((sum, army) => sum + army.soldiers, 0);
  // Wages are stored per soldier-hour and shown per day.
  const hoursPerDay = data.config.economy.hoursPerWorkerDay;
  const averageWage = realmWageLevel(snapshot) * hoursPerDay;
  const wage = government.soldierWage * hoursPerDay;
  const bill = soldiers * wage;

  return (
    <>
      <Section title="Soldiers">
        <div className="row">
          {places.length > 0 && <NumberField label="Recruits" value={recruits} min={1} onChange={setRecruits} />}
          <span className="muted">{places.length > 0 ? "soldiers at" : "Soldiers are paid"}</span>
          <span
            className="row"
            title="Paid to every soldier of the realm. Soldiers desert when paid less than the realm's average income, or when the treasury cannot pay them."
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
              title={`Recruits form an army ${placesText(data, places)}, and leave the workforce there.`}
              onClick={() => recruitIn(recruits)}
            >
              Recruit
            </button>
          )}
        </div>
        {places.length === 0 && <NoOwnArea />}
        <div className="stats">
          <Stat label="Soldiers" value={count(soldiers)} />
          <Stat label="Pay per day" value={`${fmt(bill)} mh`} testId="army-bill" />
          <Stat
            label="Realm average income"
            value={`${fmt(averageWage)} mh/day`}
            title="Weighted by population. Soldiers paid less than this desert."
          />
        </div>
      </Section>

      <Weapons />

      <Section title="Your armies">
        {own.length === 0 && <span className="muted">No armies.</span>}
        {own.map((army) => (
          <ArmyCard
            key={army.id}
            army={army}
            selected={army.id === selectedArmy}
            onSelect={() => selectArmy(army.id === selectedArmy ? null : army.id)}
            onMove={() => setMode({ kind: "moveArmy", army: army.id })}
          />
        ))}
      </Section>

      {foreign.length > 0 && (
        <Section title="Other armies">
          {foreign.map((army) => (
            <div className="list-item" key={army.id}>
              <span>
                <Swatch color={snapshot.governments[army.owner]?.color ?? "#fff"} />
                {count(army.soldiers)} soldiers of {snapshot.governments[army.owner]?.name} at{" "}
                {areaName(data, army.location.kind === "area" ? army.location.area : army.location.from)}
              </span>
            </div>
          ))}
        </Section>
      )}
    </>
  );
}

/** Weapons held in the depots, and a shortcut to buy more on an area's market. */
function Weapons() {
  const view = useView();
  const send = useSend();
  const selection = useGame((state) => state.selection);
  const [buy, setBuy] = useState({ quantity: 500, limit: -1 });
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
  const places = placesFor(government, selection);
  const limit = buy.limit >= 0 ? buy.limit : Math.round(2 * good.laborValue * 100) / 100;

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
      {places.length === 0 ? (
        <NoOwnArea />
      ) : (
        <div className="row">
          <NumberField
            label="Weapons to buy"
            value={buy.quantity}
            min={0}
            onChange={(quantity) => setBuy({ ...buy, quantity })}
          />
          <NumberField
            label="Weapons limit price"
            value={limit}
            min={0}
            onChange={(value) => setBuy({ ...buy, limit: value })}
          />
          <button
            type="button"
            title={`Bought ${placesText(data, places)}, into the depots there.`}
            onClick={() =>
              splitByPopulation(buy.quantity, places, view.snapshot.areas.population).forEach((quantity, i) => {
                if (quantity < 1) return;
                send({
                  type: "placeMarketOrder",
                  order: {
                    area: places[i] as number,
                    good: weapons,
                    side: "buy",
                    remainingQuantity: quantity,
                    limitPrice: limit,
                    maximumQuantityPerDay: Math.max(1, quantity / 5),
                  },
                });
              })
            }
          >
            Buy
          </button>
        </div>
      )}
      <span className="hint">
        Nobody else uses {good.name.toLowerCase()}, so producers start making them once you buy (labor value{" "}
        {fmt(good.laborValue)} mh). Armies standing in your areas take them from the local depot, one per soldier; an
        equipped soldier fights twice as hard.
      </span>
    </Section>
  );
}

function ArmyCard({
  army,
  selected,
  onSelect,
  onMove,
}: {
  army: Army;
  selected: boolean;
  onSelect: () => void;
  onMove: () => void;
}) {
  const view = useView();
  const send = useSend();
  if (!view) return null;
  const { data } = view;
  const at = army.location.kind === "area" ? army.location.area : army.location.from;
  const equipment = Math.min(1, army.weapons / Math.max(army.soldiers, 1e-9));

  return (
    <div className="list-item" data-testid="army">
      <div className="row" style={{ justifyContent: "space-between" }}>
        <button type="button" className="link" onClick={onSelect}>
          {selected ? "▸ " : ""}Army {army.id}: {count(army.soldiers)} soldiers
        </button>
        <span className="muted">{army.stance}</span>
      </div>
      <span className="muted">
        {army.location.kind === "area" ? "in " : "marching from "}
        <AreaLink area={at} />
        {army.path.length > 0 ? ` → ${areaName(data, army.path.at(-1) as number)}` : ""} · equipped {pct(equipment)} ·
        power {count(army.soldiers * (1 + equipment))}
      </span>
      <div className="row">
        <button type="button" onClick={onMove}>
          Move
        </button>
        <button
          type="button"
          onClick={() =>
            send({ type: "setArmyStance", army: army.id, stance: army.stance === "hold" ? "attack" : "hold" })
          }
        >
          {army.stance === "hold" ? "Attack" : "Hold"}
        </button>
        <button
          type="button"
          className="danger"
          onClick={() => send({ type: "disbandArmy", army: army.id, soldiers: army.soldiers })}
        >
          Disband
        </button>
      </div>
    </div>
  );
}
