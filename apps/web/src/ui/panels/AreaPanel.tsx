// The selected areas, one or several (specification §10, Selection): their figures and defense in one grid, natural
// resources, a sortable market table, the depot, and one good across the world. Explanations show on hover.
import { useState } from "react";
import { mapControls } from "../../map/MapView";
import { type ConquestEstimate, conquestEstimate, type MarketRow, selectionSummary } from "../../state/selectors";
import { useGame } from "../../state/store";
import { count, fmt, pct, Section, Stat, Swatch } from "../components";
import { areaName, usePublicView } from "./common";
import { Depots } from "./Depots";
import { GoodSection } from "./GoodSection";

const SELECTING =
  "Click an area to select it. Double-click or double-tap the map to draw a region: tap its corners, then the first " +
  "one again. Shift-click adds or removes one area.";

export function AreaPanel() {
  const view = usePublicView();
  const selection = useGame((state) => state.selection);
  if (!view) return <p className="muted">Waiting for the first snapshot…</p>;
  return <SelectionView areas={selection} />;
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

/** One area or several: totals, population-weighted means, and what it takes to conquer them. */
function SelectionView({ areas }: { areas: number[] }) {
  const view = usePublicView();
  const table = useGame((state) => state.priceTable);
  const selectArea = useGame((state) => state.selectArea);
  if (!view) return null;
  const { data, snapshot, government } = view;
  const single = areas.length === 1 ? (areas[0] as number) : null;
  const center = () => {
    const targets = areas.length > 0 ? areas : government && government.capital !== null ? [government.capital] : [];
    if (targets.length === 0) return;
    let x = 0;
    let y = 0;
    for (const area of targets) {
      x += data.areas[area]?.x ?? 0;
      y += data.areas[area]?.y ?? 0;
    }
    mapControls.renderer?.centerOnPoint(x / targets.length, y / targets.length);
  };
  const header = (
    <Section
      title="Area"
      hint={SELECTING}
      actions={
        <>
          <SelectRealm />
          <button type="button" onClick={center}>
            Center
          </button>
          {areas.length > 1 && (
            <button type="button" onClick={() => selectArea(null)}>
              Clear
            </button>
          )}
        </>
      }
    >
      {areas.length === 0 && <p className="muted">No area selected.</p>}
    </Section>
  );
  if (areas.length === 0) return header;

  const summary = selectionSummary(data, snapshot, table, areas);
  const hoursPerDay = data.config.economy.hoursPerWorkerDay;
  const partial = summary.withDetail < areas.length;
  const coverage = partial ? ` Over the ${summary.withDetail} of ${areas.length} areas you see in detail.` : "";
  // The foreign area that takes the most to conquer, and the strongest defense.
  let hardest: { area: number; estimate: ConquestEstimate } | null = null;
  let strongest: { area: number; estimate: ConquestEstimate } | null = null;
  for (const area of areas) {
    const estimate = conquestEstimate(data, snapshot, area);
    if (!strongest || estimate.defensePower > strongest.estimate.defensePower) strongest = { area, estimate };
    if (government && snapshot.areas.owner[area] === government.id) continue;
    if (!hardest || estimate.equippedNeeded > hardest.estimate.equippedNeeded) hardest = { area, estimate };
  }
  const militiaShare = pct(data.config.military.militiaShare);
  const where = (area: number) => (single === null ? `${areaName(data, area)}: ` : "");
  const siege = single === null ? 0 : (snapshot.areas.siegeProgress[single] as number);
  const resources = data.goods.filter((good) => good.isPrimary && (summary.capacity[good.id] as number) > 0);
  const static_ = single === null ? undefined : data.areas[single];
  const owner = single === null ? -1 : (snapshot.areas.owner[single] as number);
  const ownerSummary = owner >= 0 ? snapshot.governments[owner] : undefined;

  return (
    <>
      <section className="section">
        {header}
        {static_ ? (
          <>
            <h2 data-testid="area-name">{static_.name}</h2>
            <div className="muted">
              {ownerSummary ? (
                <>
                  <Swatch color={ownerSummary.color} />
                  {ownerSummary.name}
                  {government && owner === government.id ? " (you)" : ""}
                </>
              ) : (
                "Neutral"
              )}{" "}
              · {static_.terrain}
              {static_.isCoastal ? " · coast" : ""}
            </div>
          </>
        ) : (
          <>
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
          </>
        )}
        <div className="stats">
          <Stat label="Population" value={count(summary.population)} testId="population" />
          <Stat
            label="Average wage"
            value={`${fmt(summary.wageLevel * hoursPerDay)} mh/day`}
            title={`Mean value added per private worker and day, in man-hours (an hour of an average worker's labor), weighted by workers${single === null ? " and then by population" : ""}; not a median.`}
          />
          <Stat
            label="Necessities met"
            value={pct(summary.necessitySatisfaction)}
            title="Share of the need for necessities (food and the like) that people could buy."
          />
          <Stat
            label="Satisfaction"
            value={pct(summary.satisfaction)}
            title="Share of every need, comforts and luxuries included, that people could buy."
          />
          {single !== null && (
            <Stat
              label="Port · airport · fort"
              value={`${snapshot.areas.portLevel[single]} · ${snapshot.areas.airportLevel[single]} · ${snapshot.areas.fortificationLevel[single]}`}
              title="Port and airport levels set sea and air route capacity; each fortification level adds 100% to defense."
            />
          )}
          {summary.withDetail > 0 && (
            <Stat
              label="Savings per person"
              value={`${fmt(summary.savings / Math.max(summary.detailPopulation, 1))} mh`}
              title={`Average private savings per inhabitant, in man-hours.${coverage}`}
            />
          )}
          {summary.withDetail > 0 && (
            <Stat
              label="Unemployed"
              value={count(summary.unemployed)}
              title={`Workers without a private or government job.${coverage}`}
            />
          )}
          {siege > 0 && <Stat label="Siege" value={pct(siege)} title="The area falls when the siege reaches 100%." />}
          <Stat
            label="Militia"
            value={count(summary.militia)}
            testId="militia"
            title={`${militiaShare} of the population, unequipped; it refills while no attacker is present.`}
          />
          {strongest && (
            <Stat
              label="Defense power"
              value={fmt(strongest.estimate.defensePower)}
              title={`${where(strongest.area)}militia ${count(strongest.estimate.militia)} plus the owner's armies here ${fmt(strongest.estimate.armyPower)}, times ${1 + strongest.estimate.fortification} for fortification.${single === null ? " The strongest of the areas." : ""}`}
            />
          )}
          {hardest && (
            <Stat
              label="To conquer"
              value={
                hardest.estimate.defensePower > 0
                  ? `> ${count(Math.ceil(hardest.estimate.equippedNeeded))} equipped`
                  : "Undefended"
              }
              testId="soldiers-needed"
              title={`${where(hardest.area)}${
                hardest.estimate.defensePower > 0
                  ? `more than ${count(Math.ceil(hardest.estimate.equippedNeeded))} equipped soldiers, or ${count(Math.ceil(hardest.estimate.unequippedNeeded))} without weapons; bring a margin, the battle costs soldiers. `
                  : "no defenders, an attacking army besieges it at once. "
              }Then the siege takes about ${fmt(hardest.estimate.siegeDaysPer1000Equipped)} days with 1,000 equipped soldiers, twice as long with half as many.${single === null ? " The hardest of the areas that are not yours." : ""}`}
            />
          )}
        </div>
      </section>

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
                {summary.withDetail > 0 && (
                  <>
                    <th className="num" title={`Capacity left after depletion.${coverage}`}>
                      Now
                    </th>
                    <th className="num" title={`Units extracted per day.${coverage}`}>
                      Extracted
                    </th>
                    <th className="num" title="Extracted over the capacity left">
                      Use
                    </th>
                  </>
                )}
              </tr>
            </thead>
            <tbody>
              {resources.map((good) => {
                const now = summary.capacityNow[good.id] as number;
                const extracted = summary.extracted[good.id] as number;
                return (
                  <tr key={good.id}>
                    <td title={good.unit}>{good.name}</td>
                    <td className="num">{fmt(summary.capacity[good.id] as number)}</td>
                    {summary.withDetail > 0 && (
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
      </Section>

      <MarketTable areas={areas} />
      <Depots areas={areas} />
      <GoodSection />
    </>
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
  const summary = selectionSummary(data, snapshot, table, areas);
  const hasDetail = summary.withDetail > 0;
  const columns = COLUMNS.filter((c) => hasDetail || !c.detailOnly);
  const rows = data.goods.map((good) => ({ good, ...(summary.market[good.id] as MarketRow) }));
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
      {areas.length > 1 && (
        <span className="muted">
          Mean prices; sums{summary.withDetail < areas.length ? ` over ${summary.withDetail} areas seen in detail` : ""}
          , net of trade inside.
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
