// The player's armies: recruit, supply, stance, move and disband; foreign armies are listed for awareness.
import type { Army } from "@geonomics/sim";
import { useState } from "react";
import { useGame } from "../../state/store";
import { fmt, NumberField, Section, Select, Swatch } from "../components";
import { AreaLink, areaName, ownedOptions, useSend, useView } from "./common";

export function ArmiesPanel() {
  const view = useView();
  const send = useSend();
  const selected = useGame((state) => state.selectedArea);
  const selectedArmy = useGame((state) => state.selectedArmy);
  const selectArmy = useGame((state) => state.selectArmy);
  const setMode = useGame((state) => state.setMode);
  const [recruit, setRecruit] = useState({ area: -1, soldiers: 500 });
  if (!view) return null;
  const { snapshot, government, data } = view;
  const own = snapshot.armies.filter((army) => army.owner === government.id);
  const foreign = snapshot.armies.filter((army) => army.owner !== government.id);
  const recruitArea =
    recruit.area >= 0
      ? recruit.area
      : selected !== null && government.ownedAreas.includes(selected)
        ? selected
        : (government.capital ?? 0);

  return (
    <>
      <Section title="Recruit">
        <div className="row">
          <Select
            label="Recruit in"
            value={recruitArea}
            options={ownedOptions(view)}
            onChange={(area) => setRecruit({ ...recruit, area })}
          />
          <NumberField
            label="Recruits"
            value={recruit.soldiers}
            min={1}
            onChange={(soldiers) => setRecruit({ ...recruit, soldiers })}
          />
          <button
            type="button"
            className="primary"
            onClick={() => send({ type: "recruitArmy", area: recruitArea, soldiers: recruit.soldiers })}
          >
            Recruit
          </button>
        </div>
        <span className="muted">
          Recruits leave the workforce. Supply them with {data.goods[data.config.military.foodGood]?.name} and{" "}
          {data.goods[data.config.military.weaponsGood]?.name} from the depot.
        </span>
      </Section>

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
                {fmt(army.soldiers)} soldiers of {snapshot.governments[army.owner]?.name} at{" "}
                {areaName(data, army.location.kind === "area" ? army.location.area : army.location.from)}
              </span>
            </div>
          ))}
        </Section>
      )}
    </>
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
  const [supply, setSupply] = useState({ food: 100, weapons: 100 });
  if (!view) return null;
  const { data } = view;
  const at = army.location.kind === "area" ? army.location.area : army.location.from;
  const days = army.food / Math.max(army.soldiers * data.config.military.foodPerSoldierPerDay, 1e-9);
  const canSupply = army.location.kind === "area" && view.government.ownedAreas.includes(at);

  return (
    <div className="list-item" data-testid="army">
      <div className="row" style={{ justifyContent: "space-between" }}>
        <button type="button" className="link" onClick={onSelect}>
          {selected ? "▸ " : ""}Army {army.id}: {fmt(army.soldiers)} soldiers
        </button>
        <span className="muted">{army.stance}</span>
      </div>
      <span className="muted">
        {army.location.kind === "area" ? "in " : "marching from "}
        <AreaLink area={at} />
        {army.path.length > 0 ? ` → ${areaName(data, army.path.at(-1) as number)}` : ""} · food {fmt(days)} days ·
        weapons {fmt(army.weapons)}
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
      {canSupply && (
        <div className="row">
          <NumberField
            label="Food to load"
            value={supply.food}
            min={0}
            onChange={(food) => setSupply({ ...supply, food })}
          />
          <NumberField
            label="Weapons to load"
            value={supply.weapons}
            min={0}
            onChange={(weapons) => setSupply({ ...supply, weapons })}
          />
          <button
            type="button"
            onClick={() => send({ type: "supplyArmy", army: army.id, food: supply.food, weapons: supply.weapons })}
          >
            Load
          </button>
        </div>
      )}
    </div>
  );
}
