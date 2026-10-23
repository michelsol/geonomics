// The selected area, or the totals of several (specification §10, Selection): public figures, defense, resources, a
// sortable market table, the depot, and one good across the world.
import { useState } from "react";
import { mapControls } from "../../map/MapView";
import {
  capacityMaximum,
  conquestEstimate,
  detailOf,
  policiesInForce,
  priceOf,
  selectionSummary,
} from "../../state/selectors";
import { useGame } from "../../state/store";
import { count, fmt, pct, Section, Stat, Swatch } from "../components";
import { AreaLink, type PanelProps, usePublicView } from "./common";
import { Depots } from "./Depots";
import { GoodSection } from "./GoodSection";

const WAGE_HINT = "Mean value added per private worker-hour, weighted by workers, in man-hours (not a median).";

export function AreaPanel({ onOpen }: PanelProps) {
  const view = usePublicView();
  const area = useGame((state) => state.selectedArea);
  const selection = useGame((state) => state.selection);
  if (!view) return <p className="muted">Waiting for the first snapshot…</p>;
  if (selection.length > 1) return <RegionView areas={selection} />;
  if (area === null)
    return (
      <>
        <p className="muted">Click an area on the map.</p>
        <SelectionHint />
      </>
    );
  const { data, snapshot, government } = view;
  const static_ = data.areas[area];
  if (!static_) return null;
  const owner = snapshot.areas.owner[area] as number;
  const ownerSummary = owner >= 0 ? snapshot.governments[owner] : undefined;
  const own = government !== null && owner === government.id;
  const detail = detailOf(snapshot, area);
  const siege = snapshot.areas.siegeProgress[area] as number;
  const days = data.config.pace.gameDaysPerTick;
  const resources = data.goods.filter((good) => good.isPrimary && capacityMaximum(data, area, good.id) > 0);
  const headTax = government ? policiesInForce(government, area, data.goods.length)?.headTaxPerPersonPerDay : undefined;

  return (
    <>
      <Section
        title="Area"
        actions={
          <>
            <SelectRealm />
            <button type="button" onClick={() => mapControls.renderer?.centerOn(area)}>
              Center
            </button>
          </>
        }
      >
        <h2 data-testid="area-name">{static_.name}</h2>
        <div className="muted">
          {ownerSummary ? (
            <>
              <Swatch color={ownerSummary.color} />
              {ownerSummary.name}
              {own ? " (you)" : ""}
            </>
          ) : (
            "Neutral"
          )}{" "}
          · {static_.terrain}
          {static_.isCoastal ? " · coast" : ""}
        </div>
        <div className="stats">
          <Stat label="Population" value={count(snapshot.areas.population[area] as number)} testId="population" />
          <Stat label="Average wage" value={fmt(snapshot.areas.wageLevel[area] as number)} />
          <Stat label="Necessities met" value={pct(snapshot.areas.necessitySatisfaction[area] as number)} />
          <Stat label="Satisfaction" value={pct(snapshot.areas.satisfaction[area] as number)} />
          <Stat
            label="Port · airport · fort"
            value={`${snapshot.areas.portLevel[area]} · ${snapshot.areas.airportLevel[area]} · ${snapshot.areas.fortificationLevel[area]}`}
          />
          {detail && (
            <Stat
              label="Savings per person"
              value={`${fmt(detail.savings / Math.max(snapshot.areas.population[area] as number, 1))} mh`}
              title="Average private savings per inhabitant, in man-hours"
            />
          )}
          {detail && <Stat label="Unemployed" value={count(detail.unemployedWorkers)} />}
          {siege > 0 && <Stat label="Siege" value={pct(siege)} />}
        </div>
        <p className="hint">Average wage: {WAGE_HINT}</p>
        {own && headTax !== undefined && (
          <div className="row hint">
            Head tax here: {fmt(headTax)} mh per person per day.
            <button type="button" className="link" onClick={() => onOpen("policies")}>
              Taxes are set in Policies
            </button>
          </div>
        )}
      </Section>

      <Defense area={area} own={own} />

      <Section title="Natural resources">
        {resources.length === 0 ? (
          <span className="muted">None: every primary good must be brought in.</span>
        ) : (
          <table data-testid="resources">
            <thead>
              <tr>
                <th>Good</th>
                <th className="num" title="Largest extraction per day, before depletion">
                  Capacity
                </th>
                {detail && (
                  <>
                    <th className="num" title="Capacity left after depletion">
                      Now
                    </th>
                    <th className="num">Extracted</th>
                    <th className="num">Use</th>
                  </>
                )}
              </tr>
            </thead>
            <tbody>
              {resources.map((good) => {
                const maximum = capacityMaximum(data, area, good.id);
                const now = detail ? (detail.naturalCapacity[good.id] as number) : maximum;
                const extracted = detail ? (detail.produced[good.id] as number) / days : 0;
                return (
                  <tr key={good.id}>
                    <td title={good.unit}>{good.name}</td>
                    <td className="num">{fmt(maximum)}</td>
                    {detail && (
                      <>
                        <td className="num">{fmt(now)}</td>
                        <td className="num">{fmt(extracted)}</td>
                        <td className="num">{now > 0 ? pct(extracted / now) : "—"}</td>
                      </>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        <span className="hint">Units per day. See a good across the map with the Resources layer.</span>
      </Section>

      <MarketTable areas={[area]} />
      <Depots areas={[area]} />
      <GoodSection />
      <SelectionHint />
    </>
  );
}

function SelectionHint() {
  return (
    <p className="hint">
      Double-click or double-tap the map to draw a region: tap its corners, then the first one again. Shift-click adds
      or removes one area.
    </p>
  );
}

/** Selects every area of the player's realm, for its totals and realm-wide actions. */
function SelectRealm() {
  const owned = useGame((state) => state.snapshot?.government?.ownedAreas);
  const selectAreas = useGame((state) => state.selectAreas);
  if (!owned || owned.length < 2) return null;
  return (
    <button type="button" onClick={() => selectAreas(owned)}>
      My realm
    </button>
  );
}

/** Several selected areas: their totals and population-weighted means. */
function RegionView({ areas }: { areas: number[] }) {
  const view = usePublicView();
  const table = useGame((state) => state.priceTable);
  const selectArea = useGame((state) => state.selectArea);
  if (!view) return null;
  const { data, snapshot, government } = view;
  const summary = selectionSummary(data, snapshot, table, areas);
  const centroid = areas.reduce(
    (sum, area) => ({ x: sum.x + (data.areas[area]?.x ?? 0), y: sum.y + (data.areas[area]?.y ?? 0) }),
    { x: 0, y: 0 },
  );
  // The foreign area that takes the most to conquer.
  let hardest: { area: number; equipped: number } | null = null;
  for (const area of areas) {
    if (government && snapshot.areas.owner[area] === government.id) continue;
    const equipped = conquestEstimate(data, snapshot, area).equippedNeeded;
    if (!hardest || equipped > hardest.equipped) hardest = { area, equipped };
  }
  const resources = data.goods.filter((good) => good.isPrimary && (summary.capacity[good.id] as number) > 0);
  const partial = summary.withDetail < areas.length;

  return (
    <>
      <Section
        title="Selection"
        actions={
          <>
            <SelectRealm />
            <button
              type="button"
              onClick={() => mapControls.renderer?.centerOnPoint(centroid.x / areas.length, centroid.y / areas.length)}
            >
              Center
            </button>
            <button type="button" onClick={() => selectArea(null)}>
              Clear
            </button>
          </>
        }
      >
        <h2 data-testid="selection-name">{count(areas.length)} areas</h2>
        <div className="row muted">
          {summary.owners.map(({ owner, areas: n }) => {
            const realm = owner >= 0 ? snapshot.governments[owner] : undefined;
            return (
              <span key={owner}>
                {realm && <Swatch color={realm.color} />}
                {realm ? realm.name : "Neutral"}
                {government && owner === government.id ? " (you)" : ""} · {n}
              </span>
            );
          })}
        </div>
        <div className="stats">
          <Stat label="Population" value={count(summary.population)} testId="selection-population" />
          <Stat label="Average wage" value={fmt(summary.wageLevel)} />
          <Stat label="Necessities met" value={pct(summary.necessitySatisfaction)} />
          <Stat label="Satisfaction" value={pct(summary.satisfaction)} />
          <Stat label="Militia" value={count(summary.militia)} />
          {summary.withDetail > 0 && <Stat label="Savings" value={`${fmt(summary.savings)} mh`} />}
          {summary.withDetail > 0 && <Stat label="Unemployed" value={count(summary.unemployed)} />}
        </div>
        <p className="hint">
          Wages and satisfaction are weighted by population.
          {partial
            ? ` Savings, unemployment, stocks and flows cover the ${summary.withDetail} of ${areas.length} areas you see in detail: yours and their neighbors.`
            : ""}
        </p>
      </Section>

      {hardest && (
        <Section title="Defense">
          <p>
            Hardest to take: <AreaLink area={hardest.area} />, with more than{" "}
            <strong>{count(Math.ceil(hardest.equipped))}</strong> equipped soldiers.
          </p>
        </Section>
      )}

      <Section title="Natural resources">
        {resources.length === 0 ? (
          <span className="muted">None.</span>
        ) : (
          <table data-testid="resources">
            <thead>
              <tr>
                <th>Good</th>
                <th className="num" title="Largest extraction per day, summed over the areas">
                  Capacity
                </th>
              </tr>
            </thead>
            <tbody>
              {resources.map((good) => (
                <tr key={good.id}>
                  <td title={good.unit}>{good.name}</td>
                  <td className="num">{fmt(summary.capacity[good.id] as number)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Section>

      <MarketTable areas={areas} />
      <Depots areas={areas} />
      <GoodSection />
    </>
  );
}

/** Defenders of an area that is not the player's, and the force it takes to win. */
/** Who defends an area: militia, the owner's armies and fortifications, and for others' areas what it takes to win. */
function Defense({ area, own }: { area: number; own: boolean }) {
  const view = usePublicView();
  if (!view) return null;
  const estimate = conquestEstimate(view.data, view.snapshot, area);
  const militiaHint = `The militia is ${pct(view.data.config.military.militiaShare)} of the population, unequipped; it refills while no attacker is present.`;
  const stats = (
    <div className="stats">
      <Stat label="Militia" value={count(estimate.militia)} testId="militia" />
      <Stat label="Army power here" value={fmt(estimate.armyPower)} />
      <Stat label="Fortification" value={`×${1 + estimate.fortification}`} />
      <Stat label="Defense power" value={fmt(estimate.defensePower)} />
    </div>
  );
  if (own)
    return (
      <Section title="Defense">
        {stats}
        <p className="hint">{militiaHint} Your armies standing here and fortifications add to it.</p>
      </Section>
    );
  return (
    <Section title="Defense">
      {stats}
      {estimate.defensePower > 0 ? (
        <p data-testid="soldiers-needed">
          Win with more than <strong>{count(Math.ceil(estimate.equippedNeeded))}</strong> equipped soldiers, or{" "}
          {count(Math.ceil(estimate.unequippedNeeded))} without weapons. Bring a margin: the battle costs soldiers.
        </p>
      ) : (
        <p>No defenders: an attacking army besieges it at once.</p>
      )}
      <p className="hint">
        Then the siege takes about {fmt(estimate.siegeDaysPer1000Equipped)} days with 1,000 equipped soldiers (twice as
        long with half as many). {militiaHint}
      </p>
    </Section>
  );
}

type SortKey = "good" | "price" | "stock" | "made" | "used" | "trade";
interface Sort {
  key: SortKey | null; // null: catalog order, inputs before their outputs
  descending: boolean;
}

const COLUMNS: { key: SortKey; label: string; detailOnly: boolean }[] = [
  { key: "good", label: "Good", detailOnly: false },
  { key: "price", label: "Price", detailOnly: false },
  { key: "stock", label: "Stock", detailOnly: true },
  { key: "made", label: "Made", detailOnly: true },
  { key: "used", label: "Used", detailOnly: true },
  { key: "trade", label: "Trade", detailOnly: true },
];
const SORT_KEY = "geonomics.marketSort";

function storedSort(): Sort {
  try {
    const sort = JSON.parse(localStorage.getItem(SORT_KEY) ?? "null") as Sort | null;
    if (sort && (sort.key === null || COLUMNS.some((c) => c.key === sort.key))) return sort;
  } catch {
    // Unreadable or blocked storage: start in catalog order.
  }
  return { key: null, descending: false };
}

function saveSort(sort: Sort): void {
  try {
    localStorage.setItem(SORT_KEY, JSON.stringify(sort));
  } catch {
    // Private windows may refuse storage; the order then lasts while the panel is open.
  }
}

/** Prices of every good, plus stocks and flows where the snapshot carries them; columns sort on click. */
function MarketTable({ areas }: { areas: number[] }) {
  const view = usePublicView();
  const table = useGame((state) => state.priceTable);
  const selectGood = useGame((state) => state.selectGood);
  const [sort, setSort] = useState(storedSort);
  if (!view) return null;
  const { data, snapshot } = view;
  const single = areas.length === 1 ? (areas[0] as number) : null;
  const summary = single === null ? selectionSummary(data, snapshot, table, areas) : null;
  const detail = single === null ? undefined : detailOf(snapshot, single);
  const hasDetail = summary ? summary.withDetail > 0 : detail !== undefined;
  const columns = COLUMNS.filter((c) => hasDetail || !c.detailOnly);
  const rows = data.goods.map((good) => {
    const g = good.id;
    if (summary) return { good, ...(summary.market[g] as (typeof summary.market)[number]) };
    const area = single as number;
    return {
      good,
      price: detail ? (detail.price[g] as number) : table ? priceOf(data, table, area, g) : 0,
      stock: detail && !good.isService ? (detail.stock[g] as number) : 0,
      made: detail ? (detail.produced[g] as number) : 0,
      used: detail ? (detail.consumed[g] as number) : 0,
      trade: detail ? (detail.imported[g] as number) - (detail.exported[g] as number) : 0,
    };
  });
  const key = sort.key !== null && columns.some((c) => c.key === sort.key) ? sort.key : null;
  if (key !== null) {
    const sign = sort.descending ? -1 : 1;
    rows.sort((a, b) => {
      const order = key === "good" ? a.good.name.localeCompare(b.good.name) : a[key] - b[key];
      return sign * order || a.good.id - b.good.id;
    });
  }
  const click = (column: SortKey) => {
    // Numbers sort largest first, names A to Z; clicking the sorted column again flips it.
    const next =
      key === column ? { key: column, descending: !sort.descending } : { key: column, descending: column !== "good" };
    setSort(next);
    saveSort(next);
  };

  return (
    <Section title={hasDetail ? "Market" : "Prices"}>
      <table data-testid="market">
        <thead>
          <tr>
            {columns.map((column) => (
              <th
                key={column.key}
                className={column.key === "good" ? undefined : "num"}
                aria-sort={key === column.key ? (sort.descending ? "descending" : "ascending") : undefined}
              >
                <button type="button" className="sort" onClick={() => click(column.key)}>
                  {column.label}
                  {key === column.key ? (sort.descending ? " ▼" : " ▲") : ""}
                </button>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.good.id}>
              <td>
                <button
                  type="button"
                  className="link"
                  onClick={() => {
                    selectGood(row.good.id);
                    document.getElementById("good-section")?.scrollIntoView({ behavior: "smooth", block: "start" });
                  }}
                >
                  {row.good.name}
                </button>
              </td>
              <td className="num" title={`labor value ${fmt(row.good.laborValue)}`}>
                {fmt(row.price)}
              </td>
              {hasDetail && (
                <>
                  <td className="num">{row.good.isService ? "—" : fmt(row.stock)}</td>
                  <td className="num">{fmt(row.made)}</td>
                  <td className="num">{fmt(row.used)}</td>
                  <td className="num">{fmt(row.trade)}</td>
                </>
              )}
            </tr>
          ))}
        </tbody>
      </table>
      {summary && (
        <span className="hint">
          Prices are means over the {areas.length} areas; stocks, production, use and net trade are sums
          {summary.withDetail < areas.length ? ` over the ${summary.withDetail} areas you see in detail` : ""}. Trade
          between two selected areas cancels out.
        </span>
      )}
      {key !== null && (
        <button
          type="button"
          className="link hint"
          onClick={() => {
            const next = { key: null, descending: false };
            setSort(next);
            saveSort(next);
          }}
        >
          Back to catalog order
        </button>
      )}
    </Section>
  );
}
